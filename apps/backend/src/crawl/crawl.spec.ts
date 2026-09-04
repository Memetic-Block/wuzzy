import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import 'reflect-metadata';
import { LogLevel, log as crawleeLog } from '@crawlee/basic';
import { DataSource } from 'typeorm';
import { DocumentEntity } from '../database/document.entity';
import { FetchLogEntity } from '../database/fetch-log.entity';
import { buildDataSourceOptions } from '../database/typeorm.config';
import { truncateWuzzyTables } from '../testing/database';
import { scenario } from '../testing/scenario';
import { crawl } from './crawler';
import { PROSE, page, startMockSite, type MockSite } from './mock-site';

// Crawlee narrates every run at INFO, which buries the test output.
crawleeLog.setLevel(LogLevel.WARNING);

let dataSource: DataSource | undefined;
let unreachable: string | undefined;
const sites: MockSite[] = [];

beforeAll(async () => {
  const candidate = new DataSource(buildDataSourceOptions());
  try {
    dataSource = await candidate.initialize();
  } catch (error) {
    if (process.env.CI) throw error;
    unreachable = (error as Error).message;
  }
  await truncateWuzzyTables(dataSource);
});

afterEach(async () => {
  while (sites.length > 0) await sites.pop()?.close();
  await truncateWuzzyTables(dataSource);
});

afterAll(async () => {
  await dataSource?.destroy();
});

/** Returns the live DataSource, or null after reporting why the scenario cannot run. */
const db = (): DataSource | null => {
  if (dataSource) return dataSource;
  console.log(`skipped: database unreachable (${unreachable})`);
  return null;
};

const site = async (pages: Record<string, string>): Promise<MockSite> => {
  const started = await startMockSite(pages);
  sites.push(started);
  return started;
};

const ROBOTS_ALLOW_ALL = 'User-agent: *\nAllow: /\n';

describe('crawl provenance lifecycle', () => {
  scenario('fresh fetch produces document and provenance rows', async () => {
    const source = db();
    if (!source) return;

    const mock = await site({
      '/robots.txt': ROBOTS_ALLOW_ALL,
      '/guide': page('Deploy a contract', PROSE),
    });
    await crawl(source, { seeds: [`${mock.origin}/guide`], maxRequests: 5 });

    const documents = await source.getRepository(DocumentEntity).find();
    expect(documents).toHaveLength(1);
    const document = documents[0]!;
    expect(document.rawHash).toMatch(/^[0-9a-f]{64}$/);
    expect(document.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(document.protocolVersion).toBe(1);
    expect(document.robotsStatus).toBe('allowed');
    expect(document.embeddedAt).toBeNull();
    expect(document.attestationUid).toBeNull();

    const log = await source.getRepository(FetchLogEntity).find();
    expect(log).toHaveLength(1);
    expect(log[0]!.rawHash).toBe(document.rawHash);
    expect(log[0]!.contentHash).toBe(document.contentHash);
    expect(log[0]!.httpStatus).toBe(200);
  });

  scenario('unchanged re-fetch appends provenance without touching state', async () => {
    const source = db();
    if (!source) return;

    const mock = await site({
      '/robots.txt': ROBOTS_ALLOW_ALL,
      '/guide': page('Deploy a contract', PROSE),
    });
    const seeds = [`${mock.origin}/guide`];
    await crawl(source, { seeds, maxRequests: 5 });

    // Stand in for a completed embed and attest pass.
    const documents = source.getRepository(DocumentEntity);
    const before = (await documents.find())[0]!;
    const embeddedAt = new Date('2026-01-01T00:00:00Z');
    const attestationUid = `0x${'a'.repeat(64)}`;
    await documents.update({ id: before.id }, { embeddedAt, attestationUid });

    const summary = await crawl(source, { seeds, maxRequests: 5 });
    expect(summary.unchanged).toBe(1);

    const after = await documents.findOneOrFail({ where: { id: before.id } });
    expect(after.contentHash).toBe(before.contentHash);
    expect(after.embeddedAt).toEqual(embeddedAt);
    expect(after.attestationUid).toBe(attestationUid);

    const log = await source.getRepository(FetchLogEntity).find();
    expect(log).toHaveLength(2);
    expect(log.filter((row) => row.contentChanged)).toHaveLength(0);
  });

  scenario('changed content invalidates downstream artifacts', async () => {
    const source = db();
    if (!source) return;

    const mock = await site({
      '/robots.txt': ROBOTS_ALLOW_ALL,
      '/guide': page('Deploy a contract', PROSE),
    });
    const seeds = [`${mock.origin}/guide`];
    await crawl(source, { seeds, maxRequests: 5 });

    const documents = source.getRepository(DocumentEntity);
    const before = (await documents.find())[0]!;
    await documents.update(
      { id: before.id },
      { embeddedAt: new Date('2026-01-01T00:00:00Z'), attestationUid: `0x${'b'.repeat(64)}` },
    );

    mock.setPage('/guide', page('Deploy a contract', `${PROSE} The guide was revised.`));
    const summary = await crawl(source, { seeds, maxRequests: 5 });
    expect(summary.changed).toBe(1);

    const after = await documents.findOneOrFail({ where: { id: before.id } });
    expect(after.contentHash).not.toBe(before.contentHash);
    expect(after.embeddedAt).toBeNull();
    expect(after.attestationUid).toBeNull();

    const log = await source.getRepository(FetchLogEntity).find({ order: { id: 'ASC' } });
    expect(log).toHaveLength(2);
    expect(log[1]!.contentChanged).toBe(true);
  });

  scenario('disallowed URLs are never fetched', async () => {
    const source = db();
    if (!source) return;

    const mock = await site({
      '/robots.txt': `User-agent: ${'WuzzyBot'}\nDisallow: /private/\n`,
      '/guide': page('Deploy a contract', PROSE, ['/private/secret']),
      '/private/secret': page('Secret', PROSE),
    });
    await crawl(source, { seeds: [`${mock.origin}/guide`], maxRequests: 10 });

    expect(mock.requests.some((request) => request.url === '/private/secret')).toBe(false);

    const log = await source.getRepository(FetchLogEntity).find();
    expect(log.map((row) => row.url)).not.toContain(`${mock.origin}/private/secret`);
    const documents = await source.getRepository(DocumentEntity).find();
    expect(documents.map((row) => row.url)).not.toContain(`${mock.origin}/private/secret`);
  });

  scenario('robots rules are read as WuzzyBot, not as the wildcard agent', async () => {
    const source = db();
    if (!source) return;

    // The wildcard group would permit /private/. Obeying it while sending
    // WuzzyBot is what Crawlee's own robots handling does by default.
    const mock = await site({
      '/robots.txt': 'User-agent: WuzzyBot\nDisallow: /private/\n\nUser-agent: *\nAllow: /\n',
      '/guide': page('Deploy a contract', PROSE, ['/private/secret']),
      '/private/secret': page('Secret', PROSE),
    });
    await crawl(source, { seeds: [`${mock.origin}/guide`], maxRequests: 10 });

    expect(mock.requests.some((request) => request.url === '/private/secret')).toBe(false);
    const log = await source.getRepository(FetchLogEntity).find();
    expect(log.map((row) => row.url)).not.toContain(`${mock.origin}/private/secret`);
  });

  scenario('every request identifies the crawler honestly', async () => {
    const source = db();
    if (!source) return;

    const mock = await site({
      '/robots.txt': `${ROBOTS_ALLOW_ALL}Sitemap: SITEMAP_URL\n`,
      '/sitemap.xml': '',
      '/guide': page('Deploy a contract', PROSE, ['/other']),
      '/other': page('Another guide', PROSE),
    });
    mock.setPage('/robots.txt', `${ROBOTS_ALLOW_ALL}Sitemap: ${mock.origin}/sitemap.xml\n`);
    mock.setPage(
      '/sitemap.xml',
      `<?xml version="1.0" encoding="UTF-8"?><urlset><url><loc>${mock.origin}/other</loc></url></urlset>`,
    );

    await crawl(source, { seeds: [`${mock.origin}/guide`], maxRequests: 10 });

    // robots.txt, the sitemap and the pages all have to be covered, not just
    // the page fetches: the robots request is the one a crawler most easily
    // leaves carrying a library's browser-shaped default.
    const paths = mock.requests.map((request) => request.url);
    expect(paths).toContain('/robots.txt');
    expect(paths).toContain('/sitemap.xml');
    expect(paths).toContain('/guide');

    expect(mock.requests.length).toBeGreaterThan(0);
    for (const request of mock.requests) {
      expect(`${request.url} -> ${request.userAgent}`).toBe(
        `${request.url} -> WuzzyBot/1.0 (+https://wuzzy.io/bot)`,
      );
    }
  });

  // The database half of canonicalize-v1's thin-page scenario, which that spec
  // can only assert up to the canonicalizer's return value.
  it('records a thin page in the fetch log without creating a document', async () => {
    const source = db();
    if (!source) return;

    const mock = await site({
      '/robots.txt': ROBOTS_ALLOW_ALL,
      '/moved': page('Moved', 'See the new page.'),
    });
    const summary = await crawl(source, { seeds: [`${mock.origin}/moved`], maxRequests: 5 });
    expect(summary.skipped).toBe(1);
    expect(summary.created).toBe(0);

    expect(await source.getRepository(DocumentEntity).find()).toHaveLength(0);

    const log = await source.getRepository(FetchLogEntity).find();
    expect(log).toHaveLength(1);
    expect(log[0]!.skippedReason).toBe('thin');
    expect(log[0]!.contentHash).toBeNull();
    // The raw hash still commits to what was received, even though nothing was indexed.
    expect(log[0]!.rawHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
