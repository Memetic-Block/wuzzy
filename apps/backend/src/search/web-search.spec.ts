import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PROTOCOL } from '../canonicalize/v1';
import { ChunkEntity } from '../database/chunk.entity';
import { DocumentEntity } from '../database/document.entity';
import { buildDataSourceOptions } from '../database/typeorm.config';
import { toVectorLiteral, type Embedder } from '../embed/embedder';
import { INDEXES_CONFIG, buildIndexesConfig } from '../indexes/index.config';
import { IndexesService } from '../indexes/indexes.service';
import { globalIndexId, joinIndex, truncateWuzzyTables } from '../testing/database';
import { RateLimiter, anonymizeIp, clientIp } from './rate-limit';
import { SearchService } from './search.service';
import { WebSearchController } from './web-search.controller';
import { WEB_SEARCH_CONFIG, buildWebSearchConfig, type WebSearchConfig } from './web-search.config';

const DIMENSIONS = 1536;
const SITE = 'https://wuzzy.io';

/** Deterministic stand-in: no network, and similarity still behaves sensibly. */
const stubEmbedder = (): Embedder => ({
  model: 'stub',
  dimensions: DIMENSIONS,
  embed: async (texts) =>
    texts.map((text) => {
      const vector = new Array<number>(DIMENSIONS).fill(0);
      for (const [index, char] of [...text.toLowerCase()].entries()) {
        const slot = (char.charCodeAt(0) * 7 + index) % DIMENSIONS;
        vector[slot] = (vector[slot] ?? 0) + 1;
      }
      return vector;
    }),
});

let dataSource: DataSource | undefined;
let unreachable: string | undefined;

beforeAll(async () => {
  const candidate = new DataSource(buildDataSourceOptions());
  try {
    dataSource = await candidate.initialize();
  } catch (error) {
    if (process.env.CI) throw error;
    unreachable = (error as Error).message;
    return;
  }
  await truncateWuzzyTables(dataSource);
});

afterAll(async () => {
  await dataSource?.destroy();
});

afterEach(async () => {
  await truncateWuzzyTables(dataSource);
});

const ready = (): DataSource | null => {
  if (dataSource) return dataSource;
  console.log(`skipped: database unreachable (${unreachable})`);
  return null;
};

async function boot(source: DataSource, overrides: Partial<WebSearchConfig> = {}) {
  const config: WebSearchConfig = { ...buildWebSearchConfig({}), enabled: true, ...overrides };

  const moduleRef = await Test.createTestingModule({
    controllers: [WebSearchController],
    providers: [
      { provide: getDataSourceToken(), useValue: source },
      { provide: WEB_SEARCH_CONFIG, useValue: config },
      { provide: SearchService, useValue: new SearchService(source, stubEmbedder()) },
      { provide: IndexesService, useValue: new IndexesService(source, buildIndexesConfig({})) },
      { provide: INDEXES_CONFIG, useValue: buildIndexesConfig({}) },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  await app.listen(0);
  return { app, url: (await app.getUrl()).replace('[::1]', '127.0.0.1') };
}

/** One indexed, embedded, attested document so results have provenance to carry. */
async function seedCorpus(source: DataSource, indexId?: string) {
  const text = 'Deploying a smart contract to Base requires a funded wallet and a configured RPC.';
  const document = await source.getRepository(DocumentEntity).save({
    url: 'https://docs.base.org/deploy',
    title: 'Deploy a smart contract',
    content: `# Deploy\n\n${text}\n`,
    rawHash: 'a'.repeat(64),
    contentHash: 'b'.repeat(64),
    protocol: PROTOCOL,
    protocolVersion: 1,
    robotsStatus: 'allowed',
    httpStatus: 200,
    fetchedAt: new Date('2026-02-01T00:00:00Z'),
    embeddedAt: new Date('2026-02-01T01:00:00Z'),
    attestationUid: `0x${'e'.repeat(64)}`,
    attestedAt: new Date('2026-02-01T02:00:00Z'),
  });

  await joinIndex(source, indexId ?? (await globalIndexId(source)), document.id);

  const [vector] = await stubEmbedder().embed([text]);
  await source.getRepository(ChunkEntity).insert({
    documentId: document.id,
    ordinal: 0,
    text,
    tokenCount: 20,
    embedding: toVectorLiteral(vector!) as unknown as number[],
    embeddedAt: new Date('2026-02-01T01:00:00Z'),
  });
  return document;
}

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${url}/web-search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('free web search', () => {
  it('answers 404 when it has not been turned on', async () => {
    const source = ready();
    if (!source) return;

    // Opt-in, unlike the meter: a free route beside a metered one gives the
    // index away, so forgetting to configure it must leave it closed. 404
    // rather than 403, so a disabled instance does not advertise itself.
    const { app, url } = await boot(source, { enabled: false });
    try {
      expect((await post(url, { query: 'deploy a contract' })).status).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('serves results with provenance and no payment at all', async () => {
    const source = ready();
    if (!source) return;
    await seedCorpus(source);

    const { app, url } = await boot(source);
    try {
      const response = await post(url, { query: 'deploy a contract' });
      expect(response.status).toBe(200);

      const body = (await response.json()) as Record<string, any>;
      expect(body.results).toBeArray();
      expect(body.results.length).toBeGreaterThan(0);

      // The receipt is the feature: a result a reader cannot check is just a
      // link, so this route carries the same provenance block /search does.
      const [first] = body.results;
      expect(first.url).toBe('https://docs.base.org/deploy');
      expect(first.provenance.protocol).toBe(PROTOCOL);
      expect(first.provenance.contentHash).toBe('b'.repeat(64));
      expect(first.provenance.attestationUrl).toContain('base.easscan.org/attestation/view/');

      expect(response.headers.get('cache-control')).toBe('public, max-age=60');
    } finally {
      await app.close();
    }
  });

  it('reads the global index and offers no way to name another', async () => {
    const source = ready();
    if (!source) return;

    // A private index, and a document only it holds.
    const [row] = await source.query(
      `INSERT INTO indexes (slug, name, owner, visibility, read_policy)
       VALUES ('secret', 'Secret', '0x1111111111111111111111111111111111111111',
               'unlisted', 'allowlist')
       RETURNING id`,
    );
    await seedCorpus(source, row.id as string);

    const { app, url } = await boot(source);
    try {
      // Access control rides x402, and there is no payer here. An unmetered
      // route that honoured an `index` parameter would read a private index
      // for free, so the parameter does not exist and the scope is always
      // global.
      const response = await post(url, { query: 'deploy a contract', index: 'secret' });
      expect(response.status).toBe(200);

      const body = (await response.json()) as Record<string, any>;
      expect(body.index).toBe('global');
      expect(body.results).toBeEmpty();
    } finally {
      await app.close();
    }
  });

  it('rejects a blank query the same way the metered route does', async () => {
    const source = ready();
    if (!source) return;

    const { app, url } = await boot(source);
    try {
      expect((await post(url, { query: '   ' })).status).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('rate-limits per client and says when to come back', async () => {
    const source = ready();
    if (!source) return;
    await seedCorpus(source);

    const { app, url } = await boot(source, { limit: 2 });
    try {
      const headers = { 'x-forwarded-for': '203.0.113.7' };
      expect((await post(url, { query: 'deploy' }, headers)).status).toBe(200);
      expect((await post(url, { query: 'deploy' }, headers)).status).toBe(200);

      const limited = await post(url, { query: 'deploy' }, headers);
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);

      // A different client is unaffected, so one heavy user cannot close the
      // box for everyone.
      const other = await post(url, { query: 'deploy' }, { 'x-forwarded-for': '198.51.100.9' });
      expect(other.status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('allows the site origin to call it from a browser, and nothing else', async () => {
    const source = ready();
    if (!source) return;
    await seedCorpus(source);

    const { app, url } = await boot(source, { origins: [SITE] });
    try {
      const allowed = await post(url, { query: 'deploy' }, { origin: SITE });
      expect(allowed.headers.get('access-control-allow-origin')).toBe(SITE);
      // A shared cache that ignored this would hand one origin's allow header
      // to another, which is the whole point of the check.
      expect(allowed.headers.get('vary')).toContain('Origin');

      const refused = await post(url, { query: 'deploy' }, { origin: 'https://not-wuzzy.example' });
      expect(refused.headers.get('access-control-allow-origin')).toBeNull();

      const preflight = await fetch(`${url}/web-search`, {
        method: 'OPTIONS',
        headers: { origin: SITE, 'access-control-request-method': 'POST' },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe(SITE);
    } finally {
      await app.close();
    }
  });
});

describe('client identification', () => {
  it('counts proxy hops from the right, where the client cannot reach', () => {
    // The leftmost entry is whatever the caller claimed. Keying on it would
    // hand anyone an unlimited allowance by inventing a new address per
    // request, so the entry our own edge appended is the one that counts.
    expect(clientIp('9.9.9.9, 203.0.113.7', '10.0.0.1', 1)).toBe('203.0.113.7');
    expect(clientIp('9.9.9.9, 203.0.113.7, 172.16.0.1', '10.0.0.1', 2)).toBe('203.0.113.7');

    // Nothing in front of us: the socket address is the only trustworthy one.
    expect(clientIp('9.9.9.9', '10.0.0.1', 0)).toBe('10.0.0.1');
    expect(clientIp(undefined, '10.0.0.1', 1)).toBe('10.0.0.1');
  });

  it('drops the host part of an address before it is used as a key', () => {
    // The privacy policy says full addresses are not stored, and this is what
    // makes that true of the limiter rather than merely intended.
    expect(anonymizeIp('203.0.113.7')).toBe('203.0.113.0');
    expect(anonymizeIp('::ffff:203.0.113.7')).toBe('203.0.113.0');
    expect(anonymizeIp('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::');

    // An abbreviated address has to be expanded first, or the wrong groups go.
    expect(anonymizeIp('2001:db8::1')).toBe('2001:db8:0:0::');
  });
});

describe('rate limiter', () => {
  it('allows up to the limit, then refuses until the window rolls over', () => {
    const limiter = new RateLimiter(2, 60_000);
    const start = 1_000_000;

    expect(limiter.check('a', start).allowed).toBe(true);
    expect(limiter.check('a', start + 1).allowed).toBe(true);

    const refused = limiter.check('a', start + 2);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfter).toBe(60);

    // Keys do not share a window.
    expect(limiter.check('b', start + 2).allowed).toBe(true);

    // A fresh window starts once the old one expires.
    expect(limiter.check('a', start + 60_001).allowed).toBe(true);
  });
});
