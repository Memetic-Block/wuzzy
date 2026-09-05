export interface IndexesConfig {
  /** Slug of the index an unscoped /search targets. */
  readonly globalSlug: string;
  /**
   * Owner of the global index, lowercased. The operator wallet is
   * configuration rather than schema, so the migration seeds the row ownerless
   * and the service reconciles it against this on boot.
   */
  readonly operatorWallet: string | null;
  /** Maximum pages a commissioned index may hold. */
  readonly pageCap: number;
  /** Price per page for creation and appends, as a USD string. */
  readonly pricePerPage: string;
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
    // The cap exists so a single payment cannot commission a crawl big enough
    // to be impolite to the sites it targets. Per-host request spacing is what
    // actually keeps the crawl polite, so this is really a ceiling on what one
    // payment can set off, and 1000 pages is $10 at the default per-page price.
    pageCap: Number(env.WUZZY_INDEX_PAGE_CAP ?? 1000),
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
