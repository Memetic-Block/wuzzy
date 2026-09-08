/**
 * The attest queue: what a crawl worker asks for once an index is embedded.
 *
 * Separate from the crawl queue because attestation is the one thing here that
 * spends money and signs with a funded key. Keeping it its own queue means one
 * service holds that key rather than every crawl worker, and a gas spike backs
 * attestation up without stalling crawls somebody has already paid for.
 *
 * The queue is a trigger, not the record. What is owed is derivable from the
 * documents themselves, embedded and carrying no UID, which is the same query
 * the attester drains. So a lost job, a Redis restart or an attester crash
 * delays a receipt and cannot lose one.
 */
export const ATTEST_QUEUE = 'attest';

export interface AttestJob {
  /** Which index's embedded documents to attest. */
  readonly indexId: string;
}

/**
 * One job per index at a time, deduplicated by BullMQ on this id, so a second
 * append arriving mid-run does not start a competing attester over the same
 * documents and pay gas twice for them.
 *
 * Hyphen, not colon: BullMQ uses `:` to namespace its own Redis keys and
 * rejects a custom id containing one, at enqueue time, on the server.
 */
export const attestJobId = (indexId: string): string => `attest-${indexId}`;
