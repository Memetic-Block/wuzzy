import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The lexical half of hybrid search.
 *
 * Postgres full-text search supplies tokenisation, stemming and a GIN index,
 * but its ranking functions are not BM25: `ts_rank_cd` scores coverage density
 * with no IDF term and no document-length saturation. The scoring is therefore
 * computed in the query (see search/lexical.ts) from the primitives stored
 * here: a stemmed tsvector, and the token count that BM25 needs as `dl`.
 *
 * `length(tsvector)` counts distinct lexemes rather than tokens, which would
 * understate long repetitive chunks, so token count is summed from the position
 * lists instead.
 */
export class LexicalIndex1757100000000 implements MigrationInterface {
  name = 'LexicalIndex1757100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE FUNCTION wuzzy_token_count(document tsvector) RETURNS integer
      LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
        SELECT coalesce(sum(coalesce(array_length(positions, 1), 1)), 0)::int
        FROM unnest(document)
      $$
    `);

    // Generated and stored rather than maintained by the application: the
    // lexical index cannot then drift from the text it indexes.
    await queryRunner.query(`
      ALTER TABLE chunks
        ADD COLUMN tsv tsvector
          GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,
        ADD COLUMN term_count integer
          GENERATED ALWAYS AS (wuzzy_token_count(to_tsvector('english', text))) STORED
    `);

    await queryRunner.query(`CREATE INDEX chunks_tsv_gin ON chunks USING gin (tsv)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS chunks_tsv_gin`);
    await queryRunner.query(`ALTER TABLE chunks DROP COLUMN IF EXISTS term_count`);
    await queryRunner.query(`ALTER TABLE chunks DROP COLUMN IF EXISTS tsv`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS wuzzy_token_count(tsvector)`);
  }
}
