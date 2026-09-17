import { Inject, Injectable, Logger } from '@nestjs/common';
import { getAddress } from 'viem';
import { createFacilitatorConfig } from '@coinbase/x402';
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from '@x402/core/http';
import {
  PaymentPayloadV1Schema,
  PaymentPayloadV2Schema,
  type PaymentPayloadV1,
  type PaymentPayloadV2,
  type PaymentRequirementsV1,
} from '@x402/core/schemas';
import {
  HTTPFacilitatorClient,
  PAYMENT_REQUIRED_CACHE_CONTROL,
  type FacilitatorConfig,
} from '@x402/core/server';
import {
  VerifyError,
  type PaymentRequirements,
  type ResourceInfo,
  type SettleResponse,
  type VerifyResponse,
} from '@x402/core/types';
import { deepEqual } from '@x402/core/utils';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { EVM_NETWORK_CHAIN_ID_MAP } from '@x402/evm/v1';
import { PAYMENT_CONFIG, type PaymentConfig } from './payment.config';

export interface PaymentRejection {
  readonly status: 402;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: {
    x402Version: number;
    error: string;
    accepts: unknown;
    payer?: string;
  };
}

/**
 * A verified payment, kept in the protocol version it was signed in so that
 * settlement is reported back in that version too.
 */
export type PaymentAcceptance =
  | {
      readonly x402Version: 1;
      readonly payload: PaymentPayloadV1;
      readonly requirements: PaymentRequirementsV1;
    }
  | {
      readonly x402Version: 2;
      readonly payload: PaymentPayloadV2;
      readonly requirements: PaymentRequirements;
    };

/** The same quote, stated once for each protocol version this meter answers. */
export interface PaymentOffer {
  readonly v1: PaymentRequirementsV1[];
  readonly v2: PaymentRequirements[];
  readonly resource: ResourceInfo;
}

/** Where a payment arrives: the request's headers, read by name. */
export interface PaymentHeaders {
  header(name: string): string | undefined;
}

/** A request that carries no payment, for asking the meter what it would charge. */
export const UNPAID: PaymentHeaders = { header: () => undefined };

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
 * The URL a 402 names as the thing being paid for.
 *
 * Behind Traefik and Cloudflare the socket is plain HTTP, so `request.protocol`
 * reports `http` for a resource every client reached over TLS and the 402
 * advertises a URL that is not the one anybody called. The forwarding header is
 * read directly rather than by enabling Express's `trust proxy`, because that
 * also redefines `request.ip`, and the web-search rate limiter counts hops from
 * the right of `x-forwarded-for` itself with `request.ip` as its fallback.
 * Changing what that fallback means would key every visitor on one bucket, and
 * it would do it silently.
 *
 * Cloudflare in front of Traefik can send `https,https`, so only the first
 * entry is a scheme.
 */
export function resourceUrl(request: {
  protocol: string;
  path: string;
  header(name: string): string | undefined;
  get(name: string): string | undefined;
}): string {
  const forwarded = request.header('x-forwarded-proto')?.split(',')[0]?.trim();
  const scheme = forwarded || request.protocol;
  return `${scheme}://${request.get('host') ?? 'localhost'}${request.path}`;
}

/**
 * The paying wallet, taken from the signed authorization rather than from the
 * facilitator's reply: this is the field the payer actually put a signature
 * over, so it is the one that can carry an authorization decision. An `exact`
 * EVM payment carries it in the same place in both protocol versions.
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
function facilitatorFor(config: PaymentConfig): FacilitatorConfig {
  const url = config.facilitatorUrl;
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
  // Keep the URL this app already validated and borrow only the request
  // signing: their config leaves `url` optional and would fall back to a
  // default of its own.
  const { createAuthHeaders } = createFacilitatorConfig(config.cdpApiKeyId, config.cdpApiKeySecret);
  return { url, createAuthHeaders };
}

/**
 * The facilitator client is typed for x402 v2 payloads, but it posts whatever
 * it is given and names the protocol version the payload itself carries, which
 * is all a facilitator needs to verify a v1 payment.
 */
interface Facilitator {
  verify(
    payload: PaymentAcceptance['payload'],
    requirements: PaymentAcceptance['requirements'],
  ): Promise<VerifyResponse>;
  settle(
    payload: PaymentAcceptance['payload'],
    requirements: PaymentAcceptance['requirements'],
  ): Promise<SettleResponse>;
}

/** A payment header's JSON, or undefined when it is not base64 JSON at all. */
function decodeHeader(header: string): unknown {
  try {
    return decodePaymentSignatureHeader(header);
  } catch {
    return undefined;
  }
}

/**
 * The header a payment arrives in is its version. A payload that claims the
 * other version is refused here, before any facilitator sees it, rather than
 * rewritten to fit.
 */
function readV1(header: string, offer: PaymentOffer): PaymentAcceptance | string {
  const decoded = PaymentPayloadV1Schema.safeParse(decodeHeader(header));
  if (!decoded.success) return 'X-PAYMENT does not carry an x402 version 1 payment';
  const payload = decoded.data;

  const requirements = offer.v1.find(
    (candidate) => candidate.scheme === payload.scheme && candidate.network === payload.network,
  );
  if (!requirements) return 'Unable to find matching payment requirements';
  return { x402Version: 1, payload, requirements };
}

/**
 * v2 states which requirements the payer accepted, so the whole quote is
 * compared rather than its scheme and network: a payment signed for another
 * amount or recipient is not a payment for this request. A client may add to
 * `extra`, so only the fields we offered have to be there.
 */
function readV2(header: string, offer: PaymentOffer): PaymentAcceptance | string {
  const decoded = PaymentPayloadV2Schema.safeParse(decodeHeader(header));
  if (!decoded.success) return 'PAYMENT-SIGNATURE does not carry an x402 version 2 payment';
  const payload = decoded.data;
  const { extra: acceptedExtra, ...accepted } = payload.accepted;

  const requirements = offer.v2.find(({ extra, ...offered }) => {
    if (!deepEqual(offered, accepted)) return false;
    return Object.entries(extra).every(([key, value]) => deepEqual(value, acceptedExtra?.[key]));
  });
  if (!requirements) return 'Unable to find matching payment requirements';
  return { x402Version: 2, payload, requirements };
}

/**
 * The CAIP-2 identifier for a v1 network name. Only EVM networks carry the
 * EIP-712 domain a client needs in order to sign an `exact` payment, so a name
 * with no chain id is a configuration error rather than a network to skip.
 */
function chainOf(network: string): `eip155:${number}` {
  const chainId = (EVM_NETWORK_CHAIN_ID_MAP as Record<string, number>)[network];
  if (chainId === undefined) {
    throw new Error(`X402_NETWORK must be an EVM network, got "${network}"`);
  }
  return `eip155:${chainId}`;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly facilitator: Facilitator;
  private readonly chain: `eip155:${number}`;
  private readonly exact = new ExactEvmScheme();

  constructor(@Inject(PAYMENT_CONFIG) private readonly config: PaymentConfig) {
    this.facilitator = new HTTPFacilitatorClient(facilitatorFor(config)) as unknown as Facilitator;
    this.chain = chainOf(config.network);
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Both versions are built from one parsed price, so a v1 and a v2 client
   * asking about the same request cannot be quoted different amounts.
   */
  async buildRequirements(resourceUrl: string, quote?: PriceQuote): Promise<PaymentOffer> {
    const price = await this.exact.parsePrice(quote?.price ?? this.config.price, this.chain);
    const description = quote?.description ?? this.config.description;
    const payTo = getAddress(this.config.payTo);
    const asset = getAddress(price.asset);
    const extra = price.extra ?? {};

    return {
      v1: [
        {
          scheme: 'exact',
          network: this.config.network,
          maxAmountRequired: price.amount,
          resource: resourceUrl,
          description,
          mimeType: 'application/json',
          payTo,
          maxTimeoutSeconds: 60,
          asset,
          outputSchema: { input: { type: 'http', method: 'POST', discoverable: true } },
          extra,
        },
      ],
      v2: [
        {
          scheme: 'exact',
          network: this.chain,
          amount: price.amount,
          asset,
          payTo,
          maxTimeoutSeconds: 60,
          extra,
        },
      ],
      resource: { url: resourceUrl, description, mimeType: 'application/json' },
    };
  }

  /** Decides whether a request may proceed, without touching the handler. */
  async authorize(
    request: PaymentHeaders,
    resourceUrl: string,
    quote?: PriceQuote,
  ): Promise<PaymentOutcome> {
    if (!this.config.enabled) return { kind: 'open' };

    const offer = await this.buildRequirements(resourceUrl, quote);
    const reject = (error: string, payer?: string): PaymentOutcome => ({
      kind: 'rejected',
      rejection: {
        status: 402,
        // Every 402 answers both versions at once. A v2 client reads this header
        // before it looks at the body, and a v1 client only knows the body, so
        // neither has to be told which version this server speaks.
        headers: {
          'PAYMENT-REQUIRED': encodePaymentRequiredHeader({
            x402Version: 2,
            error,
            resource: offer.resource,
            accepts: offer.v2,
          }),
          'Cache-Control': PAYMENT_REQUIRED_CACHE_CONTROL,
        },
        body: {
          x402Version: 1,
          error,
          accepts: offer.v1,
          ...(payer ? { payer } : {}),
        },
      },
    });

    const v1 = request.header('X-PAYMENT');
    const v2 = request.header('PAYMENT-SIGNATURE');
    if (v1 && v2) return reject('Send X-PAYMENT or PAYMENT-SIGNATURE, not both');
    if (!v1 && !v2) return reject('X-PAYMENT or PAYMENT-SIGNATURE header is required');

    const accepted = v1 ? readV1(v1, offer) : readV2(v2!, offer);
    if (typeof accepted === 'string') return reject(accepted);

    try {
      const response = await this.facilitator.verify(accepted.payload, accepted.requirements);
      if (!response.isValid) {
        return reject(response.invalidReason ?? 'Payment verification failed', response.payer);
      }
    } catch (error) {
      // A facilitator that refuses with a non-200 still names its reason.
      if (error instanceof VerifyError) {
        return reject(error.invalidReason ?? error.message, error.payer);
      }
      return reject(error instanceof Error ? error.message : 'Payment verification failed');
    }

    return { kind: 'accepted', accepted };
  }

  /**
   * Settles after the handler succeeded, so a failed query is never charged for.
   * Returns the headers that report the settlement to the payer, which are none
   * if settlement failed.
   */
  async settle(accepted: PaymentAcceptance): Promise<Record<string, string>> {
    try {
      const response = await this.facilitator.settle(accepted.payload, accepted.requirements);
      const header = accepted.x402Version === 2 ? 'PAYMENT-RESPONSE' : 'X-PAYMENT-RESPONSE';
      return { [header]: encodePaymentResponseHeader(response) };
    } catch (error) {
      this.logger.error(`settlement failed: ${error instanceof Error ? error.message : error}`);
      return {};
    }
  }
}
