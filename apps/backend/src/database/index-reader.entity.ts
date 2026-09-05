import { Column, Entity, PrimaryColumn } from 'typeorm';

/** The allowlist for an index whose read_policy is `allowlist`. */
@Entity('index_readers')
export class IndexReaderEntity {
  @PrimaryColumn('uuid', { name: 'index_id' })
  indexId!: string;

  /** Permitted wallet, lowercased. */
  @PrimaryColumn('text')
  wallet!: string;

  @Column('timestamptz', { name: 'added_at', default: () => 'now()' })
  addedAt!: Date;
}
