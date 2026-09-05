import { Inject, Injectable, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PROTOCOL, PROTOCOL_VERSION } from '../canonicalize/v1';
import { createEmbedder, toVectorLiteral, type Embedder } from '../embed/embedder';
import { attestationUrl } from '../verify/verify';
import { reciprocalRankFusion } from './fusion';
import { lexicalSearch, type LexicalHit, type Scope } from './lexical';
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

export interface SearchOptions {
  readonly topK?: number;
  readonly mode?: SearchMode;
  /** The index to search. Callers resolve an absent one to the global index. */
  readonly scope: Scope;
}

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
  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const trimmed = query.trim();
    if (trimmed === '') throw new EmptyQueryError('query must not be blank');

    const { scope } = options;
    const topK = options.topK ?? 10;
    const effectiveMode = options.mode ?? this.config.mode;
    const depth = Math.max(this.config.candidates, topK);

    const [lexical, vector] = await Promise.all([
      effectiveMode === 'vector'
        ? []
        : lexicalSearch(this.dataSource, trimmed, depth, scope, this.config),
      effectiveMode === 'lexical' ? [] : this.vectorSearch(trimmed, depth, scope),
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

  /**
   * The vector arm, scoped to one index's members.
   *
   * Scoping is what makes the hnsw index unsafe to lean on unconditionally. An
   * approximate scan visits a fixed number of candidates across the whole
   * table and discards non-members only afterwards, so an index holding a
   * small share of the store can come back with almost nothing while the
   * chunks it wanted sit just outside the visited set. Below
   * `exactScanChunks` the scoped set is small enough that an exhaustive scan
   * is both cheap and exactly right, and the page cap keeps commissioned
   * indexes in that regime; above it the approximate path is the only
   * affordable one, and a scope that large has the recall an unscoped search
   * would have had anyway.
   */
  private async vectorSearch(query: string, limit: number, scope: Scope): Promise<LexicalHit[]> {
    const [vector] = await this.embedder.embed([query]);
    if (!vector) return [];

    const [{ chunks }] = (await this.dataSource.query(
      `SELECT count(*)::int AS chunks
       FROM chunks c
       JOIN index_documents m ON m.document_id = c.document_id AND m.index_id = $1::uuid
       WHERE c.embedding IS NOT NULL`,
      [scope.indexId],
    )) as [{ chunks: number }];

    const sql = `SELECT c.id AS chunk_id, c.document_id, 1 - (c.embedding <=> $1::vector) AS score
       FROM chunks c
       JOIN index_documents m ON m.document_id = c.document_id AND m.index_id = $3::uuid
       WHERE c.embedding IS NOT NULL
       ORDER BY c.embedding <=> $1::vector
       LIMIT $2`;
    const params = [toVectorLiteral(vector), limit, scope.indexId];

    const rows: VectorHit[] =
      chunks <= this.config.exactScanChunks
        ? await this.dataSource.transaction(async (manager) => {
            // Refusing the hnsw index is the point: an ordered index scan is
            // the approximate path, and a sort over the scoped rows is the
            // exact one. SET LOCAL keeps it to this statement.
            await manager.query(`SET LOCAL enable_indexscan = off`);
            return manager.query(sql, params);
          })
        : await this.dataSource.query(sql, params);

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
