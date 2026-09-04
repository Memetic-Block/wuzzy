import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExampleController } from './example.controller';
import { ExampleEntity } from './example.entity';
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
    // Makes the ExampleEntity repository injectable into ExampleController.
    TypeOrmModule.forFeature([ExampleEntity]),
  ],
  controllers: [ExampleController],
})
export class DatabaseModule {}
