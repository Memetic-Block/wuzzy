import { Inject, Injectable, Logger } from '@nestjs/common';
import { getAddress } from 'viem';
import { exact } from 'x402/schemes';
import { findMatchingPaymentRequirements, processPriceToAtomicAmount, toJsonSafe } from 'x402/shared';
import {
  SupportedEVMNetworks,
  settleResponseHeader,
  type PaymentPayload,
  type PaymentRequirements,
} from 'x402/types';
import { createFacilitatorConfig } from '@coinbase/x402';
import { useFacilitator } from 'x402/verify';
import { PAYMENT_CONFIG, type PaymentConfig } from './payment.config';

export const X402_VERSION = 1;

export interface PaymentRejection {
  readonly status: 402;
  readonly body: {
    x402Version: number;
    error: string;
    accepts: unknown;
    payer?: string;
  };
}

export interface PaymentAcceptance {
  readonly payload: PaymentPayload;
  readonly requirements: PaymentRequirements;
}

/**
 * What a request is being charged, when it is not the flat per-query price.
 * The quote has to be a pure function of the request body: the client sees it
 * in the 402, signs for exactly that amount, and retries. Anything derived
 * from state that can move in between (a sitemap, a page count discovered by
 * crawling) would quote one price and match against another.
 */
export interface PriceQuote {
  readonly price: string;
  readonly description?: string;
}

/**
 * The paying wallet, taken from the signed authorization rather than from the
 * facilitator's reply: this is the field the payer actually put a signature
 * over, so it is the one that can carry an authorization decision.
 */
export function payerOf(accepted: PaymentAcceptance): string | null {
  const payload = accepted.payload.payload as { authorization?: { from?: unknown } } | undefined;
  const from = payload?.authorization?.from;
  return typeof from === 'string' ? from.toLowerCase() : null;
}

export type PaymentOutcome =
  | { readonly kind: 'open' }
  | { readonly kind: 'accepted'; readonly accepted: PaymentAcceptance }
  | { readonly kind: 'rejected'; readonly rejection: PaymentRejection };

/**
 * The x402 meter for /search. Keyless by design: there are no accounts and no
 * API keys, so payment is the only gate and an agent that holds funds needs
 * nothing provisioned in advance.
 *
 * The flow mirrors the reference x402-express middleware: build requirements,
 * 402 when the header is absent, malformed or unmatched, verify with the
 * facilitator, then settle only after the handler has produced a response.
 */
/**
 * How to reach the facilitator, which is not the same question as where it is.
 *
 * Coinbase's is the one that settles on Base mainnet and it is authenticated,
 * so reaching it means signing each request rather than just knowing a URL.
 * Anything else -- a local facilitator for a fork rehearsal, the demo stack's
 * mock, a test double -- is a bare URL and must not have credentials attached
 * to it, so the two cases are kept apart here rather than merged behind an
 * optional field.
 */
function facilitatorFor(config: PaymentConfig): Parameters<typeof useFacilitator>[0] {
  const url = config.facilitatorUrl as `${string}://${string}`;
  const isCoinbase = url.startsWith('https://api.cdp.coinbase.com/');

  if (!isCoinbase) return { url };
  // With the meter off there is nothing to settle and no credentials to need.
  // The check below is for the case that actually matters: a meter that is on
  // and cannot settle turns every payer away, and finding that out at startup
  // is far better than finding it out from a customer.
  if (!config.enabled) return { url };
  if (!config.cdpApiKeyId || !config.cdpApiKeySecret) {
    throw new Error(
      "Coinbase's facilitator needs X402_CDP_API_KEY_ID and X402_CDP_API_KEY_SECRET. " +
        'Set them, or point X402_FACILITATOR_URL at a facilitator that does not ' +
        'authenticate. Note that the public one at x402.org settles testnets only.',
    );
  }
  // Their config is typed against x402 v2 while this app is on v1, and the two
  // disagree only about whether `url` may be undefined. Keeping the URL this
  // app already validated and borrowing only the request signing avoids
  // casting one whole config into the shape of another.
  const cdp = createFacilitatorConfig(config.cdpApiKeyId, config.cdpApiKeySecret);
  return {
    url,
    // v2 returns each set of headers as optional and v1 requires all three.
    // An absent set means "add nothing", which is what the caller does with
    // it: every one is spread into the request headers.
    createAuthHeaders: async () => {
      const signed = (await cdp.createAuthHeaders?.()) ?? {};
      return {
        verify: signed.verify ?? {},
        settle: signed.settle ?? {},
        supported: signed.supported ?? {},
      };
    },
  };
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly facilitator: ReturnType<typeof useFacilitator>;

  constructor(@Inject(PAYMENT_CONFIG) private readonly config: PaymentConfig) {
    this.facilitator = useFacilitator(facilitatorFor(config));
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  buildRequirements(resourceUrl: string, quote?: PriceQuote): PaymentRequirements[] {
    const atomic = processPriceToAtomicAmount(quote?.price ?? this.config.price, this.config.network);
    if ('error' in atomic) throw new Error(atomic.error);
    const { maxAmountRequired, asset } = atomic;

    // Base is EVM, and only EVM assets carry the EIP-712 domain a client needs
    // in order to sign an `exact` payment.
    if (!SupportedEVMNetworks.includes(this.config.network)) {
      throw new Error(`X402_NETWORK must be an EVM network, got "${this.config.network}"`);
    }

    return [
      {
        scheme: 'exact',
        network: this.config.network,
        maxAmountRequired,
        resource: resourceUrl as `${string}://${string}`,
        description: quote?.description ?? this.config.description,
        mimeType: 'application/json',
        payTo: getAddress(this.config.payTo),
        maxTimeoutSeconds: 60,
        asset: getAddress(asset.address),
        outputSchema: { input: { type: 'http', method: 'POST', discoverable: true } },
        extra: 'eip712' in asset ? asset.eip712 : undefined,
      },
    ];
  }

  /** Decides whether a request may proceed, without touching the handler. */
  async authorize(
    header: string | undefined,
    resourceUrl: string,
    quote?: PriceQuote,
  ): Promise<PaymentOutcome> {
    if (!this.config.enabled) return { kind: 'open' };

    const requirements = this.buildRequirements(resourceUrl, quote);
    const reject = (error: string, payer?: string): PaymentOutcome => ({
      kind: 'rejected',
      rejection: {
        status: 402,
        body: {
          x402Version: X402_VERSION,
          error,
          accepts: toJsonSafe(requirements),
          ...(payer ? { payer } : {}),
        },
      },
    });

    if (!header) return reject('X-PAYMENT header is required');

    let payload: PaymentPayload;
    try {
      payload = exact.evm.decodePayment(header);
      payload.x402Version = X402_VERSION;
    } catch (error) {
      return reject(error instanceof Error ? error.message : 'Invalid or malformed payment header');
    }

    const selected = findMatchingPaymentRequirements(requirements, payload);
    if (!selected) return reject('Unable to find matching payment requirements');

    try {
      const response = await this.facilitator.verify(payload, selected);
      if (!response.isValid) {
        return reject(response.invalidReason ?? 'Payment verification failed', response.payer);
      }
    } catch (error) {
      return reject(error instanceof Error ? error.message : 'Payment verification failed');
    }

    return { kind: 'accepted', accepted: { payload, requirements: selected } };
  }

  /**
   * Settles after the handler succeeded, so a failed query is never charged for.
   * Returns the X-PAYMENT-RESPONSE header value, or null if settlement failed.
   */
  async settle(accepted: PaymentAcceptance): Promise<string | null> {
    try {
      const response = await this.facilitator.settle(accepted.payload, accepted.requirements);
      return settleResponseHeader(response);
    } catch (error) {
      this.logger.error(`settlement failed: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }
}
