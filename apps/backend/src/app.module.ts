import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health/health.controller';
import { DatabaseModule } from './database/database.module';
import { SearchModule } from './search/search.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule, SearchModule],
  controllers: [HealthController],
})
export class AppModule {}
