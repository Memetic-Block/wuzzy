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
    token: env.ADMIN_TOKEN ?? null,
  };
}
