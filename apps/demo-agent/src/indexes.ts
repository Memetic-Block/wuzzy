import type { Hex } from 'viem';
import { createSigner, decodeXPaymentResponse, wrapFetchWithPayment } from 'x402-fetch';
import { DEFAULT_MAX_VALUE, type Settlement } from './search';

export interface IndexSummary {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly owner: string;
  readonly visibility: 'listed' | 'unlisted';
  readonly readPolicy: 'open' | 'allowlist';
  readonly pageCap: number | null;
  readonly createdAt: string;
}

export interface IndexStatus extends IndexSummary {
  readonly status: 'pending' | 'crawling' | 'ready';
  readonly pages: number;
  readonly attestations: number;
  readonly pending: number;
  readonly statusUrl: string;
}

export interface CommissionOutcome {
  readonly index: IndexStatus;
  readonly settlement: Settlement | null;
  readonly paid: boolean;
}

export interface CommissionOptions {
  readonly api: string;
  readonly urls: readonly string[];
  readonly name?: string;
  readonly visibility?: 'listed' | 'unlisted';
  readonly readPolicy?: 'open' | 'allowlist';
  readonly allowlist?: readonly string[];
  readonly privateKey?: Hex;
  readonly network?: 'base' | 'base-sepolia';
  readonly maxValue?: bigint;
  readonly fetchImpl?: typeof globalThis.fetch;
  /** Only used when the endpoint is in dev mode and there is no payer. */
  readonly owner?: string;
}

export class PageCapError extends Error {}
export class NotPermittedError extends Error {}

/**
 * The base a Wuzzy API is served from, given the search endpoint people
 * already configure. One setting stays one setting: `/indexes` is a sibling of
 * `/search`, not a separate deployment.
 */
export function apiBase(searchEndpoint: string): string {
  return searchEndpoint.replace(/\/search\/?$/, '') || searchEndpoint;
}

/**
 * Commissions an index: pay per page for a list of URLs, get back an index you
 * own and a status endpoint to watch while it fills.
 *
 * The price is quoted from the URL list alone, so the amount in the 402 is the
 * amount signed for. Pages the index already holds are joined rather than
 * re-crawled, which is why a large list can settle for less work than it looks.
 */
export async function commissionIndex(options: CommissionOptions): Promise<CommissionOutcome> {
  const body = {
    urls: options.urls,
    ...(options.name ? { name: options.name } : {}),
    ...(options.visibility ? { visibility: options.visibility } : {}),
    ...(options.readPolicy ? { readPolicy: options.readPolicy } : {}),
    ...(options.allowlist?.length ? { allowlist: options.allowlist } : {}),
    ...(options.owner ? { owner: options.owner } : {}),
  };
  const response = await post(`${apiBase(options.api)}/indexes`, body, options);
  return {
    index: (await readJson(response)) as IndexStatus,
    ...settlementOf(response),
  };
}

export interface AppendOptions extends Omit<CommissionOptions, 'urls' | 'name'> {
  readonly index: string;
  readonly urls: readonly string[];
}

/** Adds URLs to an index you own. Same per-page price as commissioning it. */
export async function appendToIndex(options: AppendOptions): Promise<CommissionOutcome> {
  const url = `${apiBase(options.api)}/indexes/${encodeURIComponent(options.index)}/urls`;
  const response = await post(url, { urls: options.urls }, options);
  return {
    index: (await readJson(response)) as IndexStatus,
    ...settlementOf(response),
  };
}

/** Unmetered: the catalog and an index's status are free to read. */
export async function listIndexes(
  api: string,
  fetchImpl = globalThis.fetch,
): Promise<IndexSummary[]> {
  const response = await fetchImpl(`${apiBase(api)}/indexes`);
  const body = (await readJson(response)) as { indexes?: IndexSummary[] };
  return body.indexes ?? [];
}

export async function indexStatus(
  api: string,
  reference: string,
  fetchImpl = globalThis.fetch,
): Promise<IndexStatus> {
  const response = await fetchImpl(`${apiBase(api)}/indexes/${encodeURIComponent(reference)}`);
  return (await readJson(response)) as IndexStatus;
}

async function post(
  url: string,
  body: unknown,
  options: Pick<CommissionOptions, 'privateKey' | 'network' | 'maxValue' | 'fetchImpl'>,
): Promise<Response> {
  const baseFetch = options.fetchImpl ?? globalThis.fetch;
  const request = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  } as const;

  if (!options.privateKey) return baseFetch(url, request);

  const signer = await createSigner(options.network ?? 'base', options.privateKey);
  const paying = wrapFetchWithPayment(baseFetch, signer, options.maxValue ?? DEFAULT_MAX_VALUE);
  return paying(url, request);
}

function settlementOf(response: Response): { settlement: Settlement | null; paid: boolean } {
  const header = response.headers.get('x-payment-response');
  return {
    settlement: header ? (decodeXPaymentResponse(header) as Settlement) : null,
    paid: header !== null,
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  const body = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
  if (response.ok) return body;

  const message = typeof body.error === 'string' ? body.error : `HTTP ${response.status}`;
  // The two refusals a caller can actually do something about: ask for fewer
  // pages, or use the wallet that owns the index.
  if (response.status === 400 && typeof body.pageCap === 'number') throw new PageCapError(message);
  if (response.status === 403) throw new NotPermittedError(message);
  throw new Error(message);
}
