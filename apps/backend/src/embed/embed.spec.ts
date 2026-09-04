import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ChunkEntity } from '../database/chunk.entity';
import { DocumentEntity } from '../database/document.entity';
import { buildDataSourceOptions } from '../database/typeorm.config';
import { truncateWuzzyTables } from '../testing/database';
import { chunk } from './chunker';
import { embedPending } from './embed';
import { DEFAULT_DIMENSIONS, type Embedder } from './embedder';

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
    protocol: 'wuzzy/crawl',
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
