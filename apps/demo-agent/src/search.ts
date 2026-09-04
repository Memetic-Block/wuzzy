import type { Hex } from 'viem';
import { createSigner, decodeXPaymentResponse, wrapFetchWithPayment } from 'x402-fetch';

export interface SearchProvenance {
  readonly protocol: string;
  readonly protocolVersion: number;
  readonly contentHash: string;
  readonly fetchedAt: string;
  readonly attestationUid: string | null;
  readonly attestationUrl: string | null;
}

export interface SearchResult {
  readonly url: string;
  readonly title: string | null;
  readonly snippet: string;
  readonly score: number;
  readonly provenance: SearchProvenance;
}

export interface Settlement {
  readonly transaction?: string;
  readonly network?: string;
  readonly payer?: string;
}

export interface SearchOutcome {
  readonly results: SearchResult[];
  /** Present once a payment settled; absent when the API is in dev mode. */
  readonly settlement: Settlement | null;
  readonly paid: boolean;
}

export interface SearchOptions {
  readonly endpoint: string;
  readonly query: string;
  /** Omit to try unpaid first: an endpoint in dev mode needs no wallet at all. */
  readonly privateKey?: Hex;
  readonly network?: 'base' | 'base-sepolia';
  /** Ceiling in atomic USDC units. Refuses to pay more, whatever is asked. */
  readonly maxValue?: bigint;
  readonly topK?: number;
  readonly fetchImpl?: typeof globalThis.fetch;
}

/** 0.10 USDC. A demo should never be able to spend more than pocket change. */
export const DEFAULT_MAX_VALUE = 100_000n;

export class WalletRequiredError extends Error {}

/**
 * One paid query against a Wuzzy endpoint.
 *
 * There is no account and no API key: the wallet is the whole identity. The
 * first request comes back 402 with payment requirements, x402-fetch signs a
 * payment and retries, and the response carries per-result provenance the
 * caller can verify without trusting the index.
 */
export async function paidSearch(options: SearchOptions): Promise<SearchOutcome> {
  const baseFetch = options.fetchImpl ?? globalThis.fetch;
  const request = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: options.query, topK: options.topK ?? 5 }),
  } as const;

  // Without a wallet, try unpaid: an endpoint in dev mode serves openly, and
  // requiring a funded key to discover that would be a poor first run.
  if (!options.privateKey) {
    const unpaid = await baseFetch(options.endpoint, request);
    if (unpaid.status === 402) {
      throw new WalletRequiredError(
        'this endpoint requires payment, so the demo needs a wallet',
      );
    }
    if (!unpaid.ok) {
      throw new Error(`search failed: ${unpaid.status} ${await unpaid.text()}`);
    }
    const body = (await unpaid.json()) as { results?: SearchResult[] };
    return { results: body.results ?? [], settlement: null, paid: false };
  }

  // x402's own signer factory rather than a hand-built viem wallet client: it
  // is what the library's types expect, and it keeps chain selection in one
  // place as networks are added.
  const signer = await createSigner(options.network ?? 'base', options.privateKey);

  const payingFetch = wrapFetchWithPayment(
    baseFetch,
    signer,
    options.maxValue ?? DEFAULT_MAX_VALUE,
  );

  const response = await payingFetch(options.endpoint, request);

  if (!response.ok) {
    throw new Error(`search failed: ${response.status} ${await response.text()}`);
  }

  const header = response.headers.get('x-payment-response');
  const body = (await response.json()) as { results?: SearchResult[] };

  return {
    results: body.results ?? [],
    settlement: header ? (decodeXPaymentResponse(header) as Settlement) : null,
    paid: header !== null,
  };
}

export const basescanUrl = (transaction: string, network = 'base'): string =>
  network === 'base-sepolia'
    ? `https://sepolia.basescan.org/tx/${transaction}`
    : `https://basescan.org/tx/${transaction}`;
