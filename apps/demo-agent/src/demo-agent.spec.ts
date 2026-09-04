import { afterEach, describe, expect, it } from 'bun:test';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePrivateKey } from 'viem/accounts';
import { paidSearch, WalletRequiredError } from './search';
import { createWallet, loadWallet, NoWalletError, walletPath } from './wallet';

const servers: Server[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  }
});

const RESULT = {
  url: 'https://docs.base.org/deploy',
  title: 'Deploy a smart contract',
  snippet: 'Deploying to Base requires a funded wallet.',
  score: 0.91,
  provenance: {
    protocol: 'wuzzy/crawl',
    protocolVersion: 1,
    contentHash: 'b'.repeat(64),
    fetchedAt: '2026-02-01T00:00:00.000Z',
    attestationUid: `0x${'e'.repeat(64)}`,
    attestationUrl: `https://base.easscan.org/attestation/view/0x${'e'.repeat(64)}`,
  },
};

/**
 * A Wuzzy endpoint that demands payment once and then serves. It answers the
 * shape the real API answers, so the client's 402 -> pay -> retry loop is
 * exercised for real; only the facilitator's judgement is stubbed out.
 */
async function startEndpoint(options: { devMode?: boolean } = {}) {
  const seen: { paid: boolean }[] = [];
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
    });
    request.on('end', () => {
      const payment = request.headers['x-payment'];
      seen.push({ paid: Boolean(payment) });
      response.setHeader('content-type', 'application/json');

      if (!payment && !options.devMode) {
        response.statusCode = 402;
        response.end(
          JSON.stringify({
            x402Version: 1,
            error: 'X-PAYMENT header is required',
            accepts: [
              {
                scheme: 'exact',
                network: 'base-sepolia',
                maxAmountRequired: '10000',
                resource: 'http://127.0.0.1/search',
                description: 'One Wuzzy search query',
                mimeType: 'application/json',
                payTo: '0x2222222222222222222222222222222222222222',
                maxTimeoutSeconds: 60,
                asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
                extra: { name: 'USDC', version: '2' },
              },
            ],
          }),
        );
        return;
      }

      if (payment) {
        response.setHeader(
          'x-payment-response',
          Buffer.from(
            JSON.stringify({
              success: true,
              transaction: `0x${'d'.repeat(64)}`,
              network: 'base-sepolia',
              payer: '0x1111111111111111111111111111111111111111',
            }),
          ).toString('base64'),
        );
      }
      response.statusCode = 200;
      response.end(JSON.stringify({ query: JSON.parse(raw || '{}').query, results: [RESULT] }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return { url: `http://127.0.0.1:${address.port}/search`, seen };
}

describe('demo agent wallet', () => {
  it('stores a fresh wallet outside the repository, readable only by its owner', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'wuzzy-wallet-'));
    const path = join(directory, 'demo-wallet.json');

    const wallet = await createWallet(path);
    expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/);

    // 0600: a funded key must not be world-readable.
    expect((await stat(path)).mode & 0o777).toBe(0o600);

    const stored = JSON.parse(await readFile(path, 'utf8'));
    expect(stored.privateKey).toBe(wallet.privateKey);

    const loaded = await loadWallet({}, path);
    expect(loaded.address).toBe(wallet.address);
  });

  it('defaults to a path outside the working tree', () => {
    const path = walletPath({ HOME: '/home/someone' });
    expect(path).toBe('/home/someone/.config/wuzzy/demo-wallet.json');
    expect(path.startsWith(process.cwd())).toBe(false);
  });

  it('prefers DEMO_PRIVATE_KEY over the wallet file', async () => {
    const privateKey = generatePrivateKey();
    const loaded = await loadWallet({ DEMO_PRIVATE_KEY: privateKey }, '/nonexistent/wallet.json');
    expect(loaded.privateKey).toBe(privateKey);
  });

  it('explains itself when no wallet exists', async () => {
    await expect(loadWallet({}, '/nonexistent/wallet.json')).rejects.toBeInstanceOf(NoWalletError);
  });
});

describe('paid search', () => {
  it('answers a 402 by signing a payment and retrying', async () => {
    const endpoint = await startEndpoint();

    // An unfunded key still signs a valid EIP-712 authorization; only
    // settlement would need funds, and that is the facilitator's job.
    const outcome = await paidSearch({
      endpoint: endpoint.url,
      query: 'how do I deploy a contract to Base',
      privateKey: generatePrivateKey(),
      network: 'base-sepolia',
    });

    expect(endpoint.seen.map((request) => request.paid)).toEqual([false, true]);
    expect(outcome.paid).toBe(true);
    expect(outcome.settlement?.transaction).toBe(`0x${'d'.repeat(64)}`);

    expect(outcome.results).toHaveLength(1);
    const [result] = outcome.results;
    expect(result!.url).toBe('https://docs.base.org/deploy');
    expect(result!.provenance.attestationUid).toBe(`0x${'e'.repeat(64)}`);
    expect(result!.provenance.attestationUrl).toContain('base.easscan.org');
  });

  it('works against an endpoint in dev mode, without paying', async () => {
    const endpoint = await startEndpoint({ devMode: true });

    const outcome = await paidSearch({
      endpoint: endpoint.url,
      query: 'deploy',
      privateKey: generatePrivateKey(),
      network: 'base-sepolia',
    });

    expect(endpoint.seen.map((request) => request.paid)).toEqual([false]);
    expect(outcome.paid).toBe(false);
    expect(outcome.results).toHaveLength(1);
  });

  it('serves a dev-mode endpoint with no wallet at all', async () => {
    const endpoint = await startEndpoint({ devMode: true });

    const outcome = await paidSearch({ endpoint: endpoint.url, query: 'deploy' });
    expect(outcome.paid).toBe(false);
    expect(outcome.results).toHaveLength(1);
    expect(endpoint.seen).toHaveLength(1);
  });

  it('says a wallet is needed when the endpoint actually charges', async () => {
    const endpoint = await startEndpoint();

    await expect(paidSearch({ endpoint: endpoint.url, query: 'deploy' })).rejects.toBeInstanceOf(
      WalletRequiredError,
    );
  });

  it('refuses to pay more than the ceiling', async () => {
    const endpoint = await startEndpoint();

    await expect(
      paidSearch({
        endpoint: endpoint.url,
        query: 'deploy',
        privateKey: generatePrivateKey(),
        network: 'base-sepolia',
        maxValue: 1n,
      }),
    ).rejects.toThrow();
  });
});
