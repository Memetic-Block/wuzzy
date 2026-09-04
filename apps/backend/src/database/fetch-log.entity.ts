import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { DocumentEntity } from './document.entity';

/**
 * Append-only record of every fetch the crawler actually performed. Rows are
 * inserted, never updated or deleted; a URL that robots.txt disallows produces
 * no row at all, because it is never fetched.
 */
@Entity('fetch_log')
export class FetchLogEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @ManyToOne(() => DocumentEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'document_id' })
  document!: DocumentEntity | null;

  @Column('uuid', { name: 'document_id', nullable: true })
  documentId!: string | null;

  @Column('text')
  url!: string;

  @Column('integer', { name: 'http_status', nullable: true })
  httpStatus!: number | null;

  @Column('char', { length: 64, name: 'raw_hash', nullable: true })
  rawHash!: string | null;

  @Column('char', { length: 64, name: 'content_hash', nullable: true })
  contentHash!: string | null;

  /** True when this fetch moved the document's contentHash. */
  @Column('boolean', { name: 'content_changed', default: false })
  contentChanged!: boolean;

  /** Set when the fetch succeeded but produced no document, e.g. a thin page. */
  @Column('text', { name: 'skipped_reason', nullable: true })
  skippedReason!: string | null;

  @Column('text', { nullable: true })
  error!: string | null;

  @Column('timestamptz', { name: 'fetched_at', default: () => 'now()' })
  fetchedAt!: Date;
}
