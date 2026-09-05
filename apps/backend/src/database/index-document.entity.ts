import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Membership, and nothing else. A document belongs to as many indexes as asked
 * for it and is stored, crawled and attested exactly once regardless.
 */
@Entity('index_documents')
export class IndexDocumentEntity {
  @PrimaryColumn('uuid', { name: 'index_id' })
  indexId!: string;

  @PrimaryColumn('uuid', { name: 'document_id' })
  documentId!: string;

  @Column('timestamptz', { name: 'added_at', default: () => 'now()' })
  addedAt!: Date;
}
