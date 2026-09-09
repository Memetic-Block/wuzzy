import { EAS, NO_EXPIRATION } from '@ethereum-attestation-service/eas-sdk';
import { ethers } from 'ethers';
import type { DataSource } from 'typeorm';
import { DocumentEntity } from '../database/document.entity';
import { chainSettings, EAS_ADDRESS } from './chain';
import { encodeAttestation, schemaCarriesNoContent, SCHEMA_DEFINITION } from './schema';

/** EAS on Base mainnet. */

export interface AttestationRequest {
  readonly documentId: string;
  readonly recipient: string;
  readonly encodedData: string;
}

/** Submits a batch and returns the resulting UIDs, in request order. */
/** Injection token for a configured submitter. Only the attester resolves one. */
export const ATTESTATION_SUBMITTER = Symbol('ATTESTATION_SUBMITTER');

export interface AttestationSubmitter {
  submit(requests: readonly AttestationRequest[]): Promise<string[]>;
}

export interface AttestOptions {
  readonly submitter: AttestationSubmitter;
  /** Attestations per multiAttest transaction. */
  readonly batchSize?: number;
  readonly limit?: number;
  /** Attest only documents that have been embedded. On by default. */
  readonly embeddedOnly?: boolean;
  /**
   * Attest only documents in this index. The attester passes the index it is
   * draining, so one customer's pages are not held up behind another's.
   */
  readonly indexId?: string;
  /**
   * Called after each batch lands. A pass over a large index is many
   * transactions and takes minutes, and reporting only at the end makes a
   * working attester indistinguishable from a stuck one: the buyer sees
   * `attestations: 0` against pages they have already paid for, and the log
   * says nothing until it is over.
   */
  readonly onBatch?: (progress: AttestProgress) => void;
}

export interface AttestProgress {
  readonly attested: number;
  readonly total: number;
  readonly batches: number;
}

export interface AttestSummary {
  readonly attested: number;
  readonly batches: number;
}

/**
 * Attests every document that does not yet carry a UID.
 *
 * Idempotent for the same reason the embed pass is: the work queue is
 * `attestation_uid IS NULL`, and the crawler nulls that column again whenever
 * content changes. So a re-run attests only what is new or changed, and an
 * interrupted run resumes without double-attesting the batches that landed.
 */
export async function attestPending(
  dataSource: DataSource,
  options: AttestOptions,
): Promise<AttestSummary> {
  if (!schemaCarriesNoContent()) {
    throw new Error(`attestation schema must carry no content: "${SCHEMA_DEFINITION}"`);
  }

  const batchSize = options.batchSize ?? 50;
  const documents = dataSource.getRepository(DocumentEntity);
  const query = documents
    .createQueryBuilder('document')
    // Only what an attestation commits to. `getMany()` otherwise hydrates the
    // whole entity, and `content` is the canonical markdown of every page:
    // nothing here reads it, but a backlog of a few thousand documentation
    // pages then arrives as hundreds of megabytes of strings in an attester
    // sized at 1GB, before a single receipt is written.
    .select([
      'document.id',
      'document.url',
      'document.protocolVersion',
      'document.contentHash',
      'document.rawHash',
      'document.fetchedAt',
    ])
    .where('document.attestationUid IS NULL')
    .orderBy('document.updatedAt', 'ASC');
  if (options.embeddedOnly !== false) query.andWhere('document.embeddedAt IS NOT NULL');
  if (options.indexId !== undefined) {
    query.innerJoin(
      'index_documents',
      'membership',
      'membership.document_id = document.id AND membership.index_id = :indexId',
      { indexId: options.indexId },
    );
  }
  if (options.limit !== undefined) query.take(options.limit);
  const pending = await query.getMany();

  let attested = 0;
  let batches = 0;

  for (let start = 0; start < pending.length; start += batchSize) {
    const batch = pending.slice(start, start + batchSize);
    const requests = batch.map((document) => ({
      documentId: document.id,
      recipient: ethers.ZeroAddress,
      encodedData: encodeAttestation({
        url: document.url,
        protocolVersion: document.protocolVersion,
        contentHash: document.contentHash,
        rawHash: document.rawHash,
        fetchedAt: document.fetchedAt,
      }),
    }));

    const uids = await options.submitter.submit(requests);
    if (uids.length !== requests.length) {
      throw new Error(`expected ${requests.length} attestation UIDs, got ${uids.length}`);
    }

    // Backfill one row at a time and only for the batch that actually landed,
    // so a failure part-way through leaves the rest of the corpus re-runnable.
    const attestedAt = new Date();
    for (const [index, request] of requests.entries()) {
      await documents.update(
        { id: request.documentId },
        { attestationUid: uids[index]!, attestedAt },
      );
    }
    attested += requests.length;
    batches += 1;
    options.onBatch?.({ attested, total: pending.length, batches });
  }

  return { attested, batches };
}

export interface EasSubmitterOptions {
  readonly schemaUid: string;
  readonly privateKey: string;
  readonly rpcUrl: string;
  readonly easAddress?: string;
  /** How long one batch may take before it is treated as lost. */
  readonly timeoutMs?: number;
}

export class MissingAttesterKeyError extends Error {}

/**
 * The real submitter. The signing key is read from the environment at call
 * time and is never defaulted: an attester key belongs to a human running this
 * by hand, not to this repository, a session, or CI.
 */
/**
 * An environment value, or nothing, for config that arrives through Vault.
 *
 * A Nomad template renders a key the secret store does not have as the literal
 * string `<no value>` rather than failing or leaving the variable unset. With
 * `??` that beats a default, because it is neither null nor undefined, so a
 * spec naming a key nobody created silently reconfigures the process. It cost
 * an hour on 2026-09-09: `BASE_RPC_URL` rendered as `<no value>` and ethers
 * reported `unsupported protocol <no value>`, which reads like a broken node
 * rather than a template naming a key that was never set.
 *
 * Absent, empty and `<no value>` all mean the same thing: not configured.
 */
export function configured(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return !trimmed || trimmed === '<no value>' ? undefined : trimmed;
}

export function createEasSubmitter(
  options?: Partial<EasSubmitterOptions>,
  env: Record<string, string | undefined> = process.env,
): AttestationSubmitter {
  const schemaUid = options?.schemaUid ?? env.EAS_SCHEMA_UID;
  const privateKey = options?.privateKey ?? env.ATTESTER_PRIVATE_KEY;
  // EAS_CHAIN picks the network; BASE_RPC_URL overrides only the endpoint, so
  // pointing at a private node cannot quietly move which chain is attested to.
  const chain = chainSettings(env);
  const rpcUrl = options?.rpcUrl || configured(env.BASE_RPC_URL) || chain.rpcUrl;
  const easAddress = options?.easAddress || configured(env.EAS_ADDRESS) || EAS_ADDRESS;

  if (!schemaUid) throw new MissingAttesterKeyError('EAS_SCHEMA_UID is not set');
  if (!privateKey) {
    throw new MissingAttesterKeyError(
      'ATTESTER_PRIVATE_KEY is not set. Attesting is run by hand by a human; ' +
        'no funded key belongs in this repo, a session, or CI.',
    );
  }

  const timeoutMs = options?.timeoutMs ?? Number(env.ATTEST_SUBMIT_TIMEOUT_MS ?? DEFAULT_SUBMIT_TIMEOUT_MS);

  return {
    async submit(requests) {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const eas = new EAS(easAddress);
      eas.connect(new ethers.Wallet(privateKey, provider));

      return withTimeout(
        (async () => {
          const transaction = await eas.multiAttest([
            {
              schema: schemaUid,
              data: requests.map((request) => ({
                recipient: request.recipient,
                expirationTime: NO_EXPIRATION,
                revocable: true,
                data: request.encodedData,
              })),
            },
          ]);
          return transaction.wait();
        })(),
        timeoutMs,
        `attestation batch of ${requests.length}`,
      );
    },
  };
}

/**
 * How long a batch may take before it is treated as lost.
 *
 * Generous on purpose: Base produces a block every two seconds, so a batch that
 * has not settled in three minutes is not slow, it is gone.
 */
export const DEFAULT_SUBMIT_TIMEOUT_MS = 180_000;

/**
 * Fails a submission that never comes back.
 *
 * `transaction.wait()` waits for a receipt with no deadline of its own, so a
 * provider that stops answering leaves the promise pending forever. That is
 * worse than an error here: the attest job stays *active* rather than failing,
 * and [queue/attest.sweeper.ts](../queue/attest.sweeper.ts) only clears jobs
 * that finished, so every later re-ask is skipped and the whole corpus stops
 * being attested in silence. Observed on 2026-09-09, where 2,476 receipts sat
 * behind one call that never returned.
 *
 * Rejecting instead is safe and self-healing: the job fails, the failure is
 * removed, the sweeper asks again, and the work queue is still
 * `attestation_uid IS NULL`, so nothing already onchain is re-attested. The one
 * cost is a batch whose transaction landed while the wait timed out, which is
 * re-attested and paid for twice; at three minutes that is a rarity, and it is
 * a far smaller bill than an attester that stops.
 */
export async function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} did not settle within ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
