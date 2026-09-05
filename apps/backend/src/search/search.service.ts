import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PROTOCOL, PROTOCOL_VERSION } from '../canonicalize/v1';
import { createEmbedder, toVectorLiteral, type Embedder } from '../embed/embedder';
import { attestationUrl } from '../verify/verify';
import { reciprocalRankFusion } from './fusion';
import { lexicalSearch, type LexicalHit } from './lexical';
import { SEARCH_CONFIG, buildSearchConfig, type SearchConfig, type SearchMode } from './search.config';

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
  /** Which arms found this, and where they ranked it. Useful for tuning. */
  readonly ranks: Record<string, number>;
  readonly provenance: SearchProvenance;
}

export class EmptyQueryError extends Error {}

export const EMBEDDER = Symbol('EMBEDDER');

interface VectorHit {
  chunk_id: string;
  document_id: string;
  score: string | number;
}

interface ChunkRow {
  chunk_id: string;
  url: string;
  title: string | null;
  snippet: string;
  content_hash: string;
  fetched_at: Date;
  attestation_uid: string | null;
  protocol: string;
  protocol_version: number;
}

@Injectable()
export class SearchService {
  private readonly embedder: Embedder;
  private readonly config: SearchConfig;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(EMBEDDER) @Optional() embedder?: Embedder,
    @Inject(SEARCH_CONFIG) @Optional() config?: SearchConfig,
  ) {
    this.embedder = embedder ?? createEmbedder();
    this.config = config ?? buildSearchConfig();
  }

  /**
   * Hybrid retrieval: BM25 and vector similarity run independently over chunks,
   * and their rankings are fused.
   *
   * Neither arm is sufficient alone on a documentation corpus. Dense vectors
   * miss exact tokens: an error code, a function name like `eth_getLogs`, an
   * address. BM25 misses paraphrase, which is most of how people actually ask.
   * Running both and fusing by rank costs one extra index and keeps each one's
   * strength.
   */
  async search(query: string, topK = 10, mode?: SearchMode): Promise<SearchResult[]> {
    const trimmed = query.trim();
    if (trimmed === '') throw new EmptyQueryError('query must not be blank');

    const effectiveMode = mode ?? this.config.mode;
    const depth = Math.max(this.config.candidates, topK);

    const [lexical, vector] = await Promise.all([
      effectiveMode === 'vector' ? [] : lexicalSearch(this.dataSource, trimmed, depth, this.config),
      effectiveMode === 'lexical' ? [] : this.vectorSearch(trimmed, depth),
    ]);

    // Fuse on chunk, not document: the same page can match one query lexically
    // in one passage and semantically in another, and collapsing too early
    // would throw away one of those signals.
    const fused = reciprocalRankFusion(
      { lexical: { items: lexical }, vector: { items: vector } },
      (hit) => hit.chunkId as string,
      { k: this.config.rrfK },
    );
    if (fused.length === 0) return [];

    const chunkIds = fused.slice(0, depth).map((item) => item.key);
    const rows: ChunkRow[] = await this.dataSource.query(
      `SELECT c.id AS chunk_id, d.url, d.title, c.text AS snippet, d.content_hash,
              d.fetched_at, d.attestation_uid, d.protocol, d.protocol_version
       FROM chunks c JOIN documents d ON d.id = c.document_id
       WHERE c.id = ANY($1::uuid[])`,
      [chunkIds],
    );
    const byChunk = new Map(rows.map((row) => [row.chunk_id, row]));

    // One result per document, keeping its best-fused chunk as the snippet.
    const results: SearchResult[] = [];
    const seen = new Set<string>();
    for (const item of fused) {
      const row = byChunk.get(item.key);
      if (!row || seen.has(row.url)) continue;
      seen.add(row.url);
      results.push({
        url: row.url,
        title: row.title,
        snippet: snippet(row.snippet),
        score: item.score,
        ranks: item.ranks,
        provenance: {
          protocol: row.protocol ?? PROTOCOL,
          protocolVersion: row.protocol_version ?? PROTOCOL_VERSION,
          contentHash: row.content_hash,
          fetchedAt: new Date(row.fetched_at).toISOString(),
          attestationUid: row.attestation_uid,
          attestationUrl: attestationUrl(row.attestation_uid),
        },
      });
      if (results.length >= topK) break;
    }
    return results;
  }

  private async vectorSearch(query: string, limit: number): Promise<LexicalHit[]> {
    const [vector] = await this.embedder.embed([query]);
    if (!vector) return [];

    const rows: VectorHit[] = await this.dataSource.query(
      `SELECT c.id AS chunk_id, c.document_id, 1 - (c.embedding <=> $1::vector) AS score
       FROM chunks c
       WHERE c.embedding IS NOT NULL
       ORDER BY c.embedding <=> $1::vector
       LIMIT $2`,
      [toVectorLiteral(vector), limit],
    );
    return rows.map((row) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      score: Number(row.score),
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
