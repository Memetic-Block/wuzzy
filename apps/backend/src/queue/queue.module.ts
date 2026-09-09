import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ATTEST_QUEUE } from './attest.queue';
import { CRAWL_QUEUE } from './crawl.queue';

/**
 * The producer side: what the API needs in order to ask for a crawl.
 *
 * Deliberately does not register the processor. Importing this module makes a
 * process able to enqueue; it does not make it a worker. That separation is
 * the point of having workers at all, since a crawl inside the API process
 * would compete with serving requests for the same CPU.
 */
@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? '127.0.0.1',
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
    }),
    // Producer side only. A process importing this can ask for an attestation;
    // only the attester, which holds the key, can perform one.
    BullModule.registerQueue({
      name: ATTEST_QUEUE,
      defaultJobOptions: {
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
    BullModule.registerQueue({
      name: CRAWL_QUEUE,
      defaultJobOptions: {
        // A crawl is resumable and idempotent: it drains whatever is still
        // pending, so retrying one costs a re-query and not a re-fetch.
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
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
  exports: [BullModule],
})
export class QueueModule {}
