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
  readonly description: string;
}

/** Base mainnet's facilitator. Overridden for tests and for base-sepolia. */
const DEFAULT_FACILITATOR = 'https://x402.org/facilitator';

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
    description: env.X402_DESCRIPTION ?? 'One Wuzzy search query with onchain provenance',
  };
}

export const PAYMENT_CONFIG = Symbol('PAYMENT_CONFIG');
