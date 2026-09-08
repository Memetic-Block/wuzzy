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

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectQueue(ATTEST_QUEUE) private readonly queue: Queue<AttestJob>,
  ) {}

  onApplicationBootstrap(): void {
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), this.intervalMs);
    this.timer.unref?.();
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
        await this.queue.add(
          ATTEST_QUEUE,
          { indexId: row.index_id },
          { jobId: attestJobId(row.index_id) },
        );
      } catch (error) {
        this.logger.error(
          `could not enqueue ${row.index_id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    if (owed.length > 0) this.logger.log(`swept ${owed.length} index(es) awaiting attestation`);
    return owed.length;
  }
}
