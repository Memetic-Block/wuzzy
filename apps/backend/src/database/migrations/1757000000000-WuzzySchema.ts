import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The wuzzy crawl/index schema. Raw SQL rather than generated from entities:
 * the `vector` extension and the hnsw index have no entity expression, and the
 * whole schema has to arrive in one piece for `synchronize` to stay off.
 */
export class WuzzySchema1757000000000 implements MigrationInterface {
  name = 'WuzzySchema1757000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    await queryRunner.query(`
      CREATE TABLE documents (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        url              text NOT NULL UNIQUE,
        title            text,
        content          text NOT NULL,
        raw_hash         char(64) NOT NULL,
        content_hash     char(64) NOT NULL,
        protocol         text NOT NULL DEFAULT 'wuzzy/crawl',
        protocol_version integer NOT NULL,
        robots_status    text NOT NULL,
        http_status      integer NOT NULL,
        fetched_at       timestamptz NOT NULL,
        embedded_at      timestamptz,
        attestation_uid  char(66),
        attested_at      timestamptz,
        created_at       timestamptz NOT NULL DEFAULT now(),
        updated_at       timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX documents_content_hash_idx ON documents (content_hash)`);
    // The attestor's work queue: indexed documents with no attestation yet.
    await queryRunner.query(
      `CREATE INDEX documents_unattested_idx ON documents (updated_at) WHERE attestation_uid IS NULL`,
    );
    // The embed pass's work queue, same shape.
    await queryRunner.query(
      `CREATE INDEX documents_unembedded_idx ON documents (updated_at) WHERE embedded_at IS NULL`,
    );

    // Append-only. Rows are never updated or deleted, and a document row being
    // replaced must not erase the history of how it got there, so the FK is
    // ON DELETE SET NULL and `url` is carried independently.
    await queryRunner.query(`
      CREATE TABLE fetch_log (
        id              bigserial PRIMARY KEY,
        document_id     uuid REFERENCES documents(id) ON DELETE SET NULL,
        url             text NOT NULL,
        http_status     integer,
        raw_hash        char(64),
        content_hash    char(64),
        content_changed boolean NOT NULL DEFAULT false,
        skipped_reason  text,
        error           text,
        fetched_at      timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX fetch_log_url_idx ON fetch_log (url, fetched_at DESC)`);
    await queryRunner.query(`CREATE INDEX fetch_log_document_idx ON fetch_log (document_id)`);

    await queryRunner.query(`
      CREATE TABLE chunks (
        id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id  uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        ordinal      integer NOT NULL,
        text         text NOT NULL,
        token_count  integer,
        embedding    vector(1536),
        embedded_at  timestamptz,
        UNIQUE (document_id, ordinal)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS chunks`);
    await queryRunner.query(`DROP TABLE IF EXISTS fetch_log`);
    await queryRunner.query(`DROP TABLE IF EXISTS documents`);
    // The extension is left in place: other schemas in the same database may
    // depend on it, and re-creating it is cheap.
  }
}
