/**
 * The crawl queue: what the API asks for and what a worker does.
 *
 * The queue is a trigger, not the record. What is owed is `index_urls` rows
 * with a null `crawled_at`, in Postgres, inside the same transaction that took
 * the payment. So a lost job, a Redis restart or a worker crash delays a crawl
 * and cannot lose one, and the sweeper below is what turns that from a
 * property of the design into something that actually happens.
 */
export const CRAWL_QUEUE = 'crawl';

export interface CrawlJob {
  /** Which index's outstanding URLs to fetch. */
  readonly indexId: string;
}

/**
 * One job per index at a time. BullMQ deduplicates on job id, so an append
 * arriving while that index is mid-crawl does not start a second crawler over
 * the same rows; the running one drains whatever is pending when it queries.
 *
 * Hyphen, not colon: BullMQ rejects a custom id containing `:`, which is what
 * it uses to namespace its own Redis keys. It rejects it at enqueue time, on
 * the server, which is a poor place to find out.
 */
export const crawlJobId = (indexId: string): string => `crawl-${indexId}`;
