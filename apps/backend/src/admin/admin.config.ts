export interface AdminConfig {
  /** Off unless explicitly enabled. The admin view reads operational detail. */
  readonly enabled: boolean;
  /** When set, requests must carry it as `x-admin-token`. */
  readonly token: string | null;
}

export const ADMIN_CONFIG = Symbol('ADMIN_CONFIG');

export function buildAdminConfig(
  env: Record<string, string | undefined> = process.env,
): AdminConfig {
  return {
    // Opt-in, unlike the meter: forgetting a flag must not publish crawl
    // errors, fetch history and skip reasons to anyone who guesses the path.
    enabled: env.ADMIN_ENABLED === 'true',
    // Trimmed, because this arrives through a secret store and a template
    // renderer before it reaches the process, and either can leave a trailing
    // newline on it. An untrimmed token then never matches the value an
    // operator copied out of Vault, the comparison is constant-time and says
    // only "missing or wrong", and the whitespace is invisible from both ends.
    // Nobody wants a token whose leading or trailing spaces are load-bearing.
    token: env.ADMIN_TOKEN?.trim() || null,
  };
}
