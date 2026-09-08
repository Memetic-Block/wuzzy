import type { Network } from 'x402/types';

export interface PaymentConfig {
  /** When false, /search is open. Only ever set false in development. */
  readonly enabled: boolean;
  /** Receiving address. A fresh address, funded by nobody, holding no keys here. */
  readonly payTo: string;
  readonly network: Network;
  /** Price per query, as a USD string the x402 helpers parse, e.g. "$0.01". */
  readonly price: string;
  readonly facilitatorUrl: string;
  /** Required by Coinbase's facilitator; unused by a local or mock one. */
  readonly cdpApiKeyId?: string;
  readonly cdpApiKeySecret?: string;
  readonly description: string;
}

/**
 * Coinbase's facilitator, which is the one that settles on Base mainnet.
 *
 * The obvious-looking public endpoint at x402.org does NOT: asking it what it
 * supports returns base-sepolia and a list of other testnets, and no
 * `eip155:8453`. Pointing a mainnet deployment at it produces a meter that
 * 402s forever, which looks like a payment bug rather than a configuration
 * one. It was this project's default until that was checked.
 *
 * This endpoint needs credentials, so `X402_CDP_API_KEY_ID` and
 * `X402_CDP_API_KEY_SECRET` are required alongside it. Overriding
 * `X402_FACILITATOR_URL` bypasses both, which is how the fork rehearsal and
 * the demo stack point at a local one.
 */
const DEFAULT_FACILITATOR = 'https://api.cdp.coinbase.com/platform/v2/x402';

export function buildPaymentConfig(
  env: Record<string, string | undefined> = process.env,
): PaymentConfig {
  return {
    // Opt-out rather than opt-in: forgetting to set the flag must not
    // accidentally give the index away.
    enabled: env.X402_ENABLED !== 'false',
    payTo: env.X402_PAY_TO ?? '0x0000000000000000000000000000000000000000',
    network: (env.X402_NETWORK ?? 'base') as Network,
    price: env.X402_PRICE ?? '$0.01',
    facilitatorUrl: env.X402_FACILITATOR_URL ?? DEFAULT_FACILITATOR,
    cdpApiKeyId: env.X402_CDP_API_KEY_ID,
    cdpApiKeySecret: env.X402_CDP_API_KEY_SECRET,
    description: env.X402_DESCRIPTION ?? 'One Wuzzy search query with onchain provenance',
  };
}

export const PAYMENT_CONFIG = Symbol('PAYMENT_CONFIG');
