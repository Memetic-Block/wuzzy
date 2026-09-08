export interface IndexesConfig {
  /** Slug of the index an unscoped /search targets. */
  readonly globalSlug: string;
  /**
   * Owner of the global index, lowercased. The operator wallet is
   * configuration rather than schema, so the migration seeds the row ownerless
   * and the service reconciles it against this on boot.
   */
  readonly operatorWallet: string | null;
  /**
   * Maximum URLs one request may carry. A transport bound, not a product one:
   * the body is parsed before the payment is checked, so this is what limits
   * what an unpaid caller can make the server read. Asking for more is not
   * refused, it is split across requests.
   */
  readonly requestUrlLimit: number;
  /**
   * Maximum pages an index may hold in total, or null for no limit.
   *
   * Null by default, because there is no reason to stop someone buying more
   * of what they are paying for. It exists so a specific index can be bounded
   * deliberately, and it is stored per index so raising the default later does
   * not silently raise it for indexes commissioned under the old one.
   */
  readonly indexPageCap: number | null;
  /** Price per page for creation and appends, as a USD string. */
  readonly pricePerPage: string;
}

/**
 * How large a request body the API will parse, derived from how many URLs one
 * request may carry. These two are the same question asked twice, so deriving
 * one from the other keeps them from disagreeing: a limit of N URLs that
 * rejects N URLs as too large is a bare 413 mentioning neither.
 *
 * 512 bytes a URL is roughly five times the average in practice.
 */
export function requestBodyLimit(requestUrlLimit: number): string {
  const bytes = requestUrlLimit * 512 + 64 * 1024;
  return `${Math.ceil(bytes / (1024 * 1024))}mb`;
}

export const INDEXES_CONFIG = Symbol('INDEXES_CONFIG');

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function buildIndexesConfig(
  env: Record<string, string | undefined> = process.env,
): IndexesConfig {
  const wallet = env.WUZZY_OPERATOR_WALLET?.trim();
  return {
    globalSlug: env.WUZZY_GLOBAL_INDEX_SLUG ?? 'global',
    operatorWallet: wallet ? wallet.toLowerCase() : null,
    // How much one request may carry, which is a question about parsing and
    // not about money. A larger index is bought by asking again.
    requestUrlLimit: Number(env.WUZZY_INDEX_REQUEST_URL_LIMIT ?? 2_000),
    // Unbounded by default. Politeness is enforced by per-host request
    // spacing in the crawler, not by refusing to sell someone a large index.
    indexPageCap: env.WUZZY_INDEX_PAGE_CAP ? Number(env.WUZZY_INDEX_PAGE_CAP) : null,
    pricePerPage: env.WUZZY_INDEX_PRICE_PER_PAGE ?? '$0.01',
  };
}

/**
 * USD arithmetic in micro-dollars, which is USDC's own precision. Prices are
 * quoted in a 402 and then signed for exactly, so a per-page price multiplied
 * in floating point could quote a total the client cannot reproduce.
 */
const MICROS_PER_USD = 1_000_000n;

export function parseUsdMicros(value: string): bigint {
  const cleaned = value.trim().replace(/^\$/, '');
  if (!/^\d+(\.\d{1,6})?$/.test(cleaned)) throw new Error(`not a USD amount: "${value}"`);
  const [whole, fraction = ''] = cleaned.split('.');
  return BigInt(whole!) * MICROS_PER_USD + BigInt(fraction.padEnd(6, '0'));
}

export function formatUsdMicros(micros: bigint): string {
  const whole = micros / MICROS_PER_USD;
  const fraction = (micros % MICROS_PER_USD).toString().padStart(6, '0');
  // Two decimals minimum so the string reads as money, more only when the
  // amount actually needs them.
  const trimmed = fraction.replace(/0+$/, '').padEnd(2, '0');
  return `$${whole}.${trimmed}`;
}

/** Total price for `pages` pages, as a string the x402 helpers parse. */
export function priceForPages(pricePerPage: string, pages: number): string {
  return formatUsdMicros(parseUsdMicros(pricePerPage) * BigInt(pages));
}
