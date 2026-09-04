/**
 * The crawler's identity. Wuzzy crawls in the open: this string goes out on
 * every request the process makes, robots.txt and sitemaps included.
 *
 * Impersonating a browser is out of bounds permanently, not merely discouraged
 * (see CLAUDE.md), so the value is validated rather than trusted.
 */
export const DEFAULT_USER_AGENT = 'WuzzyBot/1.0 (+https://wuzzy.io/bot)';

/** The token robots.txt groups are matched against. */
export const ROBOTS_AGENT = 'WuzzyBot';

const BROWSER_TELLS = ['mozilla', 'chrome', 'safari', 'gecko', 'webkit', 'edge/', 'opera'];

export class DishonestUserAgentError extends Error {}

/**
 * Rejects a user-agent that hides what it is. A crawler that misconfigures this
 * should fail to start rather than crawl anonymously for a whole run.
 */
export function assertHonestUserAgent(candidate: string): void {
  const value = candidate.trim();
  if (value === '') {
    throw new DishonestUserAgentError('user-agent is empty');
  }
  if (!value.toLowerCase().startsWith(ROBOTS_AGENT.toLowerCase())) {
    throw new DishonestUserAgentError(
      `user-agent must start with "${ROBOTS_AGENT}", got "${value}"`,
    );
  }
  const tell = BROWSER_TELLS.find((t) => value.toLowerCase().includes(t));
  if (tell) {
    throw new DishonestUserAgentError(
      `user-agent must not impersonate a browser, found "${tell}" in "${value}"`,
    );
  }
}

export function userAgent(env: Record<string, string | undefined> = process.env): string {
  const value = env.WUZZY_USER_AGENT ?? DEFAULT_USER_AGENT;
  assertHonestUserAgent(value);
  return value;
}
