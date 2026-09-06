import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { attestationUrl } from '../verify/verify';

export interface IndexStats {
  readonly documents: number;
  readonly chunks: number;
  readonly fetches: number;
  readonly embedded: number;
  readonly attested: number;
  readonly skipped: number;
  readonly failed: number;
  readonly firstFetchedAt: string | null;
  readonly lastFetchedAt: string | null;
  readonly hosts: { host: string; documents: number }[];
  readonly protocols: { protocol: string; protocolVersion: number; documents: number }[];
}

export interface DocumentSummary {
  readonly id: string;
  readonly url: string;
  readonly title: string | null;
  readonly contentHash: string;
  readonly fetchedAt: string;
  readonly chunks: number;
  readonly embedded: boolean;
  readonly attestationUid: string | null;
  readonly attestationUrl: string | null;
  readonly contentChars: number;
}

export interface DocumentPage {
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly documents: DocumentSummary[];
}

export type DocumentFilter = 'all' | 'unembedded' | 'unattested' | 'attested';
export type ActivityFilter = 'all' | 'failed' | 'skipped' | 'changed';

export interface IndexSummaryRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly owner: string;
  readonly visibility: string;
  readonly readPolicy: string;
  readonly pageCap: number | null;
  readonly createdAt: string;
  readonly status: 'pending' | 'crawling' | 'ready';
  readonly pages: number;
  readonly attested: number;
  readonly pending: number;
  readonly readers: number;
}

const MAX_LIMIT = 200;

@Injectable()
export class AdminService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async stats(): Promise<IndexStats> {
    const [totals] = await this.dataSource.query(`
      SELECT
        (SELECT count(*) FROM documents)                                   AS documents,
        (SELECT count(*) FROM chunks)                                      AS chunks,
        (SELECT count(*) FROM fetch_log)                                   AS fetches,
        (SELECT count(*) FROM documents WHERE embedded_at IS NOT NULL)     AS embedded,
        (SELECT count(*) FROM documents WHERE attestation_uid IS NOT NULL) AS attested,
        (SELECT count(*) FROM fetch_log WHERE skipped_reason IS NOT NULL)  AS skipped,
        (SELECT count(*) FROM fetch_log WHERE error IS NOT NULL)           AS failed,
        (SELECT min(fetched_at) FROM documents)                            AS first_fetched_at,
        (SELECT max(fetched_at) FROM documents)                            AS last_fetched_at
    `);

    // Host grouping is a view over the whole store rather than over any one
    // index: which sites the corpus actually came from.
    const hosts = await this.dataSource.query(`
      SELECT split_part(split_part(url, '://', 2), '/', 1) AS host, count(*)::int AS documents
      FROM documents GROUP BY host ORDER BY documents DESC, host ASC
    `);
    const protocols = await this.dataSource.query(`
      SELECT protocol, protocol_version AS "protocolVersion", count(*)::int AS documents
      FROM documents GROUP BY protocol, protocol_version ORDER BY documents DESC
    `);

    return {
      documents: Number(totals.documents),
      chunks: Number(totals.chunks),
      fetches: Number(totals.fetches),
      embedded: Number(totals.embedded),
      attested: Number(totals.attested),
      skipped: Number(totals.skipped),
      failed: Number(totals.failed),
      firstFetchedAt: totals.first_fetched_at ? new Date(totals.first_fetched_at).toISOString() : null,
      lastFetchedAt: totals.last_fetched_at ? new Date(totals.last_fetched_at).toISOString() : null,
      hosts,
      protocols,
    };
  }

  /**
   * Every index with the counts that say whether it is finished. Ordered with
   * the global index first, because it is the one an unscoped search reads and
   * the one an operator is usually looking at.
   */
  async indexes(): Promise<IndexSummaryRow[]> {
    const rows = await this.dataSource.query(`
      SELECT i.id, i.slug, i.name, i.owner, i.visibility,
             i.read_policy AS "readPolicy", i.page_cap AS "pageCap", i.created_at,
             (SELECT count(*) FROM index_documents m WHERE m.index_id = i.id)::int AS pages,
             (SELECT count(*) FROM index_documents m JOIN documents d ON d.id = m.document_id
               WHERE m.index_id = i.id AND d.attestation_uid IS NOT NULL)::int AS attested,
             (SELECT count(*) FROM index_urls u
               WHERE u.index_id = i.id AND u.crawled_at IS NULL)::int AS pending,
             (SELECT count(*) FROM index_urls u
               WHERE u.index_id = i.id AND u.crawled_at IS NOT NULL)::int AS crawled,
             (SELECT count(*) FROM index_readers r WHERE r.index_id = i.id)::int AS readers
      FROM indexes i
      ORDER BY (i.slug = 'global') DESC, i.created_at DESC
    `);

    return rows.map((row: Record<string, any>) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      owner: row.owner,
      visibility: row.visibility,
      readPolicy: row.readPolicy,
      pageCap: row.pageCap === null ? null : Number(row.pageCap),
      createdAt: new Date(row.created_at).toISOString(),
      status: row.pending === 0 ? 'ready' : row.crawled > 0 ? 'crawling' : 'pending',
      pages: row.pages,
      attested: row.attested,
      pending: row.pending,
      readers: row.readers,
    }));
  }

  async documents(options: {
    query?: string;
    host?: string;
    index?: string;
    filter?: DocumentFilter;
    limit?: number;
    offset?: number;
  }): Promise<DocumentPage> {
    const limit = Math.min(Math.max(options.limit ?? 25, 1), MAX_LIMIT);
    const offset = Math.max(options.offset ?? 0, 0);

    const where: string[] = [];
    const params: unknown[] = [];
    if (options.query) {
      params.push(`%${options.query}%`);
      where.push(`(d.url ILIKE $${params.length} OR d.title ILIKE $${params.length})`);
    }
    if (options.host) {
      params.push(options.host);
      where.push(`split_part(split_part(d.url, '://', 2), '/', 1) = $${params.length}`);
    }
    if (options.index) {
      params.push(options.index);
      where.push(
        `EXISTS (SELECT 1 FROM index_documents m JOIN indexes i ON i.id = m.index_id
                  WHERE m.document_id = d.id AND (i.slug = $${params.length}
                        OR i.id::text = $${params.length}))`,
      );
    }
    if (options.filter === 'unembedded') where.push('d.embedded_at IS NULL');
    if (options.filter === 'unattested') where.push('d.attestation_uid IS NULL');
    if (options.filter === 'attested') where.push('d.attestation_uid IS NOT NULL');
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const [count] = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM documents d ${clause}`,
      params,
    );

    const rows = await this.dataSource.query(
      `SELECT d.id, d.url, d.title, d.content_hash, d.fetched_at, d.embedded_at,
              d.attestation_uid, length(d.content) AS content_chars,
              (SELECT count(*)::int FROM chunks c WHERE c.document_id = d.id) AS chunks
       FROM documents d ${clause}
       ORDER BY d.fetched_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    return {
      total: Number(count.total),
      limit,
      offset,
      documents: rows.map(toSummary),
    };
  }

  /** One document with the provenance trail that explains how it got here. */
  async document(id: string): Promise<Record<string, unknown> | null> {
    const [row] = await this.dataSource.query(
      `SELECT d.*, (SELECT count(*)::int FROM chunks c WHERE c.document_id = d.id) AS chunks
       FROM documents d WHERE d.id = $1`,
      [id],
    );
    if (!row) return null;

    const fetches = await this.dataSource.query(
      `SELECT id, http_status, raw_hash, content_hash, content_changed,
              skipped_reason, error, fetched_at
       FROM fetch_log WHERE document_id = $1 ORDER BY fetched_at DESC LIMIT 50`,
      [id],
    );
    const chunks = await this.dataSource.query(
      `SELECT ordinal, token_count, left(text, 300) AS preview,
              (embedding IS NOT NULL) AS embedded
       FROM chunks WHERE document_id = $1 ORDER BY ordinal ASC`,
      [id],
    );

    return {
      ...toSummary({ ...row, content_chars: row.content?.length ?? 0 }),
      rawHash: row.raw_hash,
      protocol: row.protocol,
      protocolVersion: row.protocol_version,
      robotsStatus: row.robots_status,
      httpStatus: row.http_status,
      embeddedAt: row.embedded_at ? new Date(row.embedded_at).toISOString() : null,
      attestedAt: row.attested_at ? new Date(row.attested_at).toISOString() : null,
      content: row.content,
      fetches,
      chunkList: chunks,
    };
  }

  /**
   * Recent crawl activity, including fetches that produced no document.
   *
   * Filtering is done in SQL rather than on the returned page: narrowing after
   * the limit would return a handful of rows and call it the last 50.
   */
  async activity(limit = 50, filter: ActivityFilter = 'all'): Promise<unknown[]> {
    const where =
      filter === 'failed'
        ? 'WHERE f.error IS NOT NULL'
        : filter === 'skipped'
          ? 'WHERE f.skipped_reason IS NOT NULL'
          : filter === 'changed'
            ? 'WHERE f.content_changed'
            : '';

    return this.dataSource.query(
      `SELECT f.id, f.url, f.http_status, f.content_changed, f.skipped_reason,
              f.error, f.fetched_at, f.document_id
       FROM fetch_log f ${where} ORDER BY f.fetched_at DESC LIMIT $1`,
      [Math.min(Math.max(limit, 1), MAX_LIMIT)],
    );
  }
}

function toSummary(row: Record<string, any>): DocumentSummary {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    contentHash: row.content_hash,
    fetchedAt: new Date(row.fetched_at).toISOString(),
    chunks: Number(row.chunks ?? 0),
    embedded: row.embedded_at !== null,
    attestationUid: row.attestation_uid,
    attestationUrl: attestationUrl(row.attestation_uid),
    contentChars: Number(row.content_chars ?? 0),
  };
}
