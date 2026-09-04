import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './typeorm.config';

// Standalone DataSource consumed by the TypeORM CLI for migration:generate,
// migration:run and migration:revert (see package.json scripts). The running
// app does NOT use this file — it builds its options the same way via
// buildDataSourceOptions in database.module.ts.
export default new DataSource(buildDataSourceOptions());
