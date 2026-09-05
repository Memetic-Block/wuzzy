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
    return { created: 0, unchanged: 0, changed: 0, skipped: 0, failed: 0, requested: 0, indexed: 0 };
  }

  const urls = pending.map((row) => row.url);
  const summary = await crawl(dataSource, {
    seeds: urls,
    indexId,
    discover: false,
    maxConcurrency: options.maxConcurrency,
    minHostIntervalMs: options.minHostIntervalMs,
    fetcher: options.fetcher,
  });

  // Every attempted URL leaves the queue, so a page that cannot be fetched
  // does not keep the index short of ready forever. The note is deliberately
  // about what is true of the store rather than about a cause: a URL that
  // redirected is indexed and a member, just under the URL it resolved to.
  const [{ indexed }] = (await dataSource.query(
    `WITH attempted AS (
       UPDATE index_urls u
          SET crawled_at = now(),
              error = CASE WHEN d.id IS NULL THEN 'no document at this exact URL' END
         FROM (SELECT unnest($2::text[]) AS url) q
         LEFT JOIN documents d ON d.url = q.url
        WHERE u.index_id = $1 AND u.crawled_at IS NULL AND u.url = q.url
        RETURNING d.id
     )
     SELECT count(*) FILTER (WHERE id IS NOT NULL)::int AS indexed FROM attempted`,
    [indexId, urls],
  )) as [{ indexed: number }];

  return { ...summary, requested: urls.length, indexed };
}
