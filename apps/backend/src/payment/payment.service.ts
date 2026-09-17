import { Inject, Injectable, Logger } from '@nestjs/common';
import { getAddress } from 'viem';
import { createFacilitatorConfig } from '@coinbase/x402';
import { decodePaymentSignatureHeader, encodePaymentResponseHeader } from '@x402/core/http';
import {
  PaymentPayloadV1Schema,
  type PaymentPayloadV1,
  type PaymentRequirementsV1,
} from '@x402/core/schemas';
import { HTTPFacilitatorClient, type FacilitatorConfig } from '@x402/core/server';
import { VerifyError, type SettleResponse, type VerifyResponse } from '@x402/core/types';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { EVM_NETWORK_CHAIN_ID_MAP } from '@x402/evm/v1';
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
  readonly payload: PaymentPayloadV1;
  readonly requirements: PaymentRequirementsV1;
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
  verify(payload: PaymentPayloadV1, requirements: PaymentRequirementsV1): Promise<VerifyResponse>;
  settle(payload: PaymentPayloadV1, requirements: PaymentRequirementsV1): Promise<SettleResponse>;
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

  async buildRequirements(resourceUrl: string, quote?: PriceQuote): Promise<PaymentRequirementsV1[]> {
    const { amount, asset, extra } = await this.exact.parsePrice(
      quote?.price ?? this.config.price,
      this.chain,
    );

    return [
      {
        scheme: 'exact',
        network: this.config.network,
        maxAmountRequired: amount,
        resource: resourceUrl,
        description: quote?.description ?? this.config.description,
        mimeType: 'application/json',
        payTo: getAddress(this.config.payTo),
        maxTimeoutSeconds: 60,
        asset: getAddress(asset),
        outputSchema: { input: { type: 'http', method: 'POST', discoverable: true } },
        extra: extra ?? {},
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

    const requirements = await this.buildRequirements(resourceUrl, quote);
    const reject = (error: string, payer?: string): PaymentOutcome => ({
      kind: 'rejected',
      rejection: {
        status: 402,
        body: {
          x402Version: X402_VERSION,
          error,
          accepts: requirements,
          ...(payer ? { payer } : {}),
        },
      },
    });

    if (!header) return reject('X-PAYMENT header is required');

    let payload: PaymentPayloadV1;
    try {
      const decoded = PaymentPayloadV1Schema.safeParse(decodePaymentSignatureHeader(header));
      if (!decoded.success) return reject('X-PAYMENT does not carry an x402 version 1 payment');
      payload = decoded.data;
    } catch {
      // The parser's message quotes the bytes it choked on, which for a header
      // that was never JSON are not text worth putting in a response body.
      return reject('Invalid or malformed payment header');
    }

    const selected = requirements.find(
      (candidate) => candidate.scheme === payload.scheme && candidate.network === payload.network,
    );
    if (!selected) return reject('Unable to find matching payment requirements');

    try {
      const response = await this.facilitator.verify(payload, selected);
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

    return { kind: 'accepted', accepted: { payload, requirements: selected } };
  }

  /**
   * Settles after the handler succeeded, so a failed query is never charged for.
   * Returns the X-PAYMENT-RESPONSE header value, or null if settlement failed.
   */
  async settle(accepted: PaymentAcceptance): Promise<string | null> {
    try {
      const response = await this.facilitator.settle(accepted.payload, accepted.requirements);
      return encodePaymentResponseHeader(response);
    } catch (error) {
      this.logger.error(`settlement failed: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }
}
