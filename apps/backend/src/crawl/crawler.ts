import { BasicCrawler, Configuration } from '@crawlee/basic';
import type { DataSource } from 'typeorm';
import { JSDOM } from 'jsdom';
import { canonicalize } from '../canonicalize/v1';
import { createFetcher, type Fetcher } from './http';
import { loadRobots, type RobotsPolicy } from './robots';
import { recordFetch, type FetchOutcome } from './provenance';
import { collectSitemapUrls } from './sitemap';
import { userAgent } from './user-agent';

export interface CrawlOptions {
  readonly seeds: readonly string[];
  readonly maxRequests?: number;
  readonly maxConcurrency?: number;
  /** Injected by tests; production uses the honest fetcher. */
  readonly fetcher?: Fetcher;
}

export type CrawlSummary = Record<FetchOutcome | 'failed', number>;

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
  const summary: CrawlSummary = { created: 0, unchanged: 0, changed: 0, skipped: 0, failed: 0 };

  // Declared before `inScope` so the guard can close over it; robots.txt and
  // sitemaps are fetched without a guard, since robots cannot gate the request
  // that fetches robots.
  const scopeGuard = async (url: string): Promise<boolean> => inScope(url);
  const fetcher = options.fetcher ?? createFetcher(agent);
  const pageFetcher = options.fetcher ?? createFetcher(agent, scopeGuard);

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
  const inScope = async (url: string): Promise<boolean> => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (!allowedHosts.has(parsed.host)) return false;
    return (await policyFor(url)).isAllowed(url);
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
          summary.failed += 1;
          return;
        }

        const contentType = response.contentType ?? '';
        const isMarkdown = MARKDOWN_LIKE.test(contentType);
        if (!isMarkdown && !HTML_LIKE.test(contentType)) {
          summary.failed += 1;
          return;
        }

        const canonical = canonicalize({
          source: response.bytes,
          url: response.url,
          format: isMarkdown ? 'markdown' : 'html',
        });

        const { outcome } = await recordFetch(dataSource, {
          url: response.url,
          httpStatus: response.status,
          robotsStatus: 'allowed',
          fetchedAt,
          canonical,
        });
        summary[outcome] += 1;

        if (isMarkdown) return;
        const links = await discoverLinks(response.bytes, response.url, inScope);
        if (links.length > 0) await addRequests(links);
      },
      failedRequestHandler: async () => {
        summary.failed += 1;
      },
    },
    new Configuration({ persistStorage: false }),
  );

  await crawler.run(await discoverSeeds(options.seeds, fetcher, inScope));
  return summary;
}

/** Seeds themselves, plus whatever their sitemaps advertise, minus anything out of scope. */
async function discoverSeeds(
  seeds: readonly string[],
  fetcher: Fetcher,
  inScope: (url: string) => Promise<boolean>,
): Promise<string[]> {
  const candidates = new Set<string>();

  for (const seed of seeds) {
    candidates.add(seed);
    const robots = await loadRobots(new URL(seed).origin, fetcher);
    for (const url of await collectSitemapUrls(robots.sitemaps, fetcher)) {
      candidates.add(url);
    }
  }

  const allowed: string[] = [];
  for (const candidate of candidates) {
    if (await inScope(candidate)) allowed.push(candidate);
  }
  return allowed;
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
