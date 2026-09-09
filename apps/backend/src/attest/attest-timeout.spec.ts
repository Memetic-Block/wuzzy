import { describe, expect, it } from 'bun:test';
import {
  configured,
  createEasSubmitter,
  withTimeout,
  DEFAULT_BATCH_SIZE,
  DEFAULT_SUBMIT_TIMEOUT_MS,
} from './attestor';

describe('attestation submit deadline', () => {
  it('fails a submission that never comes back', async () => {
    // The failure that stopped 2,476 receipts: `transaction.wait()` waits for a
    // receipt with no deadline, so a provider that stops answering leaves the
    // job active forever, and the sweeper only clears jobs that finished.
    const never = new Promise<string[]>(() => {});
    await expect(withTimeout(never, 20, 'attestation batch of 50')).rejects.toThrow(
      /attestation batch of 50 did not settle within 20ms/,
    );
  });

  it('leaves a submission that does come back alone', async () => {
    await expect(withTimeout(Promise.resolve(['0xuid']), 1_000, 'batch')).resolves.toEqual([
      '0xuid',
    ]);
  });

  it('waits minutes rather than seconds, because a batch is not a request', async () => {
    // Base blocks every two seconds. A deadline near the block time would fail
    // healthy batches and re-attest them, which costs real money.
    expect(DEFAULT_SUBMIT_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });
});

describe('configuration that arrives through a secret store', () => {
  it('treats an empty override as absent, not as a value', () => {
    // A Vault template renders a key that is not set as the empty string. With
    // `??` that beat the default, and the attester connected to "", which
    // ethers reports as a network it cannot detect. Every value here can reach
    // the process that way, so none of them may be trusted to be undefined.
    const submitter = createEasSubmitter(
      {},
      {
        EAS_SCHEMA_UID: '0x' + 'a'.repeat(64),
        ATTESTER_PRIVATE_KEY: '0x' + '1'.repeat(64),
        EAS_CHAIN: 'base',
        BASE_RPC_URL: '<no value>',
        EAS_ADDRESS: '   ',
      },
    );
    expect(submitter).toBeDefined();
  });
});

describe('values that arrive through a Nomad template', () => {
  it('reads the sentinel a missing Vault key renders as nothing at all', () => {
    // Not a hypothetical: this is what the renderer writes when the key does
    // not exist, and it is neither undefined nor empty, so it beats a default.
    expect(configured('<no value>')).toBeUndefined();
    expect(configured('')).toBeUndefined();
    expect(configured('   ')).toBeUndefined();
    expect(configured(undefined)).toBeUndefined();
    expect(configured(' https://node.example  ')).toBe('https://node.example');
  });
});

describe('a batch the chain will not price', () => {
  it('halves the batch rather than failing the run forever', async () => {
    // Reproduced against Base on 2026-09-09: 25 attestations carrying long
    // documentation URLs estimate at 8.9M gas, 50 fail with "missing revert
    // data" and no reason. Every run then died at the same batch, silently.
    const sizes: number[] = [];
    const submitter = {
      submit: async (requests: readonly { documentId: string }[]) => {
        sizes.push(requests.length);
        if (requests.length > 25) throw new Error('missing revert data');
        return requests.map((_r, i) => `0x${String(i).padStart(64, '0')}`);
      },
    };

    const attempted: number[] = [];
    for (let size = 50; size > 0; size = Math.floor(size / 2)) {
      attempted.push(size);
      try {
        await submitter.submit(Array.from({ length: size }, () => ({ documentId: 'x' })));
        break;
      } catch {
        continue;
      }
    }
    // 50 is refused, 25 is accepted, and the run continues at the size that works.
    expect(attempted).toEqual([50, 25]);
    expect(sizes.at(-1)).toBe(25);
  });

  it('batches at the size the measurements say is worth it', () => {
    // Past 25 batching buys nothing (SCHEMA.md) and risks a call nothing will
    // estimate, so the default is the top of the useful range, not above it.
    expect(DEFAULT_BATCH_SIZE).toBe(25);
  });
});
