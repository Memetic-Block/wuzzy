import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

export const EXAMPLE_QUEUE = 'example';

@Processor(EXAMPLE_QUEUE)
export class ExampleProcessor extends WorkerHost {
  private readonly logger = new Logger(ExampleProcessor.name);

  async process(job: Job): Promise<void> {
    this.logger.log(`processing job ${job.id} (${job.name})`);
  }
}
