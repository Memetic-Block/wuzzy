import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { AdminService, type ActivityFilter, type DocumentFilter } from './admin.service';

/** Read-only. Nothing here writes, and nothing here computes a hash. */
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  stats() {
    return this.admin.stats();
  }

  @Get('indexes')
  indexes() {
    return this.admin.indexes();
  }

  @Get('documents')
  documents(
    @Query('q') query?: string,
    @Query('host') host?: string,
    @Query('index') index?: string,
    @Query('filter') filter?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.admin.documents({
      query: query?.trim() || undefined,
      host: host?.trim() || undefined,
      index: index?.trim() || undefined,
      filter: (['unembedded', 'unattested', 'attested'].includes(filter ?? '')
        ? filter
        : 'all') as DocumentFilter,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get('documents/:id')
  async document(@Param('id') id: string) {
    const document = await this.admin.document(id);
    if (!document) throw new NotFoundException(`no document ${id}`);
    return document;
  }

  @Get('activity')
  activity(@Query('limit') limit?: string, @Query('filter') filter?: string) {
    return this.admin.activity(
      limit ? Number(limit) : undefined,
      (['failed', 'skipped', 'changed'].includes(filter ?? '')
        ? filter
        : 'all') as ActivityFilter,
    );
  }
}
