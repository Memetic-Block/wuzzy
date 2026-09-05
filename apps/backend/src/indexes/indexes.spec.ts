import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { LogLevel, log as crawleeLog } from '@crawlee/basic';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { exact } from 'x402/schemes';
import { SCHEMA_DEFINITION, encodeAttestation, schemaCarriesNoIndex } from '../attest/schema';
import { page, PROSE, startMockSite, type MockSite } from '../crawl/mock-site';
import { ChunkEntity } from '../database/chunk.entity';
import { DocumentEntity } from '../database/document.entity';
import { embedPending } from '../embed/embed';
import { toVectorLiteral, type Embedder } from '../embed/embedder';
import { PAYMENT_CONFIG, type PaymentConfig } from '../payment/payment.config';
import { PaymentService } from '../payment/payment.service';
import { startMockFacilitator, type MockFacilitator } from '../payment/mock-facilitator';
import { SearchController } from '../search/search.controller';
import { SearchService } from '../search/search.service';
import { connectForTests, globalIndexId, joinIndex, truncateWuzzyTables } from '../testing/database';
import { scenario } from '../testing/scenario';
import { crawlIndexQueue } from './index-crawl';
import { INDEXES_CONFIG, buildIndexesConfig } from './index.config';
import { IndexesController } from './indexes.controller';
import { IndexesService } from './indexes.service';

crawleeLog.setLevel(LogLevel.WARNING);

const DIMENSIONS = 1536;
const PAY_TO = '0x2222222222222222222222222222222222222222';
const WALLET_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const WALLET_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const WALLET_C = '0xcccccccccccccccccccccccccccccccccccccccc';
const WALLET_D = '0xdddddddddddddddddddddddddddddddddddddddd';
const PAGE_CAP = 4;

/**
 * Fixture hashes are real digests of the URL rather than a repeated character:
 * a hash of all `a`s reads as a substring of a wallet of all `a`s, which would
 * make the privacy scenario below fail against its own fixtures.
 */
const hashOf = (value: string): string => createHash('sha256').update(value).digest('hex');

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
let reason = '';
let facilitator: MockFacilitator | undefined;
const sites: MockSite[] = [];

beforeAll(async () => {
  const connected = await connectForTests();
  dataSource = connected.dataSource;
  if (connected.skip) reason = connected.reason;
  await truncateWuzzyTables(dataSource);
  facilitator = await startMockFacilitator();
});

afterEach(async () => {
  while (sites.length > 0) await sites.pop()?.close();
  await truncateWuzzyTables(dataSource);
  facilitator?.reset();
});

afterAll(async () => {
  await facilitator?.close();
  await dataSource?.destroy();
});

const ready = (): DataSource | null => {
  if (dataSource) return dataSource;
  console.log(`skipped: database unreachable (${reason})`);
  return null;
};

const site = async (pages: Record<string, string>): Promise<MockSite> => {
  const started = await startMockSite(pages);
  sites.push(started);
  return started;
};

const indexesConfig = buildIndexesConfig({
  WUZZY_INDEX_PAGE_CAP: String(PAGE_CAP),
  WUZZY_INDEX_PRICE_PER_PAGE: '$0.01',
});

/** Boots /search and /indexes together, metered against the mock facilitator. */
async function boot(source: DataSource, overrides: Partial<PaymentConfig> = {}) {
  const payment: PaymentConfig = {
    enabled: true,
    payTo: PAY_TO,
    network: 'base',
    price: '$0.01',
    facilitatorUrl: facilitator!.url,
    description: 'One Wuzzy search query with onchain provenance',
    ...overrides,
  };

  const moduleRef = await Test.createTestingModule({
    controllers: [IndexesController, SearchController],
    providers: [
      { provide: getDataSourceToken(), useValue: source },
      { provide: PAYMENT_CONFIG, useValue: payment },
      { provide: INDEXES_CONFIG, useValue: indexesConfig },
      PaymentService,
      { provide: IndexesService, useValue: new IndexesService(source, indexesConfig) },
      { provide: SearchService, useValue: new SearchService(source, stubEmbedder()) },
    ],
  }).compile();

  const app: INestApplication = moduleRef.createNestApplication();
  await app.init();
  await app.listen(0);
  return { app, url: (await app.getUrl()).replace('[::1]', '127.0.0.1') };
}

/** A well-formed X-PAYMENT header from a given wallet; the facilitator judges it. */
const paymentHeader = (from: string, value = '10000'): string =>
  exact.evm.encodePayment({
    x402Version: 1,
    scheme: 'exact',
    network: 'base',
    payload: {
      signature: `0x${'1'.repeat(130)}`,
      authorization: {
        from,
        to: PAY_TO,
        value,
        validAfter: '0',
        validBefore: String(Math.floor(Date.now() / 1000) + 3600),
        nonce: `0x${'2'.repeat(64)}`,
      },
    },
  });

const send = (
  url: string,
  path: string,
  body: unknown,
  wallet?: string,
  method: 'POST' | 'DELETE' = 'POST',
) =>
  fetch(`${url}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(wallet ? { 'X-PAYMENT': paymentHeader(wallet) } : {}),
    },
    ...(method === 'DELETE' ? {} : { body: JSON.stringify(body) }),
  });

/** One indexed, embedded, optionally attested document, joined to `indexId`. */
async function seedDocument(
  source: DataSource,
  url: string,
  text: string,
  options: { indexId?: string; attestationUid?: string | null } = {},
): Promise<DocumentEntity> {
  const document = await source.getRepository(DocumentEntity).save({
    url,
    title: url.split('/').pop() ?? url,
    content: `# ${url.split('/').pop()}\n\n${text}\n`,
    rawHash: hashOf(`raw:${url}`),
    contentHash: hashOf(url),
    protocol: 'wuzzy/crawl',
    protocolVersion: 1,
    robotsStatus: 'allowed',
    httpStatus: 200,
    fetchedAt: new Date('2026-02-01T00:00:00Z'),
    embeddedAt: new Date('2026-02-01T01:00:00Z'),
    attestationUid: options.attestationUid ?? null,
    attestedAt: options.attestationUid ? new Date('2026-02-01T02:00:00Z') : null,
  });

  const [vector] = await stubEmbedder().embed([text]);
  await source.getRepository(ChunkEntity).insert({
    documentId: document.id,
    ordinal: 0,
    text,
    tokenCount: 20,
    embedding: toVectorLiteral(vector!) as unknown as number[],
    embeddedAt: new Date('2026-02-01T01:00:00Z'),
  });

  if (options.indexId) await joinIndex(source, options.indexId, document.id);
  return document;
}

/** Creates an index directly, for scenarios whose subject is not creation. */
async function makeIndex(
  source: DataSource,
  overrides: Partial<{
    name: string;
    owner: string;
    visibility: 'listed' | 'unlisted';
    readPolicy: 'open' | 'allowlist';
    allowlist: string[];
  }> = {},
) {
  const service = new IndexesService(source, indexesConfig);
  const created = await service.create({
    owner: overrides.owner ?? WALLET_A,
    name: overrides.name ?? 'Research corpus',
    urls: ['https://seed.test/placeholder'],
    visibility: overrides.visibility,
    readPolicy: overrides.readPolicy,
    allowlist: overrides.allowlist,
  });
  // Creation needs at least one URL, but these scenarios are not about the
  // queue; leaving the placeholder in it would have later crawls chase a host
  // that does not exist.
  await source.query(`DELETE FROM index_urls WHERE index_id = $1`, [created.id]);
  return created;
}

const ROBOTS_ALLOW_ALL = 'User-agent: *\nAllow: /\n';

/** `SELECT count(*)` as a number, so assertions read as counts rather than rows. */
async function countRows(source: DataSource, sql: string, params: unknown[] = []): Promise<number> {
  const [row] = (await source.query(sql, params)) as [{ n: string | number }];
  return Number(row!.n);
}

describe('configurable indexes', () => {
  scenario('unscoped search targets the global index', async () => {
    const source = ready();
    if (!source) return;

    const global = await globalIndexId(source);
    const other = await makeIndex(source, { name: 'Private notes' });
    await seedDocument(source, 'https://docs.test/public', 'paymaster sponsors gas on Base', {
      indexId: global,
    });
    await seedDocument(source, 'https://docs.test/private', 'paymaster sponsors gas on Base', {
      indexId: other.id,
    });

    const { app, url } = await boot(source);
    try {
      const response = await send(url, '/search', { query: 'paymaster' }, WALLET_A);
      expect(response.status).toBe(200);

      const body = (await response.json()) as { index: string; results: { url: string }[] };
      expect(body.index).toBe('global');
      expect(body.results.map((result) => result.url)).toEqual(['https://docs.test/public']);
    } finally {
      await app.close();
    }
  });

  scenario('agent commissions an index', async () => {
    const source = ready();
    if (!source) return;

    // One URL the store already holds, one it does not.
    await seedDocument(source, 'https://docs.test/known', 'already crawled prose about gas', {
      indexId: await globalIndexId(source),
    });

    const { app, url } = await boot(source);
    try {
      const response = await send(
        url,
        '/indexes',
        {
          name: 'Base research',
          urls: ['https://docs.test/known', 'https://docs.test/fresh'],
        },
        WALLET_A,
      );
      expect(response.status).toBe(201);

      const body = (await response.json()) as Record<string, any>;
      expect(body.owner).toBe(WALLET_A);
      expect(body.id).toBeString();
      expect(body.statusUrl).toBe(`/indexes/${body.id}`);

      // Only the URL the store lacks is queued; the known one joined outright.
      const queued = await source.query(`SELECT url FROM index_urls WHERE index_id = $1`, [body.id]);
      expect(queued.map((row: { url: string }) => row.url)).toEqual(['https://docs.test/fresh']);
      expect(body.pages).toBe(1);
      expect(body.pending).toBe(1);
    } finally {
      await app.close();
    }
  });

  scenario('index creation respects the page cap', async () => {
    const source = ready();
    if (!source) return;

    const { app, url } = await boot(source);
    try {
      const urls = Array.from({ length: PAGE_CAP + 1 }, (_, i) => `https://docs.test/page-${i}`);
      const response = await send(url, '/indexes', { name: 'Too big', urls }, WALLET_A);

      expect(response.status).toBe(400);
      const body = (await response.json()) as Record<string, any>;
      expect(body.pageCap).toBe(PAGE_CAP);
      expect(body.error).toContain(String(PAGE_CAP));

      // Rejected before the facilitator was ever asked to move money.
      expect(facilitator!.settled).toHaveLength(0);
      expect(await source.query(`SELECT id FROM indexes WHERE slug <> 'global'`)).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  scenario('shared documents are crawled and attested once', async () => {
    const source = ready();
    if (!source) return;

    const uid = `0x${'e'.repeat(64)}`;
    const global = await globalIndexId(source);
    const shared = await seedDocument(source, 'https://docs.test/shared', 'shared prose on gas', {
      indexId: global,
      attestationUid: uid,
    });
    const fetchesBefore = await countRows(source, `SELECT count(*) AS n FROM fetch_log`);

    const { app, url } = await boot(source);
    try {
      const created = await send(
        url,
        '/indexes',
        { name: 'Second index', urls: ['https://docs.test/shared'] },
        WALLET_A,
      );
      const body = (await created.json()) as Record<string, any>;

      // Nothing to crawl, and no new fetch happened.
      expect(body.pending).toBe(0);
      expect(await countRows(source, `SELECT count(*) AS n FROM fetch_log`)).toBe(fetchesBefore);
      expect(
        await countRows(source, `SELECT count(*) AS n FROM documents WHERE url = $1`, [
          'https://docs.test/shared',
        ]),
      ).toBe(1);

      // The same attestation uid is served through both indexes.
      for (const reference of [undefined, body.id]) {
        const response = await send(
          url,
          '/search',
          { query: 'shared prose', ...(reference ? { index: reference } : {}) },
          WALLET_A,
        );
        const results = (await response.json()) as { results: { provenance: any }[] };
        expect(results.results[0]!.provenance.attestationUid).toBe(uid);
      }
      expect(shared.attestationUid).toBe(uid);
    } finally {
      await app.close();
    }
  });

  scenario('index status reaches ready', async () => {
    const source = ready();
    if (!source) return;

    const origin = (
      await site({
        '/robots.txt': ROBOTS_ALLOW_ALL,
        '/guide': page('Guide', PROSE),
      })
    ).origin;

    const service = new IndexesService(source, indexesConfig);
    const created = await service.create({
      owner: WALLET_A,
      name: 'Commissioned',
      urls: [`${origin}/guide`],
    });
    expect((await service.status(created)).status).toBe('pending');

    const result = await crawlIndexQueue(source, created.id);
    expect(result.indexed).toBe(1);

    const status = await service.status(created);
    expect(status.status).toBe('ready');
    expect(status.pages).toBe(1);
    expect(status.pending).toBe(0);
    expect(status.attestations).toBe(0);
  });

  // Not a contract scenario: a regression guard for a case that reported a
  // successful crawl as a failure, because documents are stored under the URL
  // the origin finally served rather than the one that was queued.
  it('counts a redirected URL as indexed, under the URL it resolved to', async () => {
    const source = ready();
    if (!source) return;

    const mock = await site({
      '/robots.txt': ROBOTS_ALLOW_ALL,
      '/moved': page('Moved', PROSE),
    });
    mock.redirect('/old', '/moved');

    const service = new IndexesService(source, indexesConfig);
    const index = await service.create({
      owner: WALLET_A,
      name: 'Redirected',
      urls: [`${mock.origin}/old`],
    });

    const result = await crawlIndexQueue(source, index.id);
    expect(result.indexed).toBe(1);

    // The queue row is satisfied, not errored, and the index holds the page.
    const [row] = await source.query(
      `SELECT error, crawled_at FROM index_urls WHERE index_id = $1`,
      [index.id],
    );
    expect(row.error).toBeNull();
    expect(row.crawled_at).not.toBeNull();

    const status = await service.status(index);
    expect(status.status).toBe('ready');
    expect(status.pages).toBe(1);

    const [member] = await source.query(
      `SELECT d.url FROM index_documents m JOIN documents d ON d.id = m.document_id
        WHERE m.index_id = $1`,
      [index.id],
    );
    expect(member.url).toBe(`${mock.origin}/moved`);
  });

  scenario('scoped search returns only member documents', async () => {
    const source = ready();
    if (!source) return;

    const uid = `0x${'e'.repeat(64)}`;
    const owned = await makeIndex(source);
    await seedDocument(source, 'https://docs.test/member', 'paymaster sponsors gas on Base', {
      indexId: owned.id,
      attestationUid: uid,
    });
    await seedDocument(source, 'https://docs.test/outsider', 'paymaster sponsors gas on Base', {
      indexId: await globalIndexId(source),
    });

    const { app, url } = await boot(source);
    try {
      const response = await send(url, '/search', { query: 'paymaster', index: owned.id }, WALLET_A);
      expect(response.status).toBe(200);

      const body = (await response.json()) as { results: { url: string; provenance: any }[] };
      expect(body.results.map((result) => result.url)).toEqual(['https://docs.test/member']);

      const [result] = body.results;
      expect(result!.provenance.contentHash).toBe(hashOf('https://docs.test/member'));
      expect(result!.provenance.attestationUid).toBe(uid);
      expect(result!.provenance.attestationUrl).toBe(
        `https://base.easscan.org/attestation/view/${uid}`,
      );
    } finally {
      await app.close();
    }
  });

  scenario('allowlist read policy admits listed wallets', async () => {
    const source = ready();
    if (!source) return;

    const index = await makeIndex(source, { readPolicy: 'allowlist', allowlist: [WALLET_B] });
    await seedDocument(source, 'https://docs.test/member', 'paymaster sponsors gas', {
      indexId: index.id,
    });

    const { app, url } = await boot(source);
    try {
      const response = await send(url, '/search', { query: 'paymaster', index: index.id }, WALLET_B);
      expect(response.status).toBe(200);
      expect(facilitator!.settled).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  scenario('allowlist read policy rejects unlisted wallets before settlement', async () => {
    const source = ready();
    if (!source) return;

    const index = await makeIndex(source, { readPolicy: 'allowlist', allowlist: [WALLET_B] });
    await seedDocument(source, 'https://docs.test/member', 'paymaster sponsors gas', {
      indexId: index.id,
    });

    const { app, url } = await boot(source);
    try {
      const response = await send(url, '/search', { query: 'paymaster', index: index.id }, WALLET_C);
      expect(response.status).toBe(403);
      expect((await response.json()).results).toBeUndefined();

      // Verified, so the wallet was proven; never settled, so it paid nothing.
      expect(facilitator!.verified).toHaveLength(1);
      expect(facilitator!.settled).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  scenario('unlisted indexes do not appear in the catalog', async () => {
    const source = ready();
    if (!source) return;

    const hidden = await makeIndex(source, { name: 'Working set', visibility: 'unlisted' });
    const shown = await makeIndex(source, { name: 'Reading list', visibility: 'listed' });

    const { app, url } = await boot(source);
    try {
      const response = await fetch(`${url}/indexes`);
      expect(response.status).toBe(200);

      const body = (await response.json()) as { indexes: { id: string; slug: string }[] };
      const ids = body.indexes.map((index) => index.id);
      expect(ids).not.toContain(hidden.id);
      expect(ids).toContain(shown.id);

      // Global leads, whatever was created since: anything rendering this as a
      // choice should default to the index an unscoped search would read.
      expect(body.indexes[0]!.slug).toBe('global');
    } finally {
      await app.close();
    }
  });

  scenario('private index of public content hides curation, not crawling', async () => {
    const source = ready();
    if (!source) return;

    const uid = `0x${'e'.repeat(64)}`;
    const private_ = await makeIndex(source, {
      name: 'Alpha reading',
      visibility: 'unlisted',
      readPolicy: 'allowlist',
    });
    const document = await seedDocument(source, 'https://docs.test/public-page', 'public prose', {
      indexId: private_.id,
      attestationUid: uid,
    });

    // The fetch is attested in the clear, exactly as it would be for the
    // global index: the URL is public and the commitment stays checkable.
    expect(document.attestationUid).toBe(uid);
    const attestation = encodeAttestation({
      url: document.url,
      protocol: document.protocol,
      protocolVersion: document.protocolVersion,
      contentHash: document.contentHash,
      rawHash: document.rawHash,
      fetchedAt: document.fetchedAt,
    });

    // Nothing onchain names the index, its owner or its readers. The schema
    // has no field to put them in, so this cannot regress by accident.
    expect(schemaCarriesNoIndex()).toBe(true);
    expect(SCHEMA_DEFINITION).not.toContain('index');
    for (const secret of [private_.id, private_.slug, private_.owner, WALLET_A]) {
      expect(attestation.toLowerCase()).not.toContain(secret.replace(/^0x/, '').toLowerCase());
    }

    const { app, url } = await boot(source);
    try {
      // Nor is the index reachable by anyone who went looking after seeing it.
      const catalog = (await (await fetch(`${url}/indexes`)).json()) as { indexes: unknown[] };
      expect(JSON.stringify(catalog)).not.toContain(private_.id);

      const probe = await send(url, '/search', { query: 'public', index: private_.id }, WALLET_C);
      expect(probe.status).toBe(403);
    } finally {
      await app.close();
    }
  });

  scenario('owner appends to their index over time', async () => {
    const source = ready();
    if (!source) return;

    const uid = `0x${'e'.repeat(64)}`;
    const origin = (
      await site({ '/robots.txt': ROBOTS_ALLOW_ALL, '/appended': page('Appended', PROSE) })
    ).origin;

    const index = await makeIndex(source);
    await seedDocument(source, 'https://docs.test/known', 'existing prose about gas', {
      indexId: await globalIndexId(source),
      attestationUid: uid,
    });

    const { app, url } = await boot(source);
    try {
      const response = await send(
        url,
        `/indexes/${index.id}/urls`,
        { urls: ['https://docs.test/known', `${origin}/appended`] },
        WALLET_A,
      );
      expect(response.status).toBe(200);

      const body = (await response.json()) as Record<string, any>;
      expect(body.joined).toBe(1);
      expect(body.enqueued).toBe(1);

      // The already-stored URL is a member now, with the uid it already had.
      const members = await source.query(
        `SELECT d.url, d.attestation_uid FROM index_documents m
           JOIN documents d ON d.id = m.document_id
          WHERE m.index_id = $1 AND d.url = $2`,
        [index.id, 'https://docs.test/known'],
      );
      expect(members).toEqual([{ url: 'https://docs.test/known', attestation_uid: uid }]);

      // The queued one becomes searchable in this index once crawled.
      await crawlIndexQueue(source, index.id);
      await embedPending(source, { embedder: stubEmbedder() });

      const found = await send(
        url,
        '/search',
        { query: 'canonicalizer something stable', index: index.id },
        WALLET_A,
      );
      const results = (await found.json()) as { results: { url: string }[] };
      expect(results.results.map((result) => result.url)).toContain(`${origin}/appended`);
    } finally {
      await app.close();
    }
  });

  scenario('only the owner may append', async () => {
    const source = ready();
    if (!source) return;

    const index = await makeIndex(source, { owner: WALLET_A });

    const { app, url } = await boot(source);
    try {
      const response = await send(
        url,
        `/indexes/${index.id}/urls`,
        { urls: ['https://docs.test/intruder'] },
        WALLET_D,
      );
      expect(response.status).toBe(403);
      expect(facilitator!.verified).toHaveLength(1);
      expect(facilitator!.settled).toHaveLength(0);

      // The rejected append enqueued nothing: D paid for no crawl and got none.
      expect(
        await countRows(source, `SELECT count(*) AS n FROM index_urls WHERE index_id = $1`, [
          index.id,
        ]),
      ).toBe(0);
    } finally {
      await app.close();
    }
  });

  scenario('deleting an index removes membership only', async () => {
    const source = ready();
    if (!source) return;

    const uid = `0x${'e'.repeat(64)}`;
    const index = await makeIndex(source);
    const document = await seedDocument(source, 'https://docs.test/kept', 'prose worth keeping', {
      indexId: index.id,
      attestationUid: uid,
    });

    const { app, url } = await boot(source);
    try {
      const response = await send(url, `/indexes/${index.id}`, null, WALLET_A, 'DELETE');
      expect(response.status).toBe(200);

      expect(await source.query(`SELECT id FROM indexes WHERE id = $1`, [index.id])).toHaveLength(0);
      expect(
        await source.query(`SELECT index_id FROM index_documents WHERE index_id = $1`, [index.id]),
      ).toHaveLength(0);

      const survivor = await source
        .getRepository(DocumentEntity)
        .findOneOrFail({ where: { id: document.id } });
      expect(survivor.attestationUid).toBe(uid);
      expect(survivor.contentHash).toBe(hashOf('https://docs.test/kept'));
      expect(
        await countRows(source, `SELECT count(*) AS n FROM chunks WHERE document_id = $1`, [
          document.id,
        ]),
      ).toBe(1);
    } finally {
      await app.close();
    }
  });
});
