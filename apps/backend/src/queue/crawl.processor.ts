import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Queue, type Job } from 'bullmq';
import { embedPending } from '../embed/embed';
import { EMBEDDER, type Embedder } from '../embed/embedder';
import { crawlIndexQueue } from '../indexes/index-crawl';
import { ATTEST_QUEUE, attestJobId, type AttestJob } from './attest.queue';
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

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectQueue(ATTEST_QUEUE) private readonly attestQueue: Queue<AttestJob>,
    @Inject(EMBEDDER) @Optional() private readonly embedder?: Embedder,
  ) {
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

    // Crawled is not the same as searchable: retrieval reads chunks, and
    // nothing writes them until a document is embedded. Leaving that to the
    // nightly pass would mean an index someone paid for reports itself ready
    // and then answers nothing until 03:00, which is the same latency the
    // queue exists to remove from the crawl.
    const embedded = await embedPending(this.dataSource, {
      indexId,
      ...(this.embedder ? { embedder: this.embedder } : {}),
    });
    this.logger.log(
      `index ${indexId}: embedded ${embedded.documents} document(s), ${embedded.chunks} chunk(s)`,
    );

    // The page price covers the receipt, so asking for one is not optional and
    // not a separate purchase. It is a different queue because it is the one
    // step that spends gas: the attester holds the key, this process does not.
    //
    // Never fatal. The crawl was paid for and is done; what is owed is still
    // derivable from the documents, and the attest sweeper asks again.
    try {
      await this.attestQueue.add(ATTEST_QUEUE, { indexId }, { jobId: attestJobId(indexId) });
    } catch (error) {
      this.logger.error(
        `could not enqueue attestation for ${indexId}: ` +
          `${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
