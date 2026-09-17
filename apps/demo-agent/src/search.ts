import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { decodePaymentResponseHeader, wrapFetchWithPaymentFromConfig } from '@x402/fetch';

export type Network = 'base' | 'base-sepolia';

/** x402 version 2 names a chain by its CAIP-2 id rather than by name. */
export const CHAINS: Record<Network, `eip155:${number}`> = {
  base: 'eip155:8453',
  'base-sepolia': 'eip155:84532',
};

export interface SearchProvenance {
  readonly protocol: string;
  readonly protocolVersion: number;
  readonly contentHash: string;
  /** The bytes as served, before canonicalization. Absent on older servers. */
  readonly rawHash?: string;
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
  readonly network?: Network;
  /** Ceiling in atomic USDC units. Refuses to pay more, whatever is asked. */
  readonly maxValue?: bigint;
  readonly topK?: number;
  /** Index id or slug. Omit to search the global index. */
  readonly index?: string;
  readonly fetchImpl?: typeof globalThis.fetch;
}

/** 0.10 USDC. A demo should never be able to spend more than pocket change. */
export const DEFAULT_MAX_VALUE = 100_000n;

export class WalletRequiredError extends Error {}

/**
 * A fetch that answers a 402 by paying it, up to a ceiling.
 *
 * This is the whole x402 integration: one scheme for one chain, signed by the
 * wallet. The ceiling is the client's own. It is set in dollars because that is
 * how the library states it, and USDC has six decimals wherever it is deployed.
 */
export function payingFetch(
  baseFetch: typeof globalThis.fetch,
  privateKey: Hex,
  network: Network,
  maxValue: bigint,
): typeof globalThis.fetch {
  const paying = wrapFetchWithPaymentFromConfig(baseFetch, {
    schemes: [
      { network: CHAINS[network], client: new ExactEvmScheme(privateKeyToAccount(privateKey)) },
    ],
    spendControls: { maxAmountPerPayment: `$${Number(maxValue) / 1_000_000}` },
  });
  return paying as typeof globalThis.fetch;
}

/** The settlement a paid response reports, or none when nothing was charged. */
export function settlementOf(response: Response): { settlement: Settlement | null; paid: boolean } {
  const header = response.headers.get('payment-response');
  return {
    settlement: header ? (decodePaymentResponseHeader(header) as Settlement) : null,
    paid: header !== null,
  };
}

/**
 * One paid query against a Wuzzy endpoint.
 *
 * There is no account and no API key: the wallet is the whole identity. The
 * first request comes back 402 with payment requirements, the payment wrapper
 * signs a payment and retries, and the response carries per-result provenance
 * the caller can verify without trusting the index.
 */
export async function paidSearch(options: SearchOptions): Promise<SearchOutcome> {
  const baseFetch = options.fetchImpl ?? globalThis.fetch;
  const request = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: options.query,
      topK: options.topK ?? 5,
      ...(options.index ? { index: options.index } : {}),
    }),
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

  const paying = payingFetch(
    baseFetch,
    options.privateKey,
    options.network ?? 'base',
    options.maxValue ?? DEFAULT_MAX_VALUE,
  );
  const response = await paying(options.endpoint, request);

  if (!response.ok) {
    throw new Error(`search failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { results?: SearchResult[] };
  return { results: body.results ?? [], ...settlementOf(response) };
}

/** A settlement reports its network by CAIP-2 id; the flag names it. Either works here. */
export const basescanUrl = (transaction: string, network = 'base'): string =>
  network === 'base-sepolia' || network === CHAINS['base-sepolia']
    ? `https://sepolia.basescan.org/tx/${transaction}`
    : `https://basescan.org/tx/${transaction}`;
