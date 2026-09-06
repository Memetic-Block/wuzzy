import type { Fetcher } from './http';

/**
 * `<url>` entries, so a `<lastmod>` stays attached to the `<loc>` it belongs
 * to. Matching them independently would pair them by accident of ordering.
 */
const URL_ENTRY = /<url\b[^>]*>([\s\S]*?)<\/url>/gi;
const LOC = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/i;
const LASTMOD = /<lastmod>\s*([^<\s][^<]*?)\s*<\/lastmod>/i;
/** Sitemap indexes list sitemaps, not pages, so their locs are followed instead. */
const ALL_LOCS = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi;
const IS_INDEX = /<sitemapindex[\s>]/i;

/** How deep a sitemap index may nest before we stop following it. */
const MAX_DEPTH = 3;

export interface SitemapEntry {
  readonly url: string;
  /**
   * What the site claims about when this page last changed, or null when it
   * says nothing. Self-reported and often a build timestamp rather than a real
   * edit, so it is only ever trusted in the direction that does less work.
   */
  readonly lastModified: Date | null;
}

/**
 * Collects page entries from a sitemap, following sitemap indexes.
 *
 * Parsed here rather than through Crawlee's Sitemap helper because that helper
 * fetches nested sitemaps itself, and every request this crawler makes has to
 * carry the honest user-agent. Owning the fetch is what makes that checkable.
 */
export async function collectSitemapEntries(
  sitemapUrls: readonly string[],
  fetcher: Fetcher,
  depth = 0,
): Promise<SitemapEntry[]> {
  if (depth > MAX_DEPTH) return [];

  const found = new Map<string, SitemapEntry>();
  for (const sitemapUrl of sitemapUrls) {
    let xml: string;
    try {
      const response = await fetcher(sitemapUrl);
      if (response.status !== 200) continue;
      xml = new TextDecoder('utf-8').decode(response.bytes);
    } catch {
      continue;
    }

    if (IS_INDEX.test(xml)) {
      const nested = [...xml.matchAll(ALL_LOCS)]
        .map((match) => match[1]?.trim())
        .filter((value): value is string => Boolean(value))
        .map(decodeXmlEntities);
      for (const entry of await collectSitemapEntries(nested, fetcher, depth + 1)) {
        found.set(entry.url, entry);
      }
      continue;
    }

    for (const [, block] of xml.matchAll(URL_ENTRY)) {
      const loc = LOC.exec(block ?? '')?.[1];
      if (!loc) continue;
      found.set(decodeXmlEntities(loc.trim()), {
        url: decodeXmlEntities(loc.trim()),
        lastModified: parseLastModified(LASTMOD.exec(block ?? '')?.[1]),
      });
    }
  }
  return [...found.values()];
}

/** Sitemaps carry W3C datetimes: a bare date, or a full timestamp with a zone. */
function parseLastModified(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
