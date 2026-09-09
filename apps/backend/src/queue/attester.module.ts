import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  ATTESTATION_SUBMITTER,
  createEasSubmitter,
  type AttestationSubmitter,
} from '../attest/attestor';
import { DatabaseModule } from '../database/database.module';
import { ATTEST_QUEUE } from './attest.queue';
import { AttestProcessor } from './attest.processor';
import { AttestSweeper } from './attest.sweeper';

/**
 * What an attester process is: the attest queue, a processor for it, a
 * database, and the one funded key in the system.
 *
 * Run exactly one. Unlike crawl workers, this cannot be scaled by running more
 * of it: they would all sign from the same account and collide on nonces.
 * Throughput comes from the batch size instead, which is why attestPending
 * uses multiAttest.
 *
 * The submitter is built at boot rather than per job, so a process with no key
 * or a bad one fails to start instead of accepting jobs it cannot do.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? '127.0.0.1',
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
    }),
    BullModule.registerQueue({
      name: ATTEST_QUEUE,
      defaultJobOptions: {
        // Resumable and idempotent: a retry re-queries what still has no UID,
        // so the batches that already landed are not paid for twice.
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
        removeOnComplete: { age: 3_600, count: 100 },
        // Removed rather than kept. The sweepers re-ask by a deterministic job
        // id, and BullMQ treats an id that still exists as already enqueued,
        // so a retained failure silently swallows every re-ask until it ages
        // out. That turns "the queue is a trigger, the database is the record"
        // into a day-long outage for one index: exactly what happened when the
        // attester ran out of gas on 2026-09-08. A failure carries nothing the
        // database does not already know, and the processor logs the error.
        removeOnFail: true,
      },
    }),
  ],
  providers: [
    AttestProcessor,
    AttestSweeper,
    {
      provide: ATTESTATION_SUBMITTER,
      useFactory: (): AttestationSubmitter => createEasSubmitter(),
    },
  ],
})
export class AttesterModule {}
