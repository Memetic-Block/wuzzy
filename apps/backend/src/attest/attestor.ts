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
}

export class MissingAttesterKeyError extends Error {}

/**
 * The real submitter. The signing key is read from the environment at call
 * time and is never defaulted: an attester key belongs to a human running this
 * by hand, not to this repository, a session, or CI.
 */
export function createEasSubmitter(
  options?: Partial<EasSubmitterOptions>,
  env: Record<string, string | undefined> = process.env,
): AttestationSubmitter {
  const schemaUid = options?.schemaUid ?? env.EAS_SCHEMA_UID;
  const privateKey = options?.privateKey ?? env.ATTESTER_PRIVATE_KEY;
  // EAS_CHAIN picks the network; BASE_RPC_URL overrides only the endpoint, so
  // pointing at a private node cannot quietly move which chain is attested to.
  const chain = chainSettings(env);
  const rpcUrl = options?.rpcUrl ?? env.BASE_RPC_URL ?? chain.rpcUrl;
  const easAddress = options?.easAddress ?? env.EAS_ADDRESS ?? EAS_ADDRESS;

  if (!schemaUid) throw new MissingAttesterKeyError('EAS_SCHEMA_UID is not set');
  if (!privateKey) {
    throw new MissingAttesterKeyError(
      'ATTESTER_PRIVATE_KEY is not set. Attesting is run by hand by a human; ' +
        'no funded key belongs in this repo, a session, or CI.',
    );
  }

  return {
    async submit(requests) {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const eas = new EAS(easAddress);
      eas.connect(new ethers.Wallet(privateKey, provider));

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
    },
  };
}
