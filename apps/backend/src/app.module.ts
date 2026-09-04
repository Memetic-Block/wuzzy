import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health/health.controller';
import { HelloController } from './hello/hello.controller';
// Remove the next two imports (and their folders) to drop Postgres/Redis — see README.
import { DatabaseModule } from './database/database.module';
import { QueueModule } from './queue/queue.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    QueueModule,
  ],
  controllers: [HealthController, HelloController],
})
export class AppModule {}
