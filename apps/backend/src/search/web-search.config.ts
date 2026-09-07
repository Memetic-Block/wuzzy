export interface WebSearchConfig {
  /**
   * Opt-in, unlike the meter's opt-out. A free route beside a metered one
   * gives the index away, so forgetting to set anything must leave it closed.
   */
  readonly enabled: boolean;
  /** Origins allowed to call this from a browser. The public site, normally. */
  readonly origins: readonly string[];
  readonly limit: number;
  readonly windowMs: number;
  /**
   * Trusted proxies in front of this process, used to pick the client address
   * out of X-Forwarded-For. One for nginx alone; zero when nothing fronts it.
   */
  readonly proxyHops: number;
  /** How long a shared cache may reuse a response, in seconds. */
  readonly cacheSeconds: number;
}

export const WEB_SEARCH_CONFIG = Symbol('WEB_SEARCH_CONFIG');

export function buildWebSearchConfig(
  env: Record<string, string | undefined> = process.env,
): WebSearchConfig {
  return {
    enabled: env.WEB_SEARCH_ENABLED === 'true',
    origins: (env.WEB_SEARCH_ORIGINS ?? 'https://wuzzy.io')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    limit: Number(env.WEB_SEARCH_RATE_LIMIT ?? 10),
    windowMs: Number(env.WEB_SEARCH_RATE_WINDOW_MS ?? 60_000),
    proxyHops: Number(env.WEB_SEARCH_PROXY_HOPS ?? 1),
    cacheSeconds: Number(env.WEB_SEARCH_CACHE_SECONDS ?? 60),
  };
}
