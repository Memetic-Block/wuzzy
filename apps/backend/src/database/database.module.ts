import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChunkEntity } from './chunk.entity';
import { DocumentEntity } from './document.entity';
import { FetchLogEntity } from './fetch-log.entity';
import { IndexDocumentEntity } from './index-document.entity';
import { IndexReaderEntity } from './index-reader.entity';
import { IndexUrlEntity } from './index-url.entity';
import { IndexEntity } from './index.entity';
import { buildDataSourceOptions } from './typeorm.config';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        ...buildDataSourceOptions(),
        // Run pending migrations on startup when DB_MIGRATIONS_RUN=true. Handy
        // for single-instance deploys; for multi-replica rollouts prefer a
        // dedicated `bun run migration:run` step (see README) so only one
        // process migrates.
        migrationsRun: process.env.DB_MIGRATIONS_RUN === 'true',
      }),
    }),
    TypeOrmModule.forFeature([
      DocumentEntity,
      FetchLogEntity,
      ChunkEntity,
      IndexEntity,
      IndexDocumentEntity,
      IndexReaderEntity,
      IndexUrlEntity,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
