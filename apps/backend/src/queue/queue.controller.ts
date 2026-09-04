import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Header, Post } from '@nestjs/common';
import { Queue } from 'bullmq';
import { EXAMPLE_QUEUE } from './example.processor';

/**
 * Demo producer: enqueues a job onto the example queue. ExampleProcessor picks
 * it up and logs it. Returns an HTML fragment for the frontend's HTMX button.
 */
@Controller('api/jobs')
export class QueueController {
  constructor(
    @InjectQueue(EXAMPLE_QUEUE) private readonly queue: Queue,
  ) {}

  @Post()
  @Header('content-type', 'text/html; charset=utf-8')
  async enqueue(): Promise<string> {
    const job = await this.queue.add('example', { at: new Date().toISOString() });
    return `<p>Enqueued job <code>${job.id}</code> — check the backend logs for the processor output.</p>`;
  }
}
