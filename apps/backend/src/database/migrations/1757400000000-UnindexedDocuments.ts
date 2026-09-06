import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Marks a document whose page has stopped yielding indexable content.
 *
 * A page can become unindexable without being deleted: a docs site moves to
 * client-side rendering and starts serving a shell, and the canonicalizer
 * rightly rejects it as thin. Before this, the previously stored content kept
 * being served as a search result forever, because a skipped fetch only wrote
 * a fetch_log row and left `documents` alone.
 *
 * Soft rather than a delete, because the row carries provenance: the hashes,
 * the fetch history, and any attestation uid have to stay verifiable even once
 * the page itself is gone. The stamp is cleared by the next fetch that does
 * produce content, so a site that renders badly once repairs itself.
 */
export class UnindexedDocuments1757400000000 implements MigrationInterface {
  name = 'UnindexedDocuments1757400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE documents ADD COLUMN unindexed_at timestamptz`);
    // Search's hot path filters on this, and the interesting set is the small one.
    await queryRunner.query(
      `CREATE INDEX documents_unindexed_idx ON documents (unindexed_at)
        WHERE unindexed_at IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS documents_unindexed_idx`);
    await queryRunner.query(`ALTER TABLE documents DROP COLUMN IF EXISTS unindexed_at`);
  }
}
