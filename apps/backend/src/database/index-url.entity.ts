import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A URL an index has paid for but the store does not hold yet. Pipeline stages
 * are CLI commands rather than queue workers, so this table is the queue and
 * `wuzzy crawl --index` is the worker.
 */
@Entity('index_urls')
export class IndexUrlEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Column('uuid', { name: 'index_id' })
  indexId!: string;

  @Column('text')
  url!: string;

  @Column('timestamptz', { name: 'requested_at', default: () => 'now()' })
  requestedAt!: Date;

  /** Set once the crawler has been through it, successfully or not. */
  @Column('timestamptz', { name: 'crawled_at', nullable: true })
  crawledAt!: Date | null;

  @Column('text', { nullable: true })
  error!: string | null;
}
