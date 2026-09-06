import { BasicCrawler, Configuration } from '@crawlee/basic';
import type { DataSource } from 'typeorm';
import { JSDOM } from 'jsdom';
import { canonicalize } from '../canonicalize/v1';
import { createFetcher, type Fetcher } from './http';
import { loadRobots, type RobotsPolicy } from './robots';
import { recordFailedFetch, recordFetch, type FetchOutcome } from './provenance';
import { collectSitemapEntries, type SitemapEntry } from './sitemap';
import { userAgent } from './user-agent';

export interface CrawlOptions {
  readonly seeds: readonly string[];
  readonly maxRequests?: number;
  readonly maxConcurrency?: number;
  /**
   * Minimum gap between two requests to the same host. Concurrency is global,
   * so without this a run over several sites can still put every worker on one
   * of them. Being welcome back matters more to this crawler than finishing
   * quickly.
   */
  readonly minHostIntervalMs?: number;
  /**
   * Ceiling per host. A global cap alone starves any site that has no sitemap:
   * it starts with one URL and has to discover the rest, by which time the
   * sites that listed thousands up front have spent the budget.
   */
  readonly maxPerHost?: number;
  /**
   * Index every crawled document joins. The global crawl passes the global
   * index; a commissioned crawl passes its own, which is what keeps a private
   * index's pages out of the public one.
   */
  readonly indexId?: string;
  /**
   * Whether to expand seeds through sitemaps and follow links out of them.
   * Off for a commissioned crawl: those pages were paid for one by one, and
   * discovery would fetch pages nobody asked for and overrun the page cap.
   */
  readonly discover?: boolean;
  /**
   * Called for each fetch that produced a document, with both the URL that was
   * asked for and the one it resolved to. A caller that queued a URL cannot
   * otherwise tell that a redirect satisfied it, because the document is
   * stored under the URL the origin ended up serving.
   */
  readonly onDocument?: (event: DocumentEvent) => void;
  /**
   * Re-fetch everything, ignoring what sitemaps claim about staleness. The
   * escape hatch for a corpus that needs rebuilding after a canonicalizer
   * change, where nothing about the sites moved but our output would.
   */
  readonly refetchAll?: boolean;
  /**
   * How long a document may go unfetched before it is re-fetched whatever the
   * sitemap claims. A site that never updates its lastmod would otherwise be
   * crawled once and trusted forever.
   */
  readonly maxAgeDays?: number;
  /** Injected by tests; production uses the honest fetcher. */
  readonly fetcher?: Fetcher;
}

export interface DocumentEvent {
  readonly requestedUrl: string;
  readonly url: string;
  readonly documentId: string;
  readonly outcome: FetchOutcome;
}

export type CrawlSummary = Record<FetchOutcome | 'failed', number> & {
  /** URLs a sitemap said were unchanged since we last fetched them. */
  fresh: number;
};

/** Re-fetch after this long even when a sitemap claims nothing has changed. */
export const DEFAULT_MAX_AGE_DAYS = 14;

/** One request per host per this many ms, by default. */
export const DEFAULT_MIN_HOST_INTERVAL_MS = 250;

const HTML_LIKE = /^(text\/html|application\/xhtml\+xml)/i;
const MARKDOWN_LIKE = /^(text\/markdown|text\/x-markdown)/i;

/**
 * Crawls a set of seeds and writes the provenance trail for everything fetched.
 *
 * Crawlee supplies the request queue, concurrency and retries; every actual
 * request goes through our own fetcher. That split is deliberate: Crawlee's
 * HTTP crawlers hand back a decoded string, which does not reproduce the
 * origin's bytes for a page that is not UTF-8, and the raw hash has to commit
 * to exactly what was received. Owning the fetch also means the honest
 * user-agent is on every request without relying on a hook to cover them all.
 */
export async function crawl(dataSource: DataSource, options: CrawlOptions): Promise<CrawlSummary> {
  const agent = userAgent();
  const summary: CrawlSummary = {
    created: 0,
    unchanged: 0,
    changed: 0,
    skipped: 0,
    failed: 0,
    fresh: 0,
  };

  // Declared before `inScope` so the guard can close over it; robots.txt and
  // sitemaps are fetched without a guard, since robots cannot gate the request
  // that fetches robots.
  const scopeGuard = async (url: string): Promise<boolean> => inScope(url);
  const fetcher = options.fetcher ?? createFetcher(agent);
  const pageFetcher = politely(
    options.fetcher ?? createFetcher(agent, scopeGuard),
    options.minHostIntervalMs ?? DEFAULT_MIN_HOST_INTERVAL_MS,
  );

  const policies = new Map<string, RobotsPolicy>();
  const policyFor = async (url: string): Promise<RobotsPolicy> => {
    const { origin } = new URL(url);
    let policy = policies.get(origin);
    if (!policy) {
      policy = await loadRobots(origin, fetcher);
      policies.set(origin, policy);
    }
    return policy;
  };

  // Seed hosts bound the crawl: a link off-host is not followed, and neither is
  // a sitemap entry that points somewhere else.
  const allowedHosts = new Set(options.seeds.map((seed) => new URL(seed).host));

  // Budget is spent at approval rather than at fetch, so that a host cannot
  // have thousands of URLs approved before any of them come back. Approvals are
  // remembered because the same URL can be offered from several pages.
  const approved = new Set<string>();
  const perHost = new Map<string, number>();
  const inScope = async (url: string): Promise<boolean> => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (!allowedHosts.has(parsed.host)) return false;
    if (!(await policyFor(url)).isAllowed(url)) return false;

    if (options.maxPerHost === undefined) return true;
    if (approved.has(url)) return true;
    const used = perHost.get(parsed.host) ?? 0;
    if (used >= options.maxPerHost) return false;
    perHost.set(parsed.host, used + 1);
    approved.add(url);
    return true;
  };

  const crawler = new BasicCrawler(
    {
      maxRequestsPerCrawl: options.maxRequests,
      maxConcurrency: options.maxConcurrency ?? 4,
      requestHandler: async ({ request, addRequests }) => {
        const response = await pageFetcher(request.url);
        const fetchedAt = new Date();

        if (response.blockedRedirect) {
          // The page moved somewhere out of scope. Not an error, and not
          // something to record: the redirect target was never requested.
          summary.skipped += 1;
          return;
        }
        if (response.status >= 400) {
          await recordFailedFetch(dataSource, {
            url: response.url,
            httpStatus: response.status,
            error: `HTTP ${response.status}`,
            fetchedAt,
          });
          summary.failed += 1;
          return;
        }

        const contentType = response.contentType ?? '';
        const isMarkdown = MARKDOWN_LIKE.test(contentType);
        if (!isMarkdown && !HTML_LIKE.test(contentType)) {
          await recordFailedFetch(dataSource, {
            url: response.url,
            httpStatus: response.status,
            error: `unusable content-type: ${contentType || 'none'}`,
            fetchedAt,
          });
          // Not a failure: the request worked and the answer was simply not a
          // page. A sitemap that lists XML schemas and plain-text files is
          // normal, and reporting those as failures makes a healthy crawl look
          // broken.
          summary.skipped += 1;
          return;
        }

        const canonical = canonicalize({
          source: response.bytes,
          url: response.url,
          format: isMarkdown ? 'markdown' : 'html',
        });

        const { outcome, documentId } = await recordFetch(dataSource, {
          url: response.url,
          httpStatus: response.status,
          robotsStatus: 'allowed',
          fetchedAt,
          canonical,
          indexId: options.indexId ?? null,
        });
        summary[outcome] += 1;
        if (documentId) {
          options.onDocument?.({
            requestedUrl: request.url,
            url: response.url,
            documentId,
            outcome,
          });
        }

        if (isMarkdown || options.discover === false) return;
        const links = await discoverLinks(response.bytes, response.url, inScope);
        // Followed links carry no lastmod claim, so they are judged on age
        // alone. Without this a re-crawl re-fetches every page that was found
        // by following a link rather than by reading a sitemap.
        const worth = await dropFreshUrls(
          dataSource,
          links.map((url) => ({ url, lastModified: null })),
          options,
        );
        if (worth.length > 0) await addRequests(worth);
      },
      failedRequestHandler: async ({ request }, error) => {
        // Crawlee has exhausted its retries. The request was made, so it is
        // part of the trail even though nothing usable came back.
        await recordFailedFetch(dataSource, {
          url: request.url,
          httpStatus: null,
          error: error instanceof Error ? error.message : String(error),
          fetchedAt: new Date(),
        });
        summary.failed += 1;
      },
    },
    new Configuration({ persistStorage: false }),
  );

  const discovered = await discoverSeeds(
    options.seeds,
    fetcher,
    inScope,
    options.discover !== false,
  );
  const queue = await dropFreshUrls(dataSource, discovered, options);
  summary.fresh = discovered.length - queue.length;

  await crawler.run(queue);
  return summary;
}

/**
 * Removes URLs there is no reason to fetch again yet.
 *
 * A URL is fetched when we have never seen it, when it was evicted as
 * unindexable, when we last fetched it longer ago than the maximum age, or
 * when its sitemap claims an edit since our fetch. Otherwise it is left alone.
 *
 * `lastmod` is self-reported and frequently a build timestamp rather than a
 * real edit, so it is only believed in the direction that does less work:
 * `lastmod <= fetched_at` means the site is telling us not to bother, and a
 * site that lies that way costs us a stale page rather than a wrong one. The
 * maximum age is the backstop, and it is also the whole policy for the many
 * sites that publish no sitemap at all, or whose pages we found by following
 * links rather than by being told about them. Treating "no claim" as "fetch"
 * instead would mean re-fetching every such page on every run forever.
 *
 * An evicted document is always re-fetched: it has no content left to go
 * stale, and a sitemap has no way to say "it renders again now".
 */
async function dropFreshUrls(
  dataSource: DataSource,
  entries: readonly SitemapEntry[],
  options: CrawlOptions,
): Promise<string[]> {
  if (options.refetchAll || entries.length === 0) return entries.map((entry) => entry.url);

  const maxAgeMs = (options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS) * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - maxAgeMs);

  const rows: { url: string; fetched_at: Date; unindexed_at: Date | null }[] =
    await dataSource.query(
      `SELECT url, fetched_at, unindexed_at FROM documents WHERE url = ANY($1::text[])`,
      [entries.map((entry) => entry.url)],
    );
  const known = new Map(rows.map((row) => [row.url, row]));

  return entries
    .filter((entry) => {
      const existing = known.get(entry.url);
      if (!existing || existing.unindexed_at !== null) return true;

      const fetchedAt = new Date(existing.fetched_at);
      if (fetchedAt < cutoff) return true;
      return entry.lastModified !== null && entry.lastModified > fetchedAt;
    })
    .map((entry) => entry.url);
}

/** Seeds themselves, plus whatever their sitemaps advertise, minus anything out of scope. */
async function discoverSeeds(
  seeds: readonly string[],
  fetcher: Fetcher,
  inScope: (url: string) => Promise<boolean>,
  discover: boolean,
): Promise<SitemapEntry[]> {
  const candidates = new Map<string, SitemapEntry>();

  for (const seed of seeds) {
    // A seed itself carries no lastmod claim, so it is always considered.
    candidates.set(seed, { url: seed, lastModified: null });
    if (!discover) continue;
    const { origin } = new URL(seed);
    const robots = await loadRobots(origin, fetcher);
    for (const entry of await collectSitemapEntries(sitemapsFor(origin, robots), fetcher)) {
      if (!candidates.has(entry.url)) candidates.set(entry.url, entry);
    }
  }

  const allowed: SitemapEntry[] = [];
  for (const candidate of candidates.values()) {
    if (await inScope(candidate.url)) allowed.push(candidate);
  }
  return interleaveEntriesByHost(allowed);
}

/**
 * The sitemaps to read for a host: whatever robots.txt declares, or the
 * conventional location when it declares none.
 *
 * Declaring a sitemap in robots.txt is a convention, not a requirement, and
 * plenty of documentation sites publish one at /sitemap.xml without mentioning
 * it. Reading only declared sitemaps meant a site whose pages are rendered
 * client-side, and so has no anchors to follow either, indexed as its landing
 * page alone: docs.attest.org advertised 106 URLs and we had one of them.
 *
 * The probe is a single request to a conventional path, made with the honest
 * user-agent and only after robots.txt has been read and allows it. A site
 * that has no such file answers 404 and the crawl proceeds as before.
 */
export function sitemapsFor(origin: string, robots: RobotsPolicy): string[] {
  if (robots.sitemaps.length > 0) return [...robots.sitemaps];
  const conventional = new URL('/sitemap.xml', origin).toString();
  return robots.isAllowed(conventional) ? [conventional] : [];
}

/**
 * Round-robins the queue across hosts.
 *
 * Sitemaps are collected seed by seed, so in seed order one large site can
 * supply more URLs than the whole run is allowed to fetch and every later host
 * gets nothing. Interleaving makes a capped crawl a sample of all the seeds
 * rather than an exhaustive crawl of the first one or two.
 */
export function interleaveEntriesByHost(entries: readonly SitemapEntry[]): SitemapEntry[] {
  const order = interleaveByHost(entries.map((entry) => entry.url));
  const byUrl = new Map(entries.map((entry) => [entry.url, entry]));
  return order.map((url) => byUrl.get(url)!);
}

export function interleaveByHost(urls: readonly string[]): string[] {
  const byHost = new Map<string, string[]>();
  for (const url of urls) {
    const { host } = new URL(url);
    const bucket = byHost.get(host);
    if (bucket) bucket.push(url);
    else byHost.set(host, [url]);
  }

  const buckets = [...byHost.values()];
  const interleaved: string[] = [];
  for (let index = 0; interleaved.length < urls.length; index += 1) {
    for (const bucket of buckets) {
      const url = bucket[index];
      if (url !== undefined) interleaved.push(url);
    }
  }
  return interleaved;
}

async function discoverLinks(
  bytes: Uint8Array,
  pageUrl: string,
  inScope: (url: string) => Promise<boolean>,
): Promise<string[]> {
  const dom = new JSDOM(new TextDecoder('utf-8').decode(bytes), { url: pageUrl });
  const hrefs = new Set<string>();

  for (const anchor of dom.window.document.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href');
    if (!href) continue;
    try {
      const resolved = new URL(href, pageUrl);
      resolved.hash = '';
      hrefs.add(resolved.toString());
    } catch {
      // A malformed href is not worth failing the page over.
    }
  }

  const allowed: string[] = [];
  for (const href of hrefs) {
    if (await inScope(href)) allowed.push(href);
  }
  return allowed;
}

/**
 * Serialises requests per host and spaces them out. Crawlee's concurrency limit
 * is global, so a multi-site crawl can otherwise aim every worker at whichever
 * host happens to have the most queued URLs.
 */
export function politely(fetcher: Fetcher, minIntervalMs: number): Fetcher {
  if (minIntervalMs <= 0) return fetcher;
  const turns = new Map<string, Promise<unknown>>();

  return async (url: string) => {
    const { host } = new URL(url);
    const previous = turns.get(host) ?? Promise.resolve();
    const mine = previous
      .catch(() => undefined)
      .then(() => new Promise((resolve) => setTimeout(resolve, minIntervalMs)));
    turns.set(host, mine);
    await mine;
    return fetcher(url);
  };
}
