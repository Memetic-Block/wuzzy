import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DocumentEntity } from '../database/document.entity';
import { FetchLogEntity } from '../database/fetch-log.entity';
import { connectForTests, truncateWuzzyTables } from '../testing/database';
import { ADMIN_CONFIG, buildAdminConfig, type AdminConfig } from './admin.config';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

let dataSource: DataSource | undefined;
let reason = '';
let app: INestApplication | undefined;

beforeAll(async () => {
  const connected = await connectForTests();
  dataSource = connected.dataSource;
  if (connected.skip) reason = connected.reason;
  await truncateWuzzyTables(dataSource);
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  await truncateWuzzyTables(dataSource);
});

afterAll(async () => {
  await dataSource?.destroy();
});

const ready = (): DataSource | null => {
  if (dataSource) return dataSource;
  console.log(`skipped: database unreachable (${reason})`);
  return null;
};

async function boot(source: DataSource, config: Partial<AdminConfig> = {}) {
  const moduleRef = await Test.createTestingModule({
    controllers: [AdminController],
    providers: [
      AdminService,
      AdminGuard,
      { provide: getDataSourceToken(), useValue: source },
      { provide: ADMIN_CONFIG, useValue: { enabled: true, token: null, ...config } },
    ],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  await app.listen(0);
  return (await app.getUrl()).replace('[::1]', '127.0.0.1');
}

async function seed(source: DataSource, count: number) {
  for (let index = 0; index < count; index += 1) {
    const document = await source.getRepository(DocumentEntity).save({
      url: `https://docs.base.org/page-${index}`,
      title: `Page ${index}`,
      content: `# Page ${index}\n\nBody text.\n`,
      rawHash: 'a'.repeat(64),
      contentHash: String(index).padStart(64, 'b'),
      protocol: 'wuzzy/crawl',
      protocolVersion: 1,
      robotsStatus: 'allowed',
      httpStatus: 200,
      fetchedAt: new Date(Date.UTC(2026, 1, 1, 0, index)),
      embeddedAt: index % 2 === 0 ? new Date() : null,
      attestationUid: index === 0 ? `0x${'e'.repeat(64)}` : null,
      attestedAt: index === 0 ? new Date() : null,
    });
    await source.getRepository(FetchLogEntity).save({
      documentId: document.id,
      url: document.url,
      httpStatus: 200,
      rawHash: document.rawHash,
      contentHash: document.contentHash,
      contentChanged: index === 1,
    });
  }
}

describe('admin config', () => {
  it('is off unless explicitly enabled', () => {
    expect(buildAdminConfig({}).enabled).toBe(false);
    expect(buildAdminConfig({ ADMIN_ENABLED: 'false' }).enabled).toBe(false);
    // Nothing truthy-ish counts, only the exact opt-in.
    expect(buildAdminConfig({ ADMIN_ENABLED: '1' }).enabled).toBe(false);
    expect(buildAdminConfig({ ADMIN_ENABLED: 'true' }).enabled).toBe(true);
  });
});

describe('admin API', () => {
  it('reports index totals and sources', async () => {
    const source = ready();
    if (!source) return;
    await seed(source, 4);

    const url = await boot(source);
    const stats = await (await fetch(`${url}/admin/stats`)).json();

    expect(stats.documents).toBe(4);
    expect(stats.fetches).toBe(4);
    expect(stats.embedded).toBe(2);
    expect(stats.attested).toBe(1);
    expect(stats.hosts).toEqual([{ host: 'docs.base.org', documents: 4 }]);
    expect(stats.protocols[0]).toEqual({ protocol: 'wuzzy/crawl', protocolVersion: 1, documents: 4 });
  });

  it('pages and filters documents', async () => {
    const source = ready();
    if (!source) return;
    await seed(source, 6);
    const url = await boot(source);

    const page = await (await fetch(`${url}/admin/documents?limit=2&offset=0`)).json();
    expect(page.total).toBe(6);
    expect(page.documents).toHaveLength(2);

    const unattested = await (await fetch(`${url}/admin/documents?filter=unattested`)).json();
    expect(unattested.total).toBe(5);

    const unembedded = await (await fetch(`${url}/admin/documents?filter=unembedded`)).json();
    expect(unembedded.total).toBe(3);

    const searched = await (await fetch(`${url}/admin/documents?q=page-3`)).json();
    expect(searched.total).toBe(1);
    expect(searched.documents[0].url).toBe('https://docs.base.org/page-3');
  });

  it('returns one document with its provenance trail', async () => {
    const source = ready();
    if (!source) return;
    await seed(source, 1);
    const url = await boot(source);

    const page = await (await fetch(`${url}/admin/documents`)).json();
    const detail = await (await fetch(`${url}/admin/documents/${page.documents[0].id}`)).json();

    expect(detail.url).toBe('https://docs.base.org/page-0');
    expect(detail.rawHash).toBe('a'.repeat(64));
    expect(detail.robotsStatus).toBe('allowed');
    expect(detail.fetches).toHaveLength(1);
    expect(detail.attestationUrl).toContain('base.easscan.org');
  });

  it('404s an unknown document', async () => {
    const source = ready();
    if (!source) return;
    const url = await boot(source);
    const response = await fetch(`${url}/admin/documents/${crypto.randomUUID()}`);
    expect(response.status).toBe(404);
  });

  it('hides itself entirely when disabled', async () => {
    const source = ready();
    if (!source) return;
    const url = await boot(source, { enabled: false });

    // 404 rather than 403: a disabled endpoint should not confirm it exists.
    for (const path of ['/admin/stats', '/admin/documents', '/admin/activity']) {
      expect((await fetch(`${url}${path}`)).status).toBe(404);
    }
  });

  it('requires the token when one is configured', async () => {
    const source = ready();
    if (!source) return;
    await seed(source, 1);
    const url = await boot(source, { token: 'sekrit' });

    expect((await fetch(`${url}/admin/stats`)).status).toBe(401);
    expect((await fetch(`${url}/admin/stats`, { headers: { 'x-admin-token': 'wrong' } })).status).toBe(401);
    expect((await fetch(`${url}/admin/stats`, { headers: { 'x-admin-token': 'sekrit' } })).status).toBe(200);
  });
});
