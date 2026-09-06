import type { DataSource } from 'typeorm';
import { crawl, type CrawlSummary } from '../crawl/crawler';
import type { Fetcher } from '../crawl/http';

export interface IndexCrawlOptions {
  readonly maxConcurrency?: number;
  readonly minHostIntervalMs?: number;
  readonly fetcher?: Fetcher;
}

export interface IndexCrawlResult extends CrawlSummary {
  /** URLs that were pending before the run. */
  readonly requested: number;
  /** Of those, how many the store now holds. */
  readonly indexed: number;
}

/**
 * Crawls the URLs an index has paid for and not yet received.
 *
 * Discovery is off: the payer named these pages and was billed for exactly
 * these pages, so following links out of them would fetch what nobody asked
 * for and put the index over its cap. Everything else is the ordinary crawl,
 * robots included, because being entitled to fetch a page is not something
 * paying us can confer.
 */
export async function crawlIndexQueue(
  dataSource: DataSource,
  indexId: string,
  options: IndexCrawlOptions = {},
): Promise<IndexCrawlResult> {
  const pending: { url: string }[] = await dataSource.query(
    `SELECT url FROM index_urls WHERE index_id = $1 AND crawled_at IS NULL ORDER BY id`,
    [indexId],
  );
  if (pending.length === 0) {
    return {
      created: 0, unchanged: 0, changed: 0, skipped: 0, failed: 0, fresh: 0,
      requested: 0, indexed: 0,
    };
  }

  const urls = pending.map((row) => row.url);

  // A queued URL is satisfied by whatever it resolved to, which is not
  // necessarily itself: documents are stored under the URL the origin finally
  // served, so matching the queue on its own text would report a redirect as a
  // failure and leave the index looking short of what was paid for.
  const resolved = new Map<string, string>();
  const summary = await crawl(dataSource, {
    seeds: urls,
    indexId,
    discover: false,
    maxConcurrency: options.maxConcurrency,
    minHostIntervalMs: options.minHostIntervalMs,
    fetcher: options.fetcher,
    // Paid-for URLs are fetched whatever a sitemap claims: the payer asked for
    // these pages now, and a freshness check would hand back an empty index.
    refetchAll: true,
    onDocument: (event) => resolved.set(event.requestedUrl, event.url),
  });

  // Every attempted URL leaves the queue, so a page that cannot be fetched
  // does not keep the index short of ready forever. What went wrong is
  // recorded rather than retried silently.
  await dataSource.query(
    `UPDATE index_urls u
        SET crawled_at = now(),
            error = CASE WHEN q.resolved_url IS NULL
                         THEN 'not indexed: fetch failed, disallowed or too thin' END
       FROM (SELECT unnest($2::text[]) AS url, unnest($3::text[]) AS resolved_url) q
      WHERE u.index_id = $1 AND u.crawled_at IS NULL AND u.url = q.url`,
    [indexId, urls, urls.map((url) => resolved.get(url) ?? null)],
  );

  return { ...summary, requested: urls.length, indexed: resolved.size };
}
