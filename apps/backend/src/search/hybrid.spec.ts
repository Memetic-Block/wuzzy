import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ChunkEntity } from '../database/chunk.entity';
import { DocumentEntity } from '../database/document.entity';
import { connectForTests, globalIndexId, joinIndex, truncateWuzzyTables } from '../testing/database';
import { toVectorLiteral, type Embedder } from '../embed/embedder';
import { reciprocalRankFusion } from './fusion';
import { lexicalSearch } from './lexical';
import { buildSearchConfig, type SearchConfig } from './search.config';
import { SearchService } from './search.service';
import { PROTOCOL } from '../canonicalize/v1';

const DIMENSIONS = 1536;

let dataSource: DataSource | undefined;
let reason = '';
let scope = { indexId: '' };

beforeAll(async () => {
  const connected = await connectForTests();
  dataSource = connected.dataSource;
  if (connected.skip) reason = connected.reason;
  await truncateWuzzyTables(dataSource);
  if (dataSource) scope = { indexId: await globalIndexId(dataSource) };
});

afterEach(async () => {
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

/** Embeds by topic word, so vector similarity is predictable and unrelated to wording. */
const topicEmbedder = (topics: Record<string, number>): Embedder => ({
  model: 'topic-stub',
  dimensions: DIMENSIONS,
  embed: async (texts) =>
    texts.map((text) => {
      const vector = new Array<number>(DIMENSIONS).fill(0);
      for (const [word, slot] of Object.entries(topics)) {
        if (text.toLowerCase().includes(word)) vector[slot] = 1;
      }
      return vector;
    }),
});

async function addChunk(
  source: DataSource,
  url: string,
  text: string,
  embedding?: number[],
): Promise<void> {
  let document = await source.getRepository(DocumentEntity).findOne({ where: { url } });
  if (!document) {
    document = await source.getRepository(DocumentEntity).save({
      url,
      title: url.split('/').pop() ?? url,
      content: text,
      rawHash: 'a'.repeat(64),
      contentHash: 'b'.repeat(64),
      protocol: PROTOCOL,
      protocolVersion: 1,
      robotsStatus: 'allowed',
      httpStatus: 200,
      fetchedAt: new Date(),
      embeddedAt: new Date(),
      attestationUid: null,
      attestedAt: null,
    });
  }
  await joinIndex(source, scope.indexId, document.id);
  const ordinal = await source.getRepository(ChunkEntity).count({ where: { documentId: document.id } });
  await source.getRepository(ChunkEntity).insert({
    documentId: document.id,
    ordinal,
    text,
    tokenCount: Math.ceil(text.length / 4),
    embedding: embedding ? (toVectorLiteral(embedding) as unknown as number[]) : null,
    embeddedAt: embedding ? new Date() : null,
  });
}

describe('BM25', () => {
  it('ranks a rare query term above a common one', async () => {
    const source = ready();
    if (!source) return;

    // "gas" is everywhere, "paymaster" is in one chunk: IDF should make the
    // rare term decide the ranking.
    for (let index = 0; index < 8; index += 1) {
      await addChunk(source, `https://x.test/common-${index}`, 'gas gas gas fees on the network');
    }
    await addChunk(source, 'https://x.test/rare', 'the paymaster sponsors gas for an account');

    const hits = await lexicalSearch(source, 'paymaster', 10, scope);
    expect(hits).toHaveLength(1);

    const both = await lexicalSearch(source, 'paymaster gas', 10, scope);
    const [top] = both;
    const rare = await source.getRepository(DocumentEntity).findOneOrFail({
      where: { url: 'https://x.test/rare' },
    });
    expect(top!.documentId).toBe(rare.id);
  });

  it('saturates term frequency instead of rewarding repetition without limit', async () => {
    const source = ready();
    if (!source) return;
    await addChunk(source, 'https://x.test/once', 'paymaster');
    await addChunk(source, 'https://x.test/spam', Array(50).fill('paymaster').join(' '));

    const hits = await lexicalSearch(source, 'paymaster', 10, scope);
    const scores = Object.fromEntries(hits.map((h) => [h.chunkId, h.score]));
    const values = Object.values(scores).sort((a, b) => b - a);

    // 50x the term must not be anywhere near 50x the score.
    expect(values[0]! / values[1]!).toBeLessThan(3);
  });

  it('matches stemmed variants of a query word', async () => {
    const source = ready();
    if (!source) return;
    await addChunk(source, 'https://x.test/deploy', 'deploying a contract to the network');

    // "deploy" stems to the same lexeme as "deploying".
    expect(await lexicalSearch(source, 'deploy', 10, scope)).toHaveLength(1);
  });

  it('returns nothing for a query with no matching terms', async () => {
    const source = ready();
    if (!source) return;
    await addChunk(source, 'https://x.test/a', 'deploying a contract');
    expect(await lexicalSearch(source, 'zzzznonexistent', 10, scope)).toHaveLength(0);
  });
});

describe('reciprocal rank fusion', () => {
  it('rewards agreement between arms over a single arm winner', () => {
    const fused = reciprocalRankFusion(
      {
        lexical: { items: [{ chunkId: 'a' }, { chunkId: 'b' }, { chunkId: 'c' }] },
        vector: { items: [{ chunkId: 'c' }, { chunkId: 'b' }, { chunkId: 'd' }] },
      },
      (hit) => hit.chunkId,
    );

    // b and c appear in both arms; a and d appear in only one. Agreement wins
    // even though a is ranked 1st lexically and never appears for the vector arm.
    expect(fused.slice(0, 2).map((item) => item.key).sort()).toEqual(['b', 'c']);
    expect(fused.map((item) => item.key).slice(2).sort()).toEqual(['a', 'd']);

    const b = fused.find((item) => item.key === 'b')!;
    expect(b.ranks).toEqual({ lexical: 2, vector: 2 });
    // A single first place is worth less than two mid-table finishes.
    expect(b.score).toBeGreaterThan(fused.find((item) => item.key === 'a')!.score);
  });

  it('keeps items found by only one arm, ranked below', () => {
    const fused = reciprocalRankFusion(
      { lexical: { items: [{ chunkId: 'only-lexical' }] }, vector: { items: [] } },
      (hit) => hit.chunkId,
    );
    expect(fused).toHaveLength(1);
    expect(fused[0]!.ranks).toEqual({ lexical: 1 });
  });
});

describe('hybrid search', () => {
  it('finds an exact token that the vector arm misses', async () => {
    const source = ready();
    if (!source) return;

    // The embedder only knows the topic "balance"; it has no idea what
    // eth_getLogs is, which is exactly the case dense retrieval handles badly.
    const embedder = topicEmbedder({ balance: 0, logs: 1 });
    await addChunk(source, 'https://x.test/balance', 'check an account balance', [
      ...oneHot(0),
    ]);
    await addChunk(source, 'https://x.test/getlogs', 'eth_getLogs returns event logs', [
      ...oneHot(1),
    ]);

    const service = new SearchService(source, embedder, buildSearchConfig({}));

    const vectorOnly = (await service.search('eth_getLogs', { topK: 10, mode: 'vector', scope })).results;
    const hybrid = (await service.search('eth_getLogs', { topK: 10, mode: 'hybrid', scope })).results;

    // The vector arm cannot tell the two apart on this query; BM25 can.
    expect(hybrid[0]!.url).toBe('https://x.test/getlogs');
    expect(hybrid[0]!.ranks.lexical).toBe(1);
    expect(vectorOnly.length).toBeGreaterThan(0);
  });

  it('serves lexical-only with no embedder call at all', async () => {
    const source = ready();
    if (!source) return;
    await addChunk(source, 'https://x.test/a', 'the paymaster sponsors gas');

    let called = false;
    const embedder: Embedder = {
      model: 'never',
      dimensions: DIMENSIONS,
      embed: async () => {
        called = true;
        return [];
      },
    };

    const service = new SearchService(source, embedder, buildSearchConfig({}));
    const results = (await service.search('paymaster', { topK: 10, mode: 'lexical', scope })).results;

    expect(results).toHaveLength(1);
    // Search still works with no embedding provider configured.
    expect(called).toBe(false);
  });

  it('returns one result per document, keeping its best chunk', async () => {
    const source = ready();
    if (!source) return;
    await addChunk(source, 'https://x.test/page', 'paymaster sponsors gas', oneHot(0));
    await addChunk(source, 'https://x.test/page', 'a second passage about the paymaster', oneHot(0));

    const service = new SearchService(source, topicEmbedder({ paymaster: 0 }), buildSearchConfig({}));
    const results = (await service.search('paymaster', { topK: 10, scope })).results;

    expect(results).toHaveLength(1);
    expect(results[0]!.url).toBe('https://x.test/page');
  });

  it('still rejects a blank query', async () => {
    const source = ready();
    if (!source) return;
    const service = new SearchService(source, topicEmbedder({}), buildSearchConfig({}));
    await expect(service.search('   ', { scope })).rejects.toThrow();
  });
});

function oneHot(slot: number): number[] {
  const vector = new Array<number>(DIMENSIONS).fill(0);
  vector[slot] = 1;
  return vector;
}

describe('paging', () => {
  const service = (source: DataSource, overrides: Partial<SearchConfig> = {}) =>
    new SearchService(source, topicEmbedder({}), { ...buildSearchConfig({}), ...overrides });

  /** Twelve documents that all match, so paging has something to divide. */
  async function seedPages(source: DataSource) {
    for (let index = 0; index < 12; index += 1) {
      await addChunk(
        source,
        `https://x.test/page-${index}`,
        `paymaster documentation section ${index} about sponsoring gas`,
      );
    }
  }

  /**
   * Twelve documents the two arms rank in opposite orders: term frequency
   * falls as the index rises, and cosine similarity rises with it. That
   * disagreement is what makes the retrieval window observable, because a
   * document only contributes an arm's rank once the window reaches it.
   */
  async function seedOpposedArms(source: DataSource) {
    for (let index = 0; index < 12; index += 1) {
      const embedding = new Array<number>(DIMENSIONS).fill(0);
      embedding[0] = 1;
      embedding[1] = (11 - index) / 12;
      await addChunk(
        source,
        `https://opposed.test/page-${index}`,
        `${Array(12 - index).fill('paymaster').join(' ')} section ${index}`,
        embedding,
      );
    }
  }

  /** Answers every query with the vector that ranks the seeds above in order. */
  const queryEmbedder = (): Embedder => ({
    model: 'query-stub',
    dimensions: DIMENSIONS,
    embed: async (texts) =>
      texts.map(() => {
        const vector = new Array<number>(DIMENSIONS).fill(0);
        vector[0] = 1;
        return vector;
      }),
  });

  it('divides results into pages that neither overlap nor drop anything', async () => {
    const source = ready();
    if (!source) return;
    await seedPages(source);

    const first = await service(source).search('paymaster', { topK: 5, scope });
    const second = await service(source).search('paymaster', { topK: 5, offset: 5, scope });
    const third = await service(source).search('paymaster', { topK: 5, offset: 10, scope });

    expect(first.results).toHaveLength(5);
    expect(second.results).toHaveLength(5);
    expect(third.results).toHaveLength(2);

    expect(first.total).toBe(12);
    expect(first.hasMore).toBe(true);
    expect(third.hasMore).toBe(false);

    // Every document appears exactly once across the three pages.
    const urls = [...first.results, ...second.results, ...third.results].map((r) => r.url);
    expect(new Set(urls).size).toBe(12);
  });

  it('serves every page from one window, so paging matches a single big page', async () => {
    const source = ready();
    if (!source) return;
    await seedOpposedArms(source);

    // The property that makes paging trustworthy: walking it must produce
    // exactly what asking for everything at once produces. A window narrower
    // than the result set is the case that breaks if retrieval depth is ever
    // allowed to grow with the offset.
    const searcher = new SearchService(source, queryEmbedder(), {
      ...buildSearchConfig({}),
      candidates: 6,
    });

    const whole = await searcher.search('paymaster', { topK: 12, scope });
    const walked: string[] = [];
    for (let offset = 0; offset < whole.total; offset += 4) {
      const page = await searcher.search('paymaster', { topK: 4, offset, scope });
      walked.push(...page.results.map((result) => result.url));
    }

    expect(whole.results.length).toBeGreaterThan(4);
    expect(walked).toEqual(whole.results.map((result) => result.url));
  });

  it('reports a floor rather than a count when the arms hit the ceiling', async () => {
    const source = ready();
    if (!source) return;
    await seedPages(source);

    // A window below the number of matches: the arms come back full, so the
    // total cannot be claimed as exact.
    const capped = service(source, { candidates: 3 });
    const page = await capped.search('paymaster', { topK: 2, scope });

    expect(page.exhaustive).toBe(false);
    expect(page.hasMore).toBe(true);
    expect(page.total).toBeLessThan(12);
  });

  it('serves an empty page past the end without claiming there is more', async () => {
    const source = ready();
    if (!source) return;
    await seedPages(source);

    const past = await service(source).search('paymaster', { topK: 5, offset: 500, scope });
    expect(past.results).toHaveLength(0);
    expect(past.total).toBe(12);
    expect(past.hasMore).toBe(false);
  });
});
