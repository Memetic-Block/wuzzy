import type { DataSource } from 'typeorm';
import { DocumentEntity } from '../database/document.entity';
import { FetchLogEntity } from '../database/fetch-log.entity';
import { PROTOCOL, PROTOCOL_VERSION, type CanonicalizeResult } from '../canonicalize/v1';

export type FetchOutcome = 'created' | 'unchanged' | 'changed' | 'skipped';

export interface FetchRecord {
  readonly url: string;
  readonly httpStatus: number;
  readonly robotsStatus: 'allowed';
  readonly fetchedAt: Date;
  readonly canonical: CanonicalizeResult;
  readonly title?: string | null;
  /** Index the resulting document joins. Membership only; provenance is unaffected. */
  readonly indexId?: string | null;
}

export interface RecordedFetch {
  readonly outcome: FetchOutcome;
  readonly documentId: string | null;
}

/**
 * Writes the provenance trail for one completed fetch, per
 * contracts/provenance.feature.
 *
 * fetch_log is append-only and gets a row for every fetch that happened,
 * including one that produced no document. `documents` holds only latest state,
 * and a content change clears the downstream bookkeeping so the embed and
 * attest passes pick the document up again. Both writes land in one transaction
 * so a crash cannot leave a document without the trail that explains it.
 *
 * Index membership joins that transaction rather than following it, so a
 * document can never exist without the index that paid for it. Nothing about
 * the hashes or the fetch_log row changes with membership: provenance is a
 * property of the fetch, and a URL two indexes both want is attested once.
 */
export async function recordFetch(
  dataSource: DataSource,
  record: FetchRecord,
): Promise<RecordedFetch> {
  return dataSource.transaction(async (manager) => {
    const documents = manager.getRepository(DocumentEntity);
    const fetchLog = manager.getRepository(FetchLogEntity);
    const existing = await documents.findOne({ where: { url: record.url } });

    if (record.canonical.skipped) {
      await fetchLog.save({
        documentId: existing?.id ?? null,
        url: record.url,
        httpStatus: record.httpStatus,
        rawHash: record.canonical.rawHash,
        contentHash: null,
        contentChanged: false,
        skippedReason: record.canonical.reason,
        fetchedAt: record.fetchedAt,
      });
      return { outcome: 'skipped', documentId: existing?.id ?? null };
    }

    const { rawHash, contentHash, markdown, title } = record.canonical;
    const changed = existing !== null && existing.contentHash !== contentHash;

    const saved = await documents.save({
      ...(existing ? { id: existing.id } : {}),
      url: record.url,
      title: record.title ?? title,
      content: markdown,
      rawHash,
      contentHash,
      protocol: PROTOCOL,
      protocolVersion: PROTOCOL_VERSION,
      robotsStatus: record.robotsStatus,
      httpStatus: record.httpStatus,
      fetchedAt: record.fetchedAt,
      updatedAt: new Date(),
      // A new document has nothing downstream yet; a changed one has its
      // downstream artifacts invalidated; an unchanged one keeps them.
      ...(existing && !changed
        ? {}
        : { embeddedAt: null, attestationUid: null, attestedAt: null }),
    });

    await fetchLog.save({
      documentId: saved.id,
      url: record.url,
      httpStatus: record.httpStatus,
      rawHash,
      contentHash,
      contentChanged: changed,
      fetchedAt: record.fetchedAt,
    });

    if (record.indexId) {
      await manager.query(
        `INSERT INTO index_documents (index_id, document_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [record.indexId, saved.id],
      );
    }

    if (!existing) return { outcome: 'created', documentId: saved.id };
    return { outcome: changed ? 'changed' : 'unchanged', documentId: saved.id };
  });
}
