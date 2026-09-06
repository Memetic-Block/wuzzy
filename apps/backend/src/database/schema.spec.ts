import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ChunkEntity } from './chunk.entity';
import { DocumentEntity } from './document.entity';
import { FetchLogEntity } from './fetch-log.entity';
import { buildDataSourceOptions } from './typeorm.config';
import { PROTOCOL } from '../canonicalize/v1';

/**
 * Guards the hand-written migration against the entities. The migration owns
 * the schema outright (synchronize is off everywhere), so nothing else would
 * notice a column that drifted from the entity that reads it.
 */
let dataSource: DataSource | undefined;
let unreachable: string | undefined;

beforeAll(async () => {
  const candidate = new DataSource(buildDataSourceOptions());
  try {
    dataSource = await candidate.initialize();
  } catch (error) {
    // CI always provides the service, so an unreachable database there is a
    // real failure rather than a reason to skip.
    if (process.env.CI) throw error;
    unreachable = (error as Error).message;
  }
});

afterAll(async () => {
  await dataSource?.destroy();
});

const hex = (seed: string) => seed.repeat(64).slice(0, 64);

describe('wuzzy schema', () => {
  it('round-trips documents, fetch_log and chunks through the entities', async () => {
    if (!dataSource) {
      console.log(`skipped: database unreachable (${unreachable})`);
      return;
    }

    const documents = dataSource.getRepository(DocumentEntity);
    const fetchLog = dataSource.getRepository(FetchLogEntity);
    const chunks = dataSource.getRepository(ChunkEntity);

    const url = `https://docs.base.org/schema-spec/${crypto.randomUUID()}`;
    const document = await documents.save({
      url,
      title: 'Deploy a smart contract',
      content: '# Deploy\n',
      rawHash: hex('a'),
      contentHash: hex('b'),
      protocol: PROTOCOL,
      protocolVersion: 1,
      robotsStatus: 'allowed',
      httpStatus: 200,
      fetchedAt: new Date(),
      embeddedAt: null,
      attestationUid: null,
      attestedAt: null,
    });

    try {
      await fetchLog.save({
        documentId: document.id,
        url,
        httpStatus: 200,
        rawHash: hex('a'),
        contentHash: hex('b'),
        contentChanged: true,
      });

      await chunks.save({
        documentId: document.id,
        ordinal: 0,
        text: 'Deploy a contract to Base.',
        tokenCount: 7,
        embedding: Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0)),
      });

      const stored = await documents.findOneOrFail({ where: { id: document.id } });
      expect(stored.contentHash).toBe(hex('b'));
      expect(stored.protocolVersion).toBe(1);
      expect(stored.embeddedAt).toBeNull();
      expect(stored.attestationUid).toBeNull();

      const trail = await fetchLog.find({ where: { documentId: document.id } });
      expect(trail).toHaveLength(1);
      expect(trail[0]?.contentChanged).toBe(true);

      // The KNN path the search endpoint will use, over the hnsw index.
      const nearest = await dataSource.query(
        `SELECT text FROM chunks WHERE document_id = $1
         ORDER BY embedding <=> $2::vector LIMIT 1`,
        [document.id, `[${Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0))}]`],
      );
      expect(nearest[0]?.text).toBe('Deploy a contract to Base.');
    } finally {
      // Cascades to chunks; fetch_log keeps its row with a null document_id.
      await documents.delete({ id: document.id });
      await fetchLog.delete({ url });
    }
  });
});
