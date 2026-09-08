import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Queue } from 'bullmq';
import { CRAWL_QUEUE, crawlJobId, type CrawlJob } from './crawl.queue';

/**
 * Enqueues any index with URLs still owed, on an interval.
 *
 * The API enqueues when a commission is paid for, which is what makes a crawl
 * start in seconds rather than at some later sweep. This exists for every way
 * that can fail to happen: Redis unreachable at the moment of payment, a job
 * dropped, a worker killed mid-crawl, or rows written by the CLI rather than
 * by the API.
 *
 * It is what makes "a lost job delays a crawl and cannot lose one" true. The
 * debt is in Postgres; this keeps asking until it is paid.
 */
@Injectable()
export class CrawlSweeper implements OnApplicationBootstrap {
  private readonly logger = new Logger(CrawlSweeper.name);
  private readonly intervalMs = Number(process.env.CRAWL_SWEEP_INTERVAL_MS ?? 60_000);
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectQueue(CRAWL_QUEUE) private readonly queue: Queue<CrawlJob>,
  ) {}

  onApplicationBootstrap(): void {
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), this.intervalMs);
    // Nothing here should hold a worker open when it is asked to stop.
    this.timer.unref?.();
  }

  async sweep(): Promise<number> {
    const owed: { index_id: string }[] = await this.dataSource.query(
      `SELECT DISTINCT index_id FROM index_urls WHERE crawled_at IS NULL`,
    );

    for (const row of owed) {
      // Same job id as the API uses, so a sweep during a running crawl is a
      // no-op rather than a second crawler over the same rows.
      //
      // Per index, and swallowing failures: this runs on a timer inside every
      // worker, so an unhandled rejection here does not delay one crawl, it
      // takes down the process that was going to do all of them.
      try {
        await this.queue.add(
          CRAWL_QUEUE,
          { indexId: row.index_id },
          { jobId: crawlJobId(row.index_id) },
        );
      } catch (error) {
        this.logger.error(
          `could not enqueue ${row.index_id}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    if (owed.length > 0) this.logger.log(`swept ${owed.length} index(es) with work outstanding`);
    return owed.length;
  }
}
