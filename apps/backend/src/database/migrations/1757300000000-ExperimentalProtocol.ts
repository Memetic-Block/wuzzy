import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Labels the canonicalization procedure experimental.
 *
 * The identifier is not a display string: it is what an attestation carries,
 * and it is half of the pair that tells a verifier which procedure to run. So
 * the stored value has to move with the constant, or a corpus ends up half
 * claiming one procedure and half another while every row was produced by the
 * same code.
 *
 * Safe to rewrite in place only because nothing has been attested yet. Once an
 * attestation references a protocol string, that string is a permanent fact
 * about it and this kind of backfill stops being available.
 */
export class ExperimentalProtocol1757300000000 implements MigrationInterface {
  name = 'ExperimentalProtocol1757300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE documents ALTER COLUMN protocol SET DEFAULT 'wuzzy/crawl-experimental'`,
    );
    await queryRunner.query(
      `UPDATE documents SET protocol = 'wuzzy/crawl-experimental'
        WHERE protocol = 'wuzzy/crawl' AND attestation_uid IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE documents ALTER COLUMN protocol SET DEFAULT 'wuzzy/crawl'`,
    );
    await queryRunner.query(
      `UPDATE documents SET protocol = 'wuzzy/crawl'
        WHERE protocol = 'wuzzy/crawl-experimental' AND attestation_uid IS NULL`,
    );
  }
}
