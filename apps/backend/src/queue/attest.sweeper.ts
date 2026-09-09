import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Queue } from 'bullmq';
import { ATTEST_QUEUE, attestJobId, type AttestJob } from './attest.queue';

/** Sweeps a job may sit in flight before the log stops being polite about it. */
const STUCK_SWEEPS = 5;

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
  /**
   * Whether this process has swept yet. The first sweep is allowed to clear a
   * job in any state, which no later sweep may do.
   */
  private swept = false;
  /** How many consecutive sweeps have found a job already in flight. */
  private readonly waitingOn = new Map<string, { state: string; sweeps: number }>();

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
    // A finished job still holds its id, so every later `add` returns the dead
    // job instead of enqueueing work, and does it without erroring. On the
    // first sweep after a boot an *unfinished* job is stale too: exactly one
    // attester runs, and it is this process, which has only just started, so a
    // job someone claimed to be running belongs to a process that is gone.
    // That is what left an orphaned `active` job blocking the queue across a
    // restart on 2026-09-09, with the sweeper skipping it in silence.
    const stale = state === 'completed' || state === 'failed' || !this.swept;
    if (!stale) {
      this.report(jobId, state);
      return;
    }
    this.waitingOn.delete(jobId);

    await job.remove();
    await this.queue.add(ATTEST_QUEUE, { indexId }, { jobId });
    this.logger.warn(`cleared a ${state} attest job holding ${jobId} and asked again`);
  }

  /**
   * Says when a job has been in flight across several sweeps.
   *
   * A steady state should be quiet, but silence must never be the only thing a
   * stuck attester produces. Skipping an in-flight job is normal for the
   * minutes a large batch takes and pathological after that, and the two are
   * indistinguishable from the outside unless this says so.
   */
  private report(jobId: string, state: string): void {
    const seen = this.waitingOn.get(jobId);
    const sweeps = seen?.state === state ? seen.sweeps + 1 : 1;
    this.waitingOn.set(jobId, { state, sweeps });
    if (sweeps === 1 || sweeps % STUCK_SWEEPS === 0) {
      const how = sweeps === 1 ? 'is' : `has been, for ${sweeps} sweeps,`;
      this.logger[sweeps === 1 ? 'log' : 'warn'](`${jobId} ${how} ${state}; not asking again yet`);
    }
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
    // Set last: everything above ran as this process's first sweep, and only
    // that sweep may clear a job someone claims to be running.
    this.swept = true;
    return owed.length;
  }
}
