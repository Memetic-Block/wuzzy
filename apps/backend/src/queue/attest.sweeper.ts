import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Queue } from 'bullmq';
import { ATTEST_QUEUE, attestJobId, type AttestJob } from './attest.queue';

/**
 * Enqueues any index holding embedded documents that carry no attestation.
 *
 * The crawl worker enqueues when it finishes embedding, which is what makes a
 * receipt land in the same minute as the crawl. This exists for every way that
 * can fail to happen: Redis unreachable at that moment, a job dropped, an
 * attester killed mid-batch, or documents whose content changed and had their
 * UID cleared by a later crawl.
 *
 * The debt is derivable rather than stored: embedded, unattested and a member
 * of some index. That is the same set the attester drains, so this cannot ask
 * for work the attester would not do.
 */
@Injectable()
export class AttestSweeper implements OnApplicationBootstrap {
  private readonly logger = new Logger(AttestSweeper.name);
  private readonly intervalMs = Number(process.env.ATTEST_SWEEP_INTERVAL_MS ?? 60_000);
  private timer: ReturnType<typeof setInterval> | undefined;
  /**
   * What the last sweep found, so a steady state stays quiet. An attest pass
   * over a large index takes many minutes, and every sweep during it re-enqueues
   * a job id that already exists, which BullMQ correctly ignores. Logging that
   * each time prints a line a minute that reads like a retry loop failing, next
   * to a processor that says nothing until it finishes.
   */
  private previous = '';

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectQueue(ATTEST_QUEUE) private readonly queue: Queue<AttestJob>,
  ) {}

  onApplicationBootstrap(): void {
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), this.intervalMs);
    this.timer.unref?.();
  }

  /**
   * Asks for one index, and means it.
   *
   * BullMQ deduplicates on the job id, which is what stops two attesters
   * racing the same index. But an id belonging to a job that has already
   * finished counts too, so once a job fails, every later `add` returns that
   * dead job instead of enqueueing work, and does it without erroring. The
   * sweeper then runs every minute doing nothing at all, which is how one
   * out-of-gas attester left an index unattested while the logs said it was
   * being swept.
   *
   * So a finished job holding the id is cleared and the ask repeated. Nothing
   * is lost by removing it: what is owed lives in the database, and the error
   * was logged when it happened.
   */
  private async enqueue(indexId: string): Promise<void> {
    const jobId = attestJobId(indexId);
    const job = await this.queue.add(ATTEST_QUEUE, { indexId }, { jobId });

    const state = await job.getState();
    if (state !== 'completed' && state !== 'failed') return;

    await job.remove();
    await this.queue.add(ATTEST_QUEUE, { indexId }, { jobId });
    this.logger.warn(`cleared a ${state} attest job holding ${jobId} and asked again`);
  }

  async sweep(): Promise<number> {
    const owed: { index_id: string }[] = await this.dataSource.query(
      `SELECT DISTINCT m.index_id
         FROM index_documents m
         JOIN documents d ON d.id = m.document_id
        WHERE d.embedded_at IS NOT NULL AND d.attestation_uid IS NULL`,
    );

    for (const row of owed) {
      // Per index, and swallowing failures: this runs on a timer, so an
      // unhandled rejection here would not delay one index's receipts, it
      // would take down the process that was going to attest all of them.
      try {
        await this.enqueue(row.index_id);
      } catch (error) {
        this.logger.error(
          `could not enqueue ${row.index_id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    const current = owed
      .map((row) => row.index_id)
      .sort()
      .join(',');
    if (current !== this.previous) {
      if (owed.length > 0) {
        this.logger.log(`swept ${owed.length} index(es) awaiting attestation`);
      } else if (this.previous !== '') {
        this.logger.log('every index is fully attested');
      }
      this.previous = current;
    }
    return owed.length;
  }
}
