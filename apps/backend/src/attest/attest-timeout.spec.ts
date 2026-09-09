import { describe, expect, it } from 'bun:test';
import { withTimeout, DEFAULT_SUBMIT_TIMEOUT_MS } from './attestor';

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
