import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AttesterModule } from './queue/attester.module';

/**
 * The attester. Same image as the API, different entry point.
 *
 *   bun apps/backend/src/attester.ts
 *
 * Runs no HTTP server: it takes jobs off the attest queue and writes onchain
 * receipts for them until it is stopped.
 *
 * Run exactly one. It is the only process holding a funded key, and a second
 * would sign from the same account and collide on nonces. More throughput is a
 * larger multiAttest batch, not more attesters.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AttesterModule);
  app.enableShutdownHooks();
  console.log('attester ready');
}

void bootstrap();
