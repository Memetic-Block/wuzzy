import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Job } from 'bullmq';
import {
  attestPending,
  ATTESTATION_SUBMITTER,
  type AttestationSubmitter,
} from '../attest/attestor';
import { ATTEST_QUEUE, type AttestJob } from './attest.queue';

/**
 * Writes onchain receipts for one index's embedded documents.
 *
 * Concurrency is one job per attester on purpose, and there should be one
 * attester. Every batch is a transaction from a single funded account, so two
 * of them racing means two transactions built against the same nonce and one
 * of them thrown away after it has already been paid for.
 */
@Processor(ATTEST_QUEUE, { concurrency: 1 })
export class AttestProcessor extends WorkerHost {
  private readonly logger = new Logger(AttestProcessor.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(ATTESTATION_SUBMITTER) private readonly submitter: AttestationSubmitter,
  ) {
    super();
  }

  async process(job: Job<AttestJob>): Promise<void> {
    const { indexId } = job.data;

    const summary = await attestPending(this.dataSource, {
      submitter: this.submitter,
      indexId,
      onBatch: (progress) =>
        this.logger.log(
          `index ${indexId}: attested ${progress.attested}/${progress.total} document(s)`,
        ),
    });

    this.logger.log(
      `index ${indexId}: attested ${summary.attested} document(s) in ${summary.batches} batch(es)`,
    );
  }

  /**
   * Says why a batch failed.
   *
   * Without this a throw goes nowhere: BullMQ emits `failed` and nothing
   * listens, so the run stops mid-batch and the process stays silent. The
   * queue then heals correctly, the sweeper re-asks, the next run throws in
   * the same place, and the only visible symptom is an attested count that
   * stops moving. That cost hours on 2026-09-09, during which the logs read
   * exactly like an idle attester with nothing to do.
   *
   * The work is not lost and is not re-paid for: the queue is `attestation_uid
   * IS NULL`, so a retry re-queries what is still owed. This is here to make
   * the failure sayable, not to change what happens after it.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job<AttestJob> | undefined, error: Error): void {
    this.logger.error(
      `index ${job?.data?.indexId ?? 'unknown'}: attest job failed: ${error?.message ?? error}`,
      error?.stack,
    );
  }

  /** A worker-level fault, which is not attached to any one job. */
  @OnWorkerEvent('error')
  onError(error: Error): void {
    this.logger.error(`attest worker error: ${error?.message ?? error}`, error?.stack);
  }
}
