import { afterAll, afterEach, beforeAll, describe, expect } from 'bun:test';
import 'reflect-metadata';
import { LogLevel, log as crawleeLog } from 'crawlee';
import { DataSource } from 'typeorm';
import { crawl } from '../crawl/crawler';
import { PROSE, page, startMockSite, type MockSite } from '../crawl/mock-site';
import { DocumentEntity } from '../database/document.entity';
import { buildDataSourceOptions } from '../database/typeorm.config';
import { scenario } from '../testing/scenario';
import { EXIT_MATCH, EXIT_MISMATCH, EXIT_UNINDEXED, formatVerifyResult, verify } from './verify';

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
});

afterEach(async () => {
  while (sites.length > 0) await sites.pop()?.close();
  if (!dataSource) return;
  await dataSource.query('DELETE FROM fetch_log');
  await dataSource.query('DELETE FROM documents');
});

afterAll(async () => {
  await dataSource?.destroy();
});

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

/** Indexes one page and returns the mock site plus that page's URL. */
async function indexOnePage(source: DataSource) {
  const mock = await site({
    '/robots.txt': ROBOTS_ALLOW_ALL,
    '/guide': page('Deploy a contract', PROSE),
  });
  const url = `${mock.origin}/guide`;
  await crawl(source, { seeds: [url], maxRequests: 5 });
  return { mock, url };
}

describe('verify CLI', () => {
  scenario('verify matches an unchanged page', async () => {
    const source = db();
    if (!source) return;

    const { url } = await indexOnePage(source);
    const uid = `0x${'c'.repeat(64)}`;
    await source.getRepository(DocumentEntity).update({ url }, { attestationUid: uid });

    const result = await verify(source, url);
    expect(result.status).toBe('match');
    expect(result.exitCode).toBe(EXIT_MATCH);
    expect(result.recomputedHash).toBe(result.attestedHash);

    // The contract asks for all three to be printed.
    const output = formatVerifyResult(result);
    expect(output).toContain(result.attestedHash!);
    expect(output).toContain(result.recomputedHash!);
    expect(output).toContain(`https://base.easscan.org/attestation/view/${uid}`);
  });

  scenario('verify reports a mismatch', async () => {
    const source = db();
    if (!source) return;

    const { mock, url } = await indexOnePage(source);
    const before = await source.getRepository(DocumentEntity).findOneOrFail({ where: { url } });

    // The live page moves on without a re-crawl, which is exactly the
    // discrepancy verify exists to surface.
    mock.setPage('/guide', page('Deploy a contract', `${PROSE} An unrecorded edit landed.`));

    const result = await verify(source, url);
    expect(result.status).toBe('mismatch');
    expect(result.exitCode).toBe(EXIT_MISMATCH);
    expect(result.attestedHash).toBe(before.contentHash);
    expect(result.recomputedHash).not.toBe(before.contentHash);

    const output = formatVerifyResult(result);
    expect(output).toContain(result.attestedHash!);
    expect(output).toContain(result.recomputedHash!);
  });

  scenario('verify on an unindexed URL', async () => {
    const source = db();
    if (!source) return;

    const mock = await site({
      '/robots.txt': ROBOTS_ALLOW_ALL,
      '/never-crawled': page('Never crawled', PROSE),
    });

    const result = await verify(source, `${mock.origin}/never-crawled`);
    expect(result.status).toBe('unindexed');
    expect(result.exitCode).toBe(EXIT_UNINDEXED);
    expect(result.attestedHash).toBeNull();
    // Nothing was fetched: there is no attested hash to compare against.
    expect(mock.requests).toHaveLength(0);
  });
});
