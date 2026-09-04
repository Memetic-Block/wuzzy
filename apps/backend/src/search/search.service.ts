import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PROTOCOL, PROTOCOL_VERSION } from '../canonicalize/v1';
import { createEmbedder, toVectorLiteral, type Embedder } from '../embed/embedder';
import { attestationUrl } from '../verify/verify';

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

export class EmptyQueryError extends Error {}

/** DI token for the embedder, so Nest has something concrete to inject. */
export const EMBEDDER = Symbol('EMBEDDER');

interface Row {
  url: string;
  title: string | null;
  snippet: string;
  score: string | number;
  content_hash: string;
  fetched_at: Date;
  attestation_uid: string | null;
  protocol: string;
  protocol_version: number;
}

@Injectable()
export class SearchService {
  private readonly embedder: Embedder;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(EMBEDDER) embedder?: Embedder,
  ) {
    // Still defaulted so the service is usable outside a Nest context, e.g. from
    // the CLI, but the token is what makes it resolvable by the injector.
    this.embedder = embedder ?? createEmbedder();
  }

  /**
   * Vector top-k over chunks, collapsed to one row per document and joined back
   * to the provenance the caller needs in order to verify what it bought.
   */
  async search(query: string, topK = 10): Promise<SearchResult[]> {
    const trimmed = query.trim();
    if (trimmed === '') throw new EmptyQueryError('query must not be blank');

    const [vector] = await this.embedder.embed([trimmed]);
    if (!vector) return [];
    const literal = toVectorLiteral(vector);

    // DISTINCT ON keeps the best-scoring chunk per document; the outer query
    // then orders those winners against each other.
    const rows: Row[] = await this.dataSource.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (d.id)
           d.url, d.title, d.content_hash, d.fetched_at, d.attestation_uid,
           d.protocol, d.protocol_version,
           c.text AS snippet,
           1 - (c.embedding <=> $1::vector) AS score
         FROM chunks c
         JOIN documents d ON d.id = c.document_id
         WHERE c.embedding IS NOT NULL
         ORDER BY d.id, c.embedding <=> $1::vector
       ) best
       ORDER BY best.score DESC
       LIMIT $2`,
      [literal, topK],
    );

    return rows.map((row) => ({
      url: row.url,
      title: row.title,
      snippet: snippet(row.snippet),
      score: Number(row.score),
      provenance: {
        protocol: row.protocol ?? PROTOCOL,
        protocolVersion: row.protocol_version ?? PROTOCOL_VERSION,
        contentHash: row.content_hash,
        fetchedAt: new Date(row.fetched_at).toISOString(),
        attestationUid: row.attestation_uid,
        attestationUrl: attestationUrl(row.attestation_uid),
      },
    }));
  }
}

const SNIPPET_CHARS = 320;

/** Trims a chunk to a readable excerpt without cutting mid-word. */
function snippet(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= SNIPPET_CHARS) return flat;
  const cut = flat.lastIndexOf(' ', SNIPPET_CHARS);
  return `${flat.slice(0, cut > 0 ? cut : SNIPPET_CHARS)}...`;
}
