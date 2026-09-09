/**
 * The few facts in llms.txt that are not derived from the meter or the
 * request: where a reader goes next, and how to reach a person.
 *
 * Configured rather than written into the file so a fork or a stage deploy
 * does not publish this deployment's contact address as its own.
 */
export interface DiscoveryConfig {
  /** In plain text, because the readers of this file are programs. */
  readonly contact: string;
  readonly docsUrl: string;
  readonly repoUrl: string;
}

export const DISCOVERY_CONFIG = Symbol('DISCOVERY_CONFIG');

export function buildDiscoveryConfig(
  env: Record<string, string | undefined> = process.env,
): DiscoveryConfig {
  return {
    contact: env.WUZZY_CONTACT ?? 'build@wuzzy.io',
    docsUrl: env.DOCS_ORIGIN ?? 'https://docs.wuzzy.io',
    repoUrl: env.WUZZY_REPO_URL ?? 'https://github.com/Memetic-Block/wuzzy',
  };
}
