import { RobotsTxtFile } from 'crawlee';
import type { Fetcher } from './http';
import { ROBOTS_AGENT } from './user-agent';

export interface RobotsPolicy {
  /** Evaluated against the WuzzyBot group, never the wildcard group. */
  isAllowed(url: string): boolean;
  readonly sitemaps: readonly string[];
}

/** Nothing was disallowed because nothing could be read. */
const permissive = (): RobotsPolicy => ({ isAllowed: () => true, sitemaps: [] });

/**
 * Loads and evaluates a site's robots.txt.
 *
 * Two Crawlee defaults are deliberately not used here. Its crawler-level
 * `respectRobotsTxtFile: true` matches rules against `*` rather than the agent
 * being sent, and its own robots fetch goes out with a browser-like
 * user-agent. So the file is fetched through our fetcher, which carries the
 * honest agent, and every check names ROBOTS_AGENT explicitly.
 */
export async function loadRobots(origin: string, fetcher: Fetcher): Promise<RobotsPolicy> {
  const robotsUrl = new URL('/robots.txt', origin).toString();

  let content: string;
  try {
    const response = await fetcher(robotsUrl);
    // A site with no robots.txt allows everything; so does one that errors. A
    // 5xx is the ambiguous case, and erring toward not crawling is the
    // conservative reading.
    if (response.status >= 500) return { isAllowed: () => false, sitemaps: [] };
    if (response.status !== 200) return permissive();
    content = new TextDecoder('utf-8').decode(response.bytes);
  } catch {
    return permissive();
  }

  const parsed = RobotsTxtFile.from(robotsUrl, content);
  return {
    isAllowed: (url: string) => parsed.isAllowed(url, ROBOTS_AGENT),
    sitemaps: parsed.getSitemaps(),
  };
}
