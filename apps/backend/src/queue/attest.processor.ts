import { Processor, WorkerHost } from '@nestjs/bullmq';
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
    });

    this.logger.log(
      `index ${indexId}: attested ${summary.attested} document(s) in ${summary.batches} batch(es)`,
    );
  }
}
