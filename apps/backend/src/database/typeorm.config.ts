import type { DataSourceOptions } from 'typeorm';
import { ChunkEntity } from './chunk.entity';
import { DocumentEntity } from './document.entity';
import { FetchLogEntity } from './fetch-log.entity';

// Single source of truth for the Postgres connection. Shared by the NestJS
// TypeOrmModule (database.module.ts) and the standalone DataSource that the
// migration CLI uses (data-source.ts), so they can never drift apart.
//
// Bun auto-loads .env, so these read the same values whether invoked by the
// running app or by `bun run migration:*` on the CLI.
export function buildDataSourceOptions(env = process.env): DataSourceOptions {
  return {
    type: 'postgres',
    host: env.POSTGRES_HOST ?? 'localhost',
    port: Number(env.POSTGRES_PORT ?? 5432),
    username: env.POSTGRES_USER ?? 'app',
    password: env.POSTGRES_PASSWORD ?? 'app',
    database: env.POSTGRES_DB ?? 'app',
    entities: [DocumentEntity, FetchLogEntity, ChunkEntity],
    migrations: [__dirname + '/migrations/*.{ts,js}'],
    // Never on, in any environment. The schema carries a `vector` extension and
    // an hnsw index that entities cannot express, so migrations own it outright
    // and synchronize would only drift or drop things.
    synchronize: false,
  };
}
