import type { DataSource } from 'typeorm';
import { canonicalize } from '../canonicalize/v1';
import { DocumentEntity } from '../database/document.entity';
import { createFetcher, type Fetcher } from '../crawl/http';
import { chainSettings } from '../attest/chain';

/** Exit codes are the contract: callers branch on them, per provenance.feature. */
export const EXIT_MATCH = 0;
export const EXIT_MISMATCH = 1;
export const EXIT_UNINDEXED = 2;

export type VerifyStatus = 'match' | 'mismatch' | 'unindexed';

export interface VerifyResult {
  readonly status: VerifyStatus;
  readonly exitCode: number;
  readonly url: string;
  /** The hash we attested, or null when the URL is not indexed. */
  readonly attestedHash: string | null;
  /** The hash the live page canonicalizes to now, or null when unindexed. */
  readonly recomputedHash: string | null;
  readonly attestationUid: string | null;
  readonly attestationUrl: string | null;
  readonly protocolVersion: number | null;
}

/**
 * Where a reader goes to check an attestation. Derived from EAS_CHAIN rather
 * than hardcoded, so a testnet demo links to the explorer that actually holds
 * its attestations instead of to a mainnet one that does not.
 */
export const attestationUrl = (
  uid: string | null,
  env: Record<string, string | undefined> = process.env,
): string | null =>
  uid === null ? null : `${chainSettings(env).easscan}/attestation/view/${uid}`;

/**
 * Re-executes the pinned canonicalization against the live page and compares
 * the result to what was indexed.
 *
 * This is deliberately the same code path the crawler uses. A verifier that
 * reimplemented canonicalization could agree with the index while both
 * disagreed with the published protocol, which is the failure this whole
 * exercise exists to make impossible.
 */
export async function verify(
  dataSource: DataSource,
  url: string,
  fetcher: Fetcher = createFetcher(),
): Promise<VerifyResult> {
  const document = await dataSource.getRepository(DocumentEntity).findOne({ where: { url } });

  if (!document) {
    return {
      status: 'unindexed',
      exitCode: EXIT_UNINDEXED,
      url,
      attestedHash: null,
      recomputedHash: null,
      attestationUid: null,
      attestationUrl: null,
      protocolVersion: null,
    };
  }

  const response = await fetcher(url);
  const canonical = canonicalize({
    source: response.bytes,
    url,
    format: 'html',
  });
  // A page that has since become thin no longer canonicalizes to anything, and
  // that is a mismatch rather than a crash.
  const recomputedHash = canonical.skipped ? null : canonical.contentHash;
  const matches = recomputedHash !== null && recomputedHash === document.contentHash;

  return {
    status: matches ? 'match' : 'mismatch',
    exitCode: matches ? EXIT_MATCH : EXIT_MISMATCH,
    url,
    attestedHash: document.contentHash,
    recomputedHash,
    attestationUid: document.attestationUid,
    attestationUrl: attestationUrl(document.attestationUid),
    protocolVersion: document.protocolVersion,
  };
}

export function formatVerifyResult(result: VerifyResult): string {
  if (result.status === 'unindexed') {
    return `UNINDEXED  ${result.url}\n  not present in the index, nothing to verify against`;
  }

  const lines = [
    `${result.status === 'match' ? 'MATCH' : 'MISMATCH'}  ${result.url}`,
    `  attested hash    ${result.attestedHash}`,
    `  recomputed hash  ${result.recomputedHash ?? '(page is now too thin to index)'}`,
    `  protocol         wuzzy/crawl v${result.protocolVersion}`,
  ];
  lines.push(
    result.attestationUrl === null
      ? '  attestation      not yet attested onchain'
      : `  attestation      ${result.attestationUrl}`,
  );
  return lines.join('\n');
}
