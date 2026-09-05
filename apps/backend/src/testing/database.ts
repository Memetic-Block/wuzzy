import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../database/typeorm.config';

/**
 * Connects for a spec, or reports why it cannot.
 *
 * Under CI the service is always provided, so an unreachable database is a real
 * failure. Locally it is a reason to skip rather than to fail a whole suite.
 */
export async function connectForTests(): Promise<
  { dataSource: DataSource; skip: false } | { dataSource: undefined; skip: true; reason: string }
> {
  try {
    return { dataSource: await new DataSource(buildDataSourceOptions()).initialize(), skip: false };
  } catch (error) {
    if (process.env.CI) throw error;
    return { dataSource: undefined, skip: true, reason: (error as Error).message };
  }
}

/**
 * Empties every table the pipeline writes and returns the index tables to what
 * the migration left behind.
 *
 * Called before a suite as well as after each test: a spec that counts rows
 * must not depend on the database being pristine, or a leftover row from a
 * manual `wuzzy crawl` makes it fail for reasons that have nothing to do with
 * the code under test.
 *
 * `indexes` is reset rather than truncated, because the global index is
 * schema, not data: every unscoped search resolves to it, so a suite that
 * truncated it away would be testing an installation that cannot exist.
 */
export async function truncateWuzzyTables(dataSource: DataSource | undefined): Promise<void> {
  if (!dataSource) return;
  await dataSource.query(
    `TRUNCATE chunks, fetch_log, documents, index_documents, index_urls, index_readers
     RESTART IDENTITY CASCADE`,
  );
  await dataSource.query(`DELETE FROM indexes WHERE slug <> 'global'`);
  await dataSource.query(
    `UPDATE indexes
        SET owner = '0x0000000000000000000000000000000000000000',
            visibility = 'listed', read_policy = 'open', page_cap = NULL
      WHERE slug = 'global'`,
  );
}

/**
 * The global index's id. Specs that seed documents directly have to join them
 * to it, because search is always scoped and an unscoped query is a scoped one
 * that resolved to global.
 */
export async function globalIndexId(dataSource: DataSource): Promise<string> {
  const [row] = await dataSource.query(`SELECT id FROM indexes WHERE slug = 'global'`);
  if (!row) throw new Error('no global index: has the Indexes migration run?');
  return row.id as string;
}

/** Joins a document to an index, the way a crawl would. */
export async function joinIndex(
  dataSource: DataSource,
  indexId: string,
  documentId: string,
): Promise<void> {
  await dataSource.query(
    `INSERT INTO index_documents (index_id, document_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [indexId, documentId],
  );
}
