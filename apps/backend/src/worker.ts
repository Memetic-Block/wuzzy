import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './queue/worker.module';

/**
 * A crawl worker. Same image as the API, different entry point.
 *
 *   bun apps/backend/src/worker.ts
 *
 * Runs no HTTP server: it takes jobs off the queue until it is stopped. Run
 * more of them for more throughput; they coordinate through Redis and each
 * index is only ever crawled by one at a time.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  console.log('crawl worker ready');
}

void bootstrap();
