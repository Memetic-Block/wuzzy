import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type IndexVisibility = 'listed' | 'unlisted';
export type IndexReadPolicy = 'open' | 'allowlist';

/**
 * One index: a named, owned, access-controlled view over the shared document
 * store. The global index is a row like any other, which is why nothing here
 * is nullable for its sake except the page cap it does not have.
 *
 * There is no status column. Status is derived from the crawl queue, so it
 * cannot drift out of agreement with the work actually outstanding.
 */
@Entity('indexes')
export class IndexEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column('text')
  slug!: string;

  @Column('text')
  name!: string;

  /** Owning wallet, lowercased. Enforced by a CHECK constraint too. */
  @Column('text')
  owner!: string;

  @Column('text')
  visibility!: IndexVisibility;

  @Column('text', { name: 'read_policy' })
  readPolicy!: IndexReadPolicy;

  /** Maximum pages this index may hold. NULL means uncapped (global only). */
  @Column('integer', { name: 'page_cap', nullable: true })
  pageCap!: number | null;

  @Column('timestamptz', { name: 'created_at', default: () => 'now()' })
  createdAt!: Date;

  @Column('timestamptz', { name: 'updated_at', default: () => 'now()' })
  updatedAt!: Date;
}
