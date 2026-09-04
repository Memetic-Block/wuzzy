import type { Fetcher } from './http';

const LOC = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi;
const IS_INDEX = /<sitemapindex[\s>]/i;

/** How deep a sitemap index may nest before we stop following it. */
const MAX_DEPTH = 3;

/**
 * Collects page URLs from a sitemap, following sitemap indexes.
 *
 * Parsed here rather than through Crawlee's Sitemap helper because that helper
 * fetches nested sitemaps itself, and every request this crawler makes has to
 * carry the honest user-agent. Owning the fetch is what makes that checkable.
 */
export async function collectSitemapUrls(
  sitemapUrls: readonly string[],
  fetcher: Fetcher,
  depth = 0,
): Promise<string[]> {
  if (depth > MAX_DEPTH) return [];

  const found: string[] = [];
  for (const sitemapUrl of sitemapUrls) {
    let xml: string;
    try {
      const response = await fetcher(sitemapUrl);
      if (response.status !== 200) continue;
      xml = new TextDecoder('utf-8').decode(response.bytes);
    } catch {
      continue;
    }

    const locations = [...xml.matchAll(LOC)]
      .map((match) => match[1]?.trim())
      .filter((value): value is string => Boolean(value))
      .map(decodeXmlEntities);

    if (IS_INDEX.test(xml)) {
      found.push(...(await collectSitemapUrls(locations, fetcher, depth + 1)));
    } else {
      found.push(...locations);
    }
  }
  return [...new Set(found)];
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
