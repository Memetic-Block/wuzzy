import type { DataSource } from 'typeorm';

/**
 * BM25 over chunk text, computed in SQL.
 *
 * Postgres supplies the tokenising, stemming and the GIN index; the ranking is
 * ours, because `ts_rank`/`ts_rank_cd` are not BM25 and lack both the IDF term
 * and length normalisation that make BM25 behave on a corpus of very uneven
 * page lengths.
 *
 * The formula is the standard one:
 *
 *   score(q, d) = SUM over t in q of  IDF(t) * ( tf * (k1 + 1) )
 *                                     -----------------------------------
 *                                     ( tf + k1 * (1 - b + b * dl / avgdl) )
 *
 *   IDF(t) = ln(1 + (N - df + 0.5) / (df + 0.5))
 *
 * with the +1 inside the log, which keeps IDF non-negative for terms that
 * appear in more than half the corpus rather than letting them subtract from
 * the score.
 */
export interface LexicalHit {
  readonly chunkId: string;
  readonly documentId: string;
  readonly score: number;
}

export interface Bm25Params {
  /** Term-frequency saturation. Higher means repeats keep counting for longer. */
  readonly k1?: number;
  /** Length normalisation, 0 = off, 1 = full. */
  readonly b?: number;
}

export const DEFAULT_K1 = 1.2;
export const DEFAULT_B = 0.75;

/**
 * Candidates come from the GIN index with OR semantics rather than the AND that
 * `plainto_tsquery` produces: a long natural-language question shares few exact
 * terms with any one chunk, and requiring all of them returns nothing. BM25
 * then does the discriminating, which is what it is for.
 */
export async function lexicalSearch(
  dataSource: DataSource,
  query: string,
  limit: number,
  params: Bm25Params = {},
): Promise<LexicalHit[]> {
  const k1 = params.k1 ?? DEFAULT_K1;
  const b = params.b ?? DEFAULT_B;

  const rows = await dataSource.query(
    `
    WITH terms AS (
      -- Stem the query the same way the documents were stemmed, so the lexemes
      -- on both sides are directly comparable.
      SELECT DISTINCT lexeme FROM unnest(to_tsvector('english', $1))
    ),
    query AS (
      SELECT to_tsquery('simple', string_agg(quote_literal(lexeme), ' | ')) AS tsq
      FROM terms
    ),
    corpus AS (
      SELECT count(*)::float8 AS n, coalesce(avg(term_count), 0)::float8 AS avgdl
      FROM chunks
    ),
    document_frequency AS (
      SELECT t.lexeme,
             (SELECT count(*) FROM chunks c
               WHERE c.tsv @@ to_tsquery('simple', quote_literal(t.lexeme)))::float8 AS df
      FROM terms t
    ),
    candidates AS (
      SELECT c.id, c.document_id, c.tsv, c.term_count
      FROM chunks c, query q
      WHERE q.tsq IS NOT NULL AND c.tsv @@ q.tsq
    ),
    scored AS (
      SELECT cand.id,
             cand.document_id,
             sum(
               ln(1 + (corpus.n - df.df + 0.5) / (df.df + 0.5))
               * (tf.freq * ($2::float8 + 1))
               / (tf.freq + $2::float8 * (1 - $3::float8 + $3::float8 * cand.term_count / nullif(corpus.avgdl, 0)))
             ) AS score
      FROM candidates cand
      CROSS JOIN corpus
      JOIN LATERAL (
        SELECT u.lexeme, coalesce(array_length(u.positions, 1), 1)::float8 AS freq
        FROM unnest(cand.tsv) u
        WHERE u.lexeme IN (SELECT lexeme FROM terms)
      ) tf ON true
      JOIN document_frequency df ON df.lexeme = tf.lexeme
      GROUP BY cand.id, cand.document_id
    )
    SELECT id, document_id, score FROM scored
    WHERE score IS NOT NULL
    ORDER BY score DESC
    LIMIT $4::int
    `,
    [query, k1, b, limit],
  );

  return rows.map((row: { id: string; document_id: string; score: string }) => ({
    chunkId: row.id,
    documentId: row.document_id,
    score: Number(row.score),
  }));
}
