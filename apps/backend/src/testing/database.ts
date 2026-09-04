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
 * Empties every table the pipeline writes.
 *
 * Called before a suite as well as after each test: a spec that counts rows
 * must not depend on the database being pristine, or a leftover row from a
 * manual `wuzzy crawl` makes it fail for reasons that have nothing to do with
 * the code under test.
 */
export async function truncateWuzzyTables(dataSource: DataSource | undefined): Promise<void> {
  if (!dataSource) return;
  await dataSource.query('TRUNCATE chunks, fetch_log, documents RESTART IDENTITY CASCADE');
}
