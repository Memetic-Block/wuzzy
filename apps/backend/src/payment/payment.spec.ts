import { afterAll, afterEach, beforeAll, describe, expect } from 'bun:test';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { exact } from 'x402/schemes';
import { ChunkEntity } from '../database/chunk.entity';
import { DocumentEntity } from '../database/document.entity';
import { buildDataSourceOptions } from '../database/typeorm.config';
import { toVectorLiteral, type Embedder } from '../embed/embedder';
import { SearchController } from '../search/search.controller';
import { SearchService } from '../search/search.service';
import { truncateWuzzyTables } from '../testing/database';
import { scenario } from '../testing/scenario';
import { PAYMENT_CONFIG, type PaymentConfig } from './payment.config';
import { PaymentService } from './payment.service';
import { startMockFacilitator, type MockFacilitator } from './mock-facilitator';

const DIMENSIONS = 1536;
const PAY_TO = '0x2222222222222222222222222222222222222222';

/** Deterministic stand-in: no network, and similarity still behaves sensibly. */
const stubEmbedder = (): Embedder => ({
  model: 'stub',
  dimensions: DIMENSIONS,
  embed: async (texts) =>
    texts.map((text) => {
      const vector = new Array<number>(DIMENSIONS).fill(0);
      for (const [index, char] of [...text.toLowerCase()].entries()) {
        const slot = (char.charCodeAt(0) * 7 + index) % DIMENSIONS;
        vector[slot] = (vector[slot] ?? 0) + 1;
      }
      return vector;
    }),
});

let dataSource: DataSource | undefined;
let unreachable: string | undefined;
let facilitator: MockFacilitator | undefined;

beforeAll(async () => {
  const candidate = new DataSource(buildDataSourceOptions());
  try {
    dataSource = await candidate.initialize();
  } catch (error) {
    if (process.env.CI) throw error;
    unreachable = (error as Error).message;
    return;
  }
  await truncateWuzzyTables(dataSource);
  facilitator = await startMockFacilitator();
});

afterAll(async () => {
  await facilitator?.close();
  await dataSource?.destroy();
});

afterEach(async () => {
  await truncateWuzzyTables(dataSource);
  facilitator?.reset();
});

const ready = (): DataSource | null => {
  if (dataSource) return dataSource;
  console.log(`skipped: database unreachable (${unreachable})`);
  return null;
};

/** Boots the search endpoint with the meter configured as the scenario needs. */
async function boot(source: DataSource, overrides: Partial<PaymentConfig>) {
  const config: PaymentConfig = {
    enabled: true,
    payTo: PAY_TO,
    network: 'base',
    price: '$0.01',
    facilitatorUrl: facilitator!.url,
    description: 'One Wuzzy search query with onchain provenance',
    ...overrides,
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [SearchController],
    providers: [
      { provide: getDataSourceToken(), useValue: source },
      { provide: PAYMENT_CONFIG, useValue: config },
      PaymentService,
      { provide: SearchService, useValue: new SearchService(source, stubEmbedder()) },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  await app.listen(0);
  const url = await app.getUrl();
  return { app, url: url.replace('[::1]', '127.0.0.1') };
}

/** One indexed, embedded, attested document so results have provenance to carry. */
async function seedCorpus(source: DataSource, attestationUid: string | null) {
  const text = 'Deploying a smart contract to Base requires a funded wallet and a configured RPC.';
  const document = await source.getRepository(DocumentEntity).save({
    url: 'https://docs.base.org/deploy',
    title: 'Deploy a smart contract',
    content: `# Deploy\n\n${text}\n`,
    rawHash: 'a'.repeat(64),
    contentHash: 'b'.repeat(64),
    protocol: 'wuzzy/crawl',
    protocolVersion: 1,
    robotsStatus: 'allowed',
    httpStatus: 200,
    fetchedAt: new Date('2026-02-01T00:00:00Z'),
    embeddedAt: new Date('2026-02-01T01:00:00Z'),
    attestationUid,
    attestedAt: attestationUid ? new Date('2026-02-01T02:00:00Z') : null,
  });

  const [vector] = await stubEmbedder().embed([text]);
  await source.getRepository(ChunkEntity).insert({
    documentId: document.id,
    ordinal: 0,
    text,
    tokenCount: 20,
    embedding: toVectorLiteral(vector!) as unknown as number[],
    embeddedAt: new Date('2026-02-01T01:00:00Z'),
  });
  return document;
}

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${url}/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

/** A well-formed X-PAYMENT header; the mock facilitator decides if it is valid. */
const paymentHeader = (): string =>
  exact.evm.encodePayment({
    x402Version: 1,
    scheme: 'exact',
    network: 'base',
    payload: {
      signature: `0x${'1'.repeat(130)}`,
      authorization: {
        from: '0x1111111111111111111111111111111111111111',
        to: PAY_TO,
        value: '10000',
        validAfter: '0',
        validBefore: String(Math.floor(Date.now() / 1000) + 3600),
        nonce: `0x${'2'.repeat(64)}`,
      },
    },
  });

describe('x402-metered search', () => {
  scenario('unpaid request receives payment requirements', async () => {
    const source = ready();
    if (!source) return;
    await seedCorpus(source, `0x${'e'.repeat(64)}`);

    const { app, url } = await boot(source, {});
    try {
      const response = await post(url, { query: 'deploy a contract' });
      expect(response.status).toBe(402);

      const body = (await response.json()) as Record<string, any>;
      expect(body.x402Version).toBe(1);
      expect(body.accepts).toBeArray();
      expect(body.accepts[0].payTo).toBe(PAY_TO);
      expect(body.accepts[0].maxAmountRequired).toBe('10000');
      expect(body.accepts[0].network).toBe('base');
      expect(body.results).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  scenario('paid request returns results with provenance', async () => {
    const source = ready();
    if (!source) return;
    const uid = `0x${'e'.repeat(64)}`;
    await seedCorpus(source, uid);

    const { app, url } = await boot(source, {});
    try {
      const response = await post(url, { query: 'deploy a contract' }, { 'X-PAYMENT': paymentHeader() });
      expect(response.status).toBe(200);

      const body = (await response.json()) as Record<string, any>;
      expect(body.results).toBeArray();
      expect(body.results.length).toBeGreaterThan(0);

      const [result] = body.results;
      expect(result.url).toBe('https://docs.base.org/deploy');
      expect(result.title).toBe('Deploy a smart contract');
      expect(typeof result.snippet).toBe('string');
      expect(typeof result.score).toBe('number');

      expect(result.provenance.protocol).toBe('wuzzy/crawl');
      expect(result.provenance.protocolVersion).toBe(1);
      expect(result.provenance.contentHash).toBe('b'.repeat(64));
      expect(result.provenance.fetchedAt).toBe('2026-02-01T00:00:00.000Z');
      expect(result.provenance.attestationUid).toBe(uid);
      expect(result.provenance.attestationUrl).toBe(
        `https://base.easscan.org/attestation/view/${uid}`,
      );

      // Settled only after results existed, and reported back to the payer.
      expect(facilitator!.settled).toHaveLength(1);
      expect(response.headers.get('x-payment-response')).toBeTruthy();
    } finally {
      await app.close();
    }
  });

  scenario('malformed or insufficient payment is rejected', async () => {
    const source = ready();
    if (!source) return;
    await seedCorpus(source, null);

    const { app, url } = await boot(source, {});
    try {
      // Malformed: not a decodable payment header at all.
      const malformed = await post(url, { query: 'deploy' }, { 'X-PAYMENT': 'not-a-payment' });
      expect(malformed.status).toBe(402);
      expect((await malformed.json()).results).toBeUndefined();

      // Insufficient: well-formed, but the facilitator refuses it.
      facilitator!.valid = false;
      const insufficient = await post(url, { query: 'deploy' }, { 'X-PAYMENT': paymentHeader() });
      expect(insufficient.status).toBe(402);
      const body = (await insufficient.json()) as Record<string, any>;
      expect(body.error).toBe('insufficient_funds');
      expect(body.results).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  scenario('dev mode serves openly and says so', async () => {
    const source = ready();
    if (!source) return;
    await seedCorpus(source, null);

    const { app, url } = await boot(source, { enabled: false });
    try {
      const response = await post(url, { query: 'deploy a contract' });
      expect(response.status).toBe(200);
      expect((await response.json()).results).toBeArray();
      // Nothing was charged, because nothing was metered.
      expect(facilitator!.settled).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  scenario('queries are rejected when empty', async () => {
    const source = ready();
    if (!source) return;
    await seedCorpus(source, null);

    const { app, url } = await boot(source, { enabled: false });
    try {
      const response = await post(url, { query: '   ' });
      expect(response.status).toBe(400);
    } finally {
      await app.close();
    }
  });
});
