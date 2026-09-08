import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { CrawlProcessor } from './crawl.processor';
import { CrawlSweeper } from './crawl.sweeper';
import { QueueModule } from './queue.module';

/**
 * What a worker process is: the queue, a processor for it, and a database.
 *
 * No controllers and no HTTP. A worker is scaled by running more of them, so
 * anything that must happen once cannot live here.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DatabaseModule, QueueModule],
  providers: [CrawlProcessor, CrawlSweeper],
})
export class WorkerModule {}
