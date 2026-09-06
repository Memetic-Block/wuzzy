import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import 'reflect-metadata';
import { LogLevel, log as crawleeLog } from '@crawlee/basic';
import { DataSource } from 'typeorm';
import { ChunkEntity } from '../database/chunk.entity';
import { DocumentEntity } from '../database/document.entity';
import { FetchLogEntity } from '../database/fetch-log.entity';
import { buildDataSourceOptions } from '../database/typeorm.config';
import { truncateWuzzyTables } from '../testing/database';
import { scenario } from '../testing/scenario';
import { crawl, interleaveByHost, sitemapsFor } from './crawler';
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

describe('seed ordering', () => {
  it('round-robins hosts so a capped crawl samples all of them', () => {
    const interleaved = interleaveByHost([
      'https://a.test/1', 'https://a.test/2', 'https://a.test/3',
      'https://b.test/1',
      'https://c.test/1', 'https://c.test/2',
    ]);

    // A cap of 3 must reach all three hosts, not exhaust the first.
    expect(interleaved.slice(0, 3).map((url) => new URL(url).host)).toEqual([
      'a.test', 'b.test', 'c.test',
    ]);
    expect(interleaved).toHaveLength(6);
    expect(new Set(interleaved).size).toBe(6);
  });
});

describe('per-host budget', () => {
  it('stops one host from spending the whole crawl', async () => {
    const source = db();
    if (!source) return;

    // A site with many pages, linked from its own index.
    const many: Record<string, string> = { '/robots.txt': ROBOTS_ALLOW_ALL };
    const links = Array.from({ length: 10 }, (_, i) => `/page-${i}`);
    many['/'] = page('Index', PROSE, links);
    for (const path of links) many[path] = page(`Page ${path}`, PROSE);
    const big = await site(many);

    await crawl(source, { seeds: [`${big.origin}/`], maxPerHost: 4, maxRequests: 50 });

    const documents = await source.getRepository(DocumentEntity).find();
    expect(documents.length).toBeLessThanOrEqual(4);
    expect(documents.length).toBeGreaterThan(0);
  });
});

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

    // Scoped to the page under test: the fixture's nav links to a path this
    // site does not serve, and that 404 is a request we made and so logged.
    const log = await source.getRepository(FetchLogEntity).find({ where: { url: document.url } });
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

    // Freshness is not the subject here: force the re-fetch a later crawl would do.
    const summary = await crawl(source, { seeds, maxRequests: 5, maxAgeDays: 0 });
    expect(summary.unchanged).toBe(1);

    const after = await documents.findOneOrFail({ where: { id: before.id } });
    expect(after.contentHash).toBe(before.contentHash);
    expect(after.embeddedAt).toEqual(embeddedAt);
    expect(after.attestationUid).toBe(attestationUid);

    const log = await source.getRepository(FetchLogEntity).find({ where: { url: after.url } });
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
    // Freshness is not the subject here: force the re-fetch a later crawl would do.
    const summary = await crawl(source, { seeds, maxRequests: 5, maxAgeDays: 0 });
    expect(summary.changed).toBe(1);

    const after = await documents.findOneOrFail({ where: { id: before.id } });
    expect(after.contentHash).not.toBe(before.contentHash);
    expect(after.embeddedAt).toBeNull();
    expect(after.attestationUid).toBeNull();

    const log = await source
      .getRepository(FetchLogEntity)
      .find({ where: { url: after.url }, order: { id: 'ASC' } });
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

  scenario('a redirect off the seeded hosts is not followed', async () => {
    const source = db();
    if (!source) return;

    // A second origin stands in for anywhere the crawler was not sent.
    const elsewhere = await site({
      '/robots.txt': ROBOTS_ALLOW_ALL,
      '/landing': page('Elsewhere', PROSE),
    });
    const seeded = await site({ '/robots.txt': ROBOTS_ALLOW_ALL });
    seeded.redirect('/moved', `${elsewhere.origin}/landing`);

    await crawl(source, { seeds: [`${seeded.origin}/moved`], maxRequests: 5 });

    // The point is not that the page was skipped, but that the other host was
    // never asked for anything: its robots.txt was never read, so no request to
    // it is one we are entitled to make.
    expect(elsewhere.requests).toHaveLength(0);

    const documents = await source.getRepository(DocumentEntity).find();
    expect(documents).toHaveLength(0);
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

    const log = await source
      .getRepository(FetchLogEntity)
      .find({ where: { skippedReason: 'thin' } });
    expect(log).toHaveLength(1);
    expect(log[0]!.skippedReason).toBe('thin');
    expect(log[0]!.contentHash).toBeNull();
    // The raw hash still commits to what was received, even though nothing was indexed.
    expect(log[0]!.rawHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('sitemap discovery', () => {
  it('prefers what robots.txt declares', () => {
    const declared = ['https://x.test/sitemap-pages.xml', 'https://x.test/sitemap-blog.xml'];
    expect(sitemapsFor('https://x.test', { isAllowed: () => true, sitemaps: declared })).toEqual(
      declared,
    );
  });

  it('falls back to the conventional path when robots declares none', () => {
    // Declaring a sitemap is a convention, not a requirement. A site that
    // publishes one without mentioning it, and renders its pages client-side
    // so there are no anchors either, would otherwise index as one page.
    expect(sitemapsFor('https://x.test', { isAllowed: () => true, sitemaps: [] })).toEqual([
      'https://x.test/sitemap.xml',
    ]);
  });

  it('does not probe a path robots.txt disallows', () => {
    expect(sitemapsFor('https://x.test', { isAllowed: () => false, sitemaps: [] })).toEqual([]);
  });

  it('finds pages on a site whose sitemap is undeclared', async () => {
    const source = db();
    if (!source) return;

    const mock = await site({
      // robots.txt exists and allows everything, but names no sitemap.
      '/robots.txt': ROBOTS_ALLOW_ALL,
      '/': page('Landing', PROSE),
      '/guide': page('Guide', PROSE),
      '/reference': page('Reference', PROSE),
    });
    // The sitemap is served, just never advertised.
    mock.setPage(
      '/sitemap.xml',
      `<?xml version="1.0"?><urlset><url><loc>${mock.origin}/guide</loc></url>` +
        `<url><loc>${mock.origin}/reference</loc></url></urlset>`,
    );

    await crawl(source, { seeds: [`${mock.origin}/`] });

    const urls = (await source.getRepository(DocumentEntity).find()).map((d) => d.url).sort();
    expect(urls).toEqual([`${mock.origin}/`, `${mock.origin}/guide`, `${mock.origin}/reference`]);
  });
});

describe('failed fetches leave a trail', () => {
  scenario('a request that returns an error is still recorded', async () => {
    const source = db();
    if (!source) return;

    const mock = await site({ '/robots.txt': ROBOTS_ALLOW_ALL, '/': page('Home', PROSE, ['/gone']) });
    // /gone is linked but the site answers 404 for it.

    await crawl(source, { seeds: [`${mock.origin}/`] });

    const failures = await source.getRepository(FetchLogEntity).find({
      where: { url: `${mock.origin}/gone` },
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]!.httpStatus).toBe(404);
    expect(failures[0]!.error).toBe('HTTP 404');
    expect(failures[0]!.contentHash).toBeNull();

    // The request is accounted for without inventing a document for it.
    const documents = await source.getRepository(DocumentEntity).find();
    expect(documents.map((d) => d.url)).toEqual([`${mock.origin}/`]);
  });

  scenario('a request that returns something unindexable is still recorded', async () => {
    const source = db();
    if (!source) return;

    const mock = await site({
      '/robots.txt': ROBOTS_ALLOW_ALL,
      '/': page('Home', PROSE, ['/data.xml']),
      // Served as application/xml by the mock site: a real response, not a page.
      '/data.xml': '<?xml version="1.0"?><data><value>42</value></data>',
    });

    await crawl(source, { seeds: [`${mock.origin}/`] });

    const [row] = await source.getRepository(FetchLogEntity).find({
      where: { url: `${mock.origin}/data.xml` },
    });
    expect(row).toBeDefined();
    expect(row!.httpStatus).toBe(200);
    expect(row!.error).toContain('unusable content-type');
    expect(row!.contentHash).toBeNull();

    expect((await source.getRepository(DocumentEntity).find()).map((d) => d.url)).toEqual([
      `${mock.origin}/`,
    ]);
  });
});

describe('pages that stop being indexable', () => {
  const THIN = '<!doctype html><html><head><title>Shell</title></head><body><div id="app"></div></body></html>';

  scenario('a page that stops yielding content leaves the index', async () => {
    const source = db();
    if (!source) return;

    const mock = await site({ '/robots.txt': ROBOTS_ALLOW_ALL, '/guide': page('Guide', PROSE) });
    await crawl(source, { seeds: [`${mock.origin}/guide`] });

    const documents = source.getRepository(DocumentEntity);
    const before = await documents.findOneOrFail({ where: { url: `${mock.origin}/guide` } });
    // Stand in for the embed pass, so there is something to evict.
    await source.getRepository(ChunkEntity).insert({
      documentId: before.id, ordinal: 0, text: PROSE, tokenCount: 20,
    });
    await documents.update({ id: before.id }, { attestationUid: `0x${'e'.repeat(64)}` });

    // The site starts serving a client-rendered shell.
    mock.setPage('/guide', THIN);
    // Freshness is not the subject here: force the re-fetch a later crawl would do.
    await crawl(source, { seeds: [`${mock.origin}/guide`], maxAgeDays: 0 });

    const after = await documents.findOneOrFail({ where: { url: `${mock.origin}/guide` } });
    expect(after.unindexedAt).not.toBeNull();
    expect(await source.getRepository(ChunkEntity).countBy({ documentId: after.id })).toBe(0);

    // Provenance is untouched: these stay true of what was fetched before.
    expect(after.contentHash).toBe(before.contentHash);
    expect(after.rawHash).toBe(before.rawHash);
    expect(after.attestationUid).toBe(`0x${'e'.repeat(64)}`);
    expect(
      await source.getRepository(FetchLogEntity).countBy({ url: `${mock.origin}/guide` }),
    ).toBe(2);
  });

  scenario('a page that starts yielding content again returns to the index', async () => {
    const source = db();
    if (!source) return;

    const mock = await site({ '/robots.txt': ROBOTS_ALLOW_ALL, '/guide': page('Guide', PROSE) });
    await crawl(source, { seeds: [`${mock.origin}/guide`] });

    const documents = source.getRepository(DocumentEntity);
    const original = await documents.findOneOrFail({ where: { url: `${mock.origin}/guide` } });
    await documents.update({ id: original.id }, { embeddedAt: new Date() });

    mock.setPage('/guide', THIN);
    // Freshness is not the subject here: force the re-fetch a later crawl would do.
    await crawl(source, { seeds: [`${mock.origin}/guide`], maxAgeDays: 0 });
    expect((await documents.findOneOrFail({ where: { id: original.id } })).unindexedAt).not.toBeNull();

    // The site renders again, serving exactly what it served the first time.
    // No flag: an evicted document is always re-fetched, which is the point.
    mock.setPage('/guide', page('Guide', PROSE));
    await crawl(source, { seeds: [`${mock.origin}/guide`] });

    const restored = await documents.findOneOrFail({ where: { id: original.id } });
    expect(restored.unindexedAt).toBeNull();
    // Identical bytes, but its chunks were dropped, so it has to be embedded
    // again or it would stay invisible with nothing scheduled to fix it.
    expect(restored.embeddedAt).toBeNull();
    expect(restored.contentHash).toBe(original.contentHash);
  });
});

describe('sitemap freshness', () => {
  /** A site whose sitemap states a lastmod we control. */
  async function siteWithLastmod(lastmod: string) {
    const mock = await site({ '/robots.txt': ROBOTS_ALLOW_ALL, '/guide': page('Guide', PROSE) });
    mock.setPage(
      '/sitemap.xml',
      `<?xml version="1.0"?><urlset><url><loc>${mock.origin}/guide</loc>` +
        `<lastmod>${lastmod}</lastmod></url></urlset>`,
    );
    return mock;
  }

  const requestsFor = (mock: MockSite, path: string) =>
    mock.requests.filter((request) => request.url === path).length;

  scenario('a page the sitemap calls unchanged is not re-fetched', async () => {
    const source = db();
    if (!source) return;

    const mock = await siteWithLastmod('2020-01-01T00:00:00Z');
    await crawl(source, { seeds: [`${mock.origin}/`] });

    const documents = source.getRepository(DocumentEntity);
    const first = await documents.findOneOrFail({ where: { url: `${mock.origin}/guide` } });
    const before = requestsFor(mock, '/guide');
    expect(before).toBeGreaterThan(0);

    const summary = await crawl(source, { seeds: [`${mock.origin}/`] });

    // The site said it has not changed since we fetched it, so we take its
    // word in the direction that costs it nothing.
    expect(requestsFor(mock, '/guide')).toBe(before);
    expect(summary.fresh).toBeGreaterThan(0);
    const after = await documents.findOneOrFail({ where: { id: first.id } });
    expect(after.fetchedAt).toEqual(first.fetchedAt);
    expect(after.contentHash).toBe(first.contentHash);
  });

  scenario('a page the sitemap calls changed is re-fetched', async () => {
    const source = db();
    if (!source) return;

    const mock = await siteWithLastmod('2020-01-01T00:00:00Z');
    await crawl(source, { seeds: [`${mock.origin}/`] });
    const before = requestsFor(mock, '/guide');

    // The site now claims an edit in the future relative to our fetch.
    const ahead = new Date(Date.now() + 60_000).toISOString();
    mock.setPage(
      '/sitemap.xml',
      `<?xml version="1.0"?><urlset><url><loc>${mock.origin}/guide</loc>` +
        `<lastmod>${ahead}</lastmod></url></urlset>`,
    );
    const summary = await crawl(source, { seeds: [`${mock.origin}/`] });

    expect(requestsFor(mock, '/guide')).toBeGreaterThan(before);
    // Fetched, but the bytes are the same, so the hash says nothing changed.
    // lastmod decides whether to ask; the content hash decides the answer.
    expect(summary.unchanged).toBeGreaterThan(0);
    expect(summary.changed).toBe(0);
  });

  scenario('a stale document is re-fetched however fresh the sitemap claims it is', async () => {
    const source = db();
    if (!source) return;

    const mock = await siteWithLastmod('2020-01-01T00:00:00Z');
    await crawl(source, { seeds: [`${mock.origin}/`] });
    const before = requestsFor(mock, '/guide');

    // A site that never moves its lastmod would otherwise be crawled once and
    // trusted forever, so age alone eventually forces a re-fetch.
    const summary = await crawl(source, { seeds: [`${mock.origin}/`], maxAgeDays: 0 });

    expect(requestsFor(mock, '/guide')).toBeGreaterThan(before);
    expect(summary.fresh).toBe(0);
  });

  scenario('a page with no sitemap claim is judged on age alone', async () => {
    const source = db();
    if (!source) return;

    // No sitemap at all: every page here is found by following links, so
    // nothing ever carries a lastmod.
    const mock = await site({
      '/robots.txt': ROBOTS_ALLOW_ALL,
      '/': page('Home', PROSE, ['/guide']),
      '/guide': page('Guide', PROSE),
    });
    await crawl(source, { seeds: [`${mock.origin}/`] });
    const before = mock.requests.filter((r) => r.url === '/guide').length;
    expect(before).toBeGreaterThan(0);

    // Within the maximum age it is left alone. Treating "no claim" as "fetch"
    // would re-fetch every link-discovered page on every run, forever.
    await crawl(source, { seeds: [`${mock.origin}/`] });
    expect(mock.requests.filter((r) => r.url === '/guide').length).toBe(before);

    // Age alone eventually forces it, since nothing else ever will.
    await crawl(source, { seeds: [`${mock.origin}/`], maxAgeDays: 0 });
    expect(mock.requests.filter((r) => r.url === '/guide').length).toBeGreaterThan(before);
  });
});
