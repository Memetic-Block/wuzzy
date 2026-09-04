import type { DataSourceOptions } from 'typeorm';
import { ExampleEntity } from './example.entity';

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
    entities: [ExampleEntity],
    migrations: [__dirname + '/migrations/*.{ts,js}'],
    // Auto-create the schema from entities. Defaults on outside production;
    // DB_SYNCHRONIZE overrides it (compose.full.yml sets it true so the demo
    // works without migrations). In stage/live leave it off and use migrations.
    synchronize: (env.DB_SYNCHRONIZE ?? String(env.NODE_ENV !== 'production')) === 'true',
  };
}
