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
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly facilitator: ReturnType<typeof useFacilitator>;

  constructor(@Inject(PAYMENT_CONFIG) private readonly config: PaymentConfig) {
    this.facilitator = useFacilitator({ url: this.config.facilitatorUrl as `${string}://${string}` });
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  buildRequirements(resourceUrl: string): PaymentRequirements[] {
    const atomic = processPriceToAtomicAmount(this.config.price, this.config.network);
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
        description: this.config.description,
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
  async authorize(header: string | undefined, resourceUrl: string): Promise<PaymentOutcome> {
    if (!this.config.enabled) return { kind: 'open' };

    const requirements = this.buildRequirements(resourceUrl);
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
