import { Body, Controller, Get, Header, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExampleEntity } from './example.entity';

/**
 * Demo CRUD over the example table. Returns HTML fragments (not JSON) so the
 * frontend can swap them in directly via HTMX.
 */
@Controller('api/examples')
export class ExampleController {
  constructor(
    @InjectRepository(ExampleEntity)
    private readonly examples: Repository<ExampleEntity>,
  ) {}

  @Get()
  @Header('content-type', 'text/html; charset=utf-8')
  async list(): Promise<string> {
    return this.render(await this.findRecent());
  }

  @Post()
  @Header('content-type', 'text/html; charset=utf-8')
  async create(@Body('name') name?: string): Promise<string> {
    const trimmed = name?.trim();
    if (trimmed) {
      await this.examples.save(this.examples.create({ name: trimmed }));
    }
    return this.render(await this.findRecent());
  }

  private findRecent(): Promise<ExampleEntity[]> {
    return this.examples.find({ order: { createdAt: 'DESC' }, take: 10 });
  }

  private render(rows: ExampleEntity[]): string {
    if (rows.length === 0) return '<p class="text-gray-500">No rows yet.</p>';
    const items = rows
      .map(
        (row) =>
          `<li>${escapeHtml(row.name)} ` +
          `<span class="text-gray-400">${row.createdAt.toISOString()}</span></li>`,
      )
      .join('');
    return `<ul class="list-disc pl-5">${items}</ul>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
