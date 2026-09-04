import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { DocumentEntity } from './document.entity';

/** One embeddable slice of a document's canonical markdown. */
@Entity('chunks')
@Unique(['documentId', 'ordinal'])
export class ChunkEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // One-directional on purpose: an inverse side on DocumentEntity makes the two
  // entity modules import each other, and emitDecoratorMetadata evaluates the
  // relation type eagerly, so the cycle throws at class-definition time.
  @ManyToOne(() => DocumentEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document!: DocumentEntity;

  @Column('uuid', { name: 'document_id' })
  documentId!: string;

  @Column('integer')
  ordinal!: number;

  @Column('text')
  text!: string;

  @Column('integer', { name: 'token_count', nullable: true })
  tokenCount!: number | null;

  /**
   * Written as a pgvector literal string (`'[0.1,0.2,...]'`); pg reads it back
   * as a number array. The hnsw index over this column is created in the
   * migration, since TypeORM cannot express it.
   */
  @Column('vector', { length: 1536, nullable: true })
  embedding!: number[] | null;

  @Column('timestamptz', { name: 'embedded_at', nullable: true })
  embeddedAt!: Date | null;
}
