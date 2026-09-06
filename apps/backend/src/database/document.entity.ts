import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Latest known state of one indexed URL. Provenance history lives in fetch_log. */
@Entity('documents')
export class DocumentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column('text')
  url!: string;

  @Column('text', { nullable: true })
  title!: string | null;

  /** Canonical markdown under `protocol` / `protocolVersion`. */
  @Column('text')
  content!: string;

  /** sha256 over the exact bytes received from the origin. */
  @Column('char', { length: 64, name: 'raw_hash' })
  rawHash!: string;

  /** sha256 over the canonical markdown. This is what gets attested. */
  @Column('char', { length: 64, name: 'content_hash' })
  contentHash!: string;

  @Column('text', { default: 'wuzzy/crawl-experimental' })
  protocol!: string;

  @Column('integer', { name: 'protocol_version' })
  protocolVersion!: number;

  @Column('text', { name: 'robots_status' })
  robotsStatus!: string;

  @Column('integer', { name: 'http_status' })
  httpStatus!: number;

  @Column('timestamptz', { name: 'fetched_at' })
  fetchedAt!: Date;

  /** Cleared whenever contentHash changes, so the embed pass picks it up again. */
  @Column('timestamptz', { name: 'embedded_at', nullable: true })
  embeddedAt!: Date | null;

  /** Cleared alongside embeddedAt, so the attestor re-attests the new content. */
  @Column('char', { length: 66, name: 'attestation_uid', nullable: true })
  attestationUid!: string | null;

  @Column('timestamptz', { name: 'attested_at', nullable: true })
  attestedAt!: Date | null;

  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at', default: () => 'now()' })
  updatedAt!: Date;
}
