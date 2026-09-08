import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ChunkEntity } from '../database/chunk.entity';
import { DocumentEntity } from '../database/document.entity';
import { buildDataSourceOptions } from '../database/typeorm.config';
import { truncateWuzzyTables } from '../testing/database';
import { chunk } from './chunker';
import { embedPending } from './embed';
import { createEmbedder, DEFAULT_DIMENSIONS, type Embedder } from './embedder';
import { PROTOCOL } from '../canonicalize/v1';

let dataSource: DataSource | undefined;
let unreachable: string | undefined;
let calls = 0;

const countingEmbedder = (): Embedder => ({
  model: 'stub',
  dimensions: DEFAULT_DIMENSIONS,
  embed: async (texts) => {
    calls += texts.length;
    return texts.map((_, index) => {
      const vector = new Array<number>(DEFAULT_DIMENSIONS).fill(0);
      vector[index % DEFAULT_DIMENSIONS] = 1;
      return vector;
    });
  },
});

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
  calls = 0;
  await truncateWuzzyTables(dataSource);
});

afterAll(async () => {
  await dataSource?.destroy();
});

const ready = (): DataSource | null => {
  if (dataSource) return dataSource;
  console.log(`skipped: database unreachable (${unreachable})`);
  return null;
};

const PARAGRAPH =
  'Deploying to Base requires a funded wallet and a configured RPC endpoint, and the ' +
  'transaction reverts outright when the account balance is zero. ';

const saveDocument = (source: DataSource, url: string, content: string) =>
  source.getRepository(DocumentEntity).save({
    url,
    title: 'Deploy',
    content,
    rawHash: 'a'.repeat(64),
    contentHash: 'b'.repeat(64),
    protocol: PROTOCOL,
    protocolVersion: 1,
    robotsStatus: 'allowed',
    httpStatus: 200,
    fetchedAt: new Date(),
    embeddedAt: null,
    attestationUid: null,
    attestedAt: null,
  });

describe('chunker', () => {
  it('carries the heading trail into each chunk', () => {
    const chunks = chunk(`# Deploy\n\n${PARAGRAPH}\n\n## Prerequisites\n\n${PARAGRAPH}\n`);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]!.text).toStartWith('# Deploy');
    const nested = chunks.find((c) => c.text.includes('## Prerequisites'));
    expect(nested?.text).toContain('# Deploy');
  });

  it('splits oversized bodies and numbers chunks contiguously', () => {
    const chunks = chunk(`# Deploy\n\n${PARAGRAPH.repeat(60)}\n`, { maxChars: 600 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, index) => index));
    for (const piece of chunks) expect(piece.text.trim()).not.toBe('');
  });

  it('carries the document title into every chunk', () => {
    // Readability lifts the h1 into the title, so a page often never states its
    // own name in the indexed body. Without this a page cannot be found by name.
    const chunks = chunk(`## Parameters\n\n${PARAGRAPH}\n\n## Returns\n\n${PARAGRAPH}\n`, {
      title: 'eth_getLogs - Base Documentation',
    });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const piece of chunks) {
      expect(piece.text).toContain('eth_getLogs');
    }
    // The section heading is still there underneath it.
    expect(chunks.some((c) => c.text.includes('## Parameters'))).toBe(true);
  });

  it('omits the root heading when there is no title', () => {
    const chunks = chunk(`## Parameters\n\n${PARAGRAPH}\n`, { title: null });
    expect(chunks[0]!.text).toStartWith('## Parameters');
  });

  it('does not treat a # inside a fenced block as a heading', () => {
    const chunks = chunk(`# Deploy\n\n${PARAGRAPH}\n\n\`\`\`bash\n# not a heading\ncast call\n\`\`\`\n`);
    expect(chunks.some((c) => c.text.includes('# not a heading'))).toBe(true);
    expect(chunks.every((c) => !c.text.startsWith('# not a heading'))).toBe(true);
  });
});

describe('embed pass', () => {
  it('embeds pending documents and records embedded_at', async () => {
    const source = ready();
    if (!source) return;
    await saveDocument(source, 'https://docs.base.org/a', `# Deploy\n\n${PARAGRAPH}\n`);

    const summary = await embedPending(source, { embedder: countingEmbedder() });
    expect(summary.documents).toBe(1);
    expect(summary.chunks).toBeGreaterThan(0);

    const stored = await source.getRepository(DocumentEntity).findOneOrFail({
      where: { url: 'https://docs.base.org/a' },
    });
    expect(stored.embeddedAt).not.toBeNull();

    const chunks = await source.getRepository(ChunkEntity).find();
    expect(chunks).toHaveLength(summary.chunks);
    expect(chunks[0]!.embedding).toBeArray();
  });

  it('is a no-op on an unchanged corpus', async () => {
    const source = ready();
    if (!source) return;
    await saveDocument(source, 'https://docs.base.org/a', `# Deploy\n\n${PARAGRAPH}\n`);

    await embedPending(source, { embedder: countingEmbedder() });
    const firstPassCalls = calls;
    expect(firstPassCalls).toBeGreaterThan(0);

    calls = 0;
    const second = await embedPending(source, { embedder: countingEmbedder() });
    expect(second.documents).toBe(0);
    expect(second.chunks).toBe(0);
    // The restartability guarantee: nothing was sent to the embedder at all.
    expect(calls).toBe(0);
  });

  it('re-embeds a document whose content changed, replacing old chunks', async () => {
    const source = ready();
    if (!source) return;
    const documents = source.getRepository(DocumentEntity);
    const document = await saveDocument(
      source,
      'https://docs.base.org/a',
      `# Deploy\n\n${PARAGRAPH.repeat(20)}\n`,
    );

    await embedPending(source, { embedder: countingEmbedder() });
    const firstChunks = await source.getRepository(ChunkEntity).find();
    expect(firstChunks.length).toBeGreaterThan(1);

    // What the crawler does when the canonical content hash moves.
    await documents.update(
      { id: document.id },
      { content: `# Deploy\n\n${PARAGRAPH}\n`, contentHash: 'c'.repeat(64), embeddedAt: null },
    );

    const summary = await embedPending(source, { embedder: countingEmbedder() });
    expect(summary.documents).toBe(1);

    const secondChunks = await source.getRepository(ChunkEntity).find();
    expect(secondChunks.length).toBeLessThan(firstChunks.length);
    expect(secondChunks.every((c) => c.text.length > 0)).toBe(true);
  });
});

describe('embedding client', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const vectors = (count: number, dimensions: number) =>
    new Response(
      JSON.stringify({
        data: Array.from({ length: count }, (_, index) => ({
          index,
          embedding: Array.from({ length: dimensions }, () => 0.1),
        })),
      }),
      { status: 200 },
    );

  const replies = (...responses: Response[]) => {
    let call = 0;
    globalThis.fetch = (async () =>
      responses[Math.min(call++, responses.length - 1)]!) as unknown as typeof fetch;
    return () => call;
  };

  it('retries a rate limit rather than failing the crawl that owns it', async () => {
    const calls = replies(new Response('slow down', { status: 429 }), vectors(1, 4));
    const waits: number[] = [];

    const embedder = createEmbedder({ dimensions: 4, sleep: async (ms) => void waits.push(ms) }, {});
    expect(await embedder.embed(['hello'])).toHaveLength(1);
    expect(calls()).toBe(2);
    expect(waits).toEqual([500]);
  });

  it('waits as long as Retry-After asks, because the provider knows when its quota resets', async () => {
    replies(
      new Response('slow down', { status: 429, headers: { 'retry-after': '2' } }),
      vectors(1, 4),
    );
    const waits: number[] = [];

    const embedder = createEmbedder({ dimensions: 4, sleep: async (ms) => void waits.push(ms) }, {});
    await embedder.embed(['hello']);
    expect(waits).toEqual([2000]);
  });

  it('gives up once the budget is spent and reports the status', async () => {
    const calls = replies(new Response('nope', { status: 429 }));

    const embedder = createEmbedder({ dimensions: 4, maxRetries: 2, sleep: async () => {} }, {});
    await expect(embedder.embed(['hello'])).rejects.toThrow(/429/);
    expect(calls()).toBe(3); // the first attempt, then two retries
  });

  it('does not retry a rejected key, which no amount of waiting fixes', async () => {
    const calls = replies(new Response('bad key', { status: 401 }));

    const embedder = createEmbedder({ dimensions: 4, sleep: async () => {} }, {});
    await expect(embedder.embed(['hello'])).rejects.toThrow(/401/);
    expect(calls()).toBe(1);
  });
});
