import { describe, expect, it } from 'bun:test';
import {
  configured,
  createEasSubmitter,
  withTimeout,
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
