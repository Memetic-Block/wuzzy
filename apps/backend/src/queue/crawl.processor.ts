import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Job } from 'bullmq';
import { crawlIndexQueue } from '../indexes/index-crawl';
import { CRAWL_QUEUE, type CrawlJob } from './crawl.queue';

/**
 * Drains one index's outstanding URLs.
 *
 * Concurrency is one job per worker on purpose. The crawler already runs its
 * own requests in parallel and spaces them per host; a second crawl inside the
 * same process would double the rate at a site without either half knowing,
 * which is how a polite crawler stops being one. More throughput is more
 * workers, which is what the queue is for.
 */
@Processor(CRAWL_QUEUE, { concurrency: 1 })
export class CrawlProcessor extends WorkerHost {
  private readonly logger = new Logger(CrawlProcessor.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    super();
  }

  async process(job: Job<CrawlJob>): Promise<void> {
    const { indexId } = job.data;
    this.logger.log(`crawling index ${indexId}`);

    const result = await crawlIndexQueue(this.dataSource, indexId);

    this.logger.log(
      `index ${indexId}: requested ${result.requested}, indexed ${result.indexed}, ` +
        `skipped ${result.skipped}, failed ${result.failed}`,
    );
  }
}
