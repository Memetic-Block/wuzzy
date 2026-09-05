import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Indexes as a primitive, per contracts/indexes.feature. An index is a view
 * over the one shared document store, not a silo: membership is a join table,
 * so a URL two indexes both want is crawled and attested once.
 *
 * "Global" is not a special case in the schema. It is a row like any other,
 * owned by the operator wallet with visibility=listed and read_policy=open,
 * and this migration backfills every document already crawled into it.
 */
export class Indexes1757200000000 implements MigrationInterface {
  name = 'Indexes1757200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE indexes (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        slug        text NOT NULL UNIQUE,
        name        text NOT NULL,
        owner       text NOT NULL,
        visibility  text NOT NULL DEFAULT 'listed',
        read_policy text NOT NULL DEFAULT 'open',
        page_cap    integer,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT indexes_visibility_check CHECK (visibility IN ('listed', 'unlisted')),
        CONSTRAINT indexes_read_policy_check CHECK (read_policy IN ('open', 'allowlist')),
        -- Addresses are stored lowercased so membership and ownership compare
        -- as bytes. Checksum casing is a display concern, and a mixed-case
        -- duplicate of an allowlisted wallet must not be a distinct row.
        CONSTRAINT indexes_owner_lowercase CHECK (owner = lower(owner))
      )
    `);
    await queryRunner.query(`CREATE INDEX indexes_owner_idx ON indexes (owner)`);
    // The public catalog's only query: listed indexes, newest first.
    await queryRunner.query(
      `CREATE INDEX indexes_catalog_idx ON indexes (created_at DESC) WHERE visibility = 'listed'`,
    );

    await queryRunner.query(`
      CREATE TABLE index_readers (
        index_id uuid NOT NULL REFERENCES indexes(id) ON DELETE CASCADE,
        wallet   text NOT NULL,
        added_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (index_id, wallet),
        CONSTRAINT index_readers_wallet_lowercase CHECK (wallet = lower(wallet))
      )
    `);

    // Membership only. Deleting an index drops its rows here and touches no
    // document, which is what makes "deleting an index removes membership
    // only" true by construction rather than by careful application code.
    await queryRunner.query(`
      CREATE TABLE index_documents (
        index_id    uuid NOT NULL REFERENCES indexes(id) ON DELETE CASCADE,
        document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        added_at    timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (index_id, document_id)
      )
    `);
    // Scoped search joins from chunks through documents, so the reverse
    // direction needs its own index.
    await queryRunner.query(
      `CREATE INDEX index_documents_document_idx ON index_documents (document_id)`,
    );

    // The crawl queue. Stages are CLI commands rather than queue workers, so
    // "enqueued" means a row here that `wuzzy crawl --index` drains. It is also
    // the only input to an index's status: no status column exists, because a
    // stored one can disagree with the queue and a derived one cannot.
    await queryRunner.query(`
      CREATE TABLE index_urls (
        id           bigserial PRIMARY KEY,
        index_id     uuid NOT NULL REFERENCES indexes(id) ON DELETE CASCADE,
        url          text NOT NULL,
        requested_at timestamptz NOT NULL DEFAULT now(),
        crawled_at   timestamptz,
        error        text,
        UNIQUE (index_id, url)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX index_urls_pending_idx ON index_urls (index_id) WHERE crawled_at IS NULL`,
    );

    // The operator wallet is configuration, not schema, so the row starts
    // ownerless and the service reconciles it against WUZZY_OPERATOR_WALLET.
    await queryRunner.query(`
      INSERT INTO indexes (slug, name, owner, visibility, read_policy, page_cap)
      VALUES ('global', 'Wuzzy global index', '0x0000000000000000000000000000000000000000',
              'listed', 'open', NULL)
    `);
    await queryRunner.query(`
      INSERT INTO index_documents (index_id, document_id)
      SELECT (SELECT id FROM indexes WHERE slug = 'global'), id FROM documents
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS index_urls`);
    await queryRunner.query(`DROP TABLE IF EXISTS index_documents`);
    await queryRunner.query(`DROP TABLE IF EXISTS index_readers`);
    await queryRunner.query(`DROP TABLE IF EXISTS indexes`);
  }
}
