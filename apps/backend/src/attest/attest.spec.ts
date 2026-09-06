import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { DocumentEntity } from '../database/document.entity';
import { buildDataSourceOptions } from '../database/typeorm.config';
import { truncateWuzzyTables } from '../testing/database';
import {
  attestPending,
  createEasSubmitter,
  MissingAttesterKeyError,
  type AttestationRequest,
  type AttestationSubmitter,
} from './attestor';
import { decodeAttestation, encodeAttestation, schemaCarriesNoContent } from './schema';
import { chainSettings, EAS_ADDRESS, SCHEMA_REGISTRY_ADDRESS, UnknownChainError } from './chain';
import { attestationUrl } from '../verify/verify';
import { PROTOCOL, PROTOCOL_VERSION } from '../canonicalize/v1';

let dataSource: DataSource | undefined;
let unreachable: string | undefined;

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

/** Records what it was asked to attest and hands back deterministic UIDs. */
function recordingSubmitter() {
  const batches: (readonly AttestationRequest[])[] = [];
  let issued = 0;
  const submitter: AttestationSubmitter = {
    submit: async (requests) => {
      batches.push(requests);
      return requests.map(() => `0x${(issued++).toString(16).padStart(64, '0')}`);
    },
  };
  return { submitter, batches };
}

const saveDocument = (source: DataSource, url: string, overrides: Record<string, unknown> = {}) =>
  source.getRepository(DocumentEntity).save({
    url,
    title: 'Deploy',
    content: '# Deploy\n\nBody.\n',
    rawHash: 'a'.repeat(64),
    contentHash: 'b'.repeat(64),
    protocol: 'wuzzy/crawl',
    protocolVersion: 1,
    robotsStatus: 'allowed',
    httpStatus: 200,
    fetchedAt: new Date('2026-02-01T00:00:00Z'),
    embeddedAt: new Date('2026-02-01T01:00:00Z'),
    attestationUid: null,
    attestedAt: null,
    ...overrides,
  });

describe('attestation schema', () => {
  it('carries only hashes and metadata, never content', () => {
    expect(schemaCarriesNoContent()).toBe(true);
    // The guard has to actually reject a content field, or it proves nothing.
    expect(schemaCarriesNoContent('string url,string content')).toBe(false);
    expect(schemaCarriesNoContent('string url,string markdown')).toBe(false);
  });

  it('round-trips the attested fields', () => {
    const encoded = encodeAttestation({
      url: 'https://docs.base.org/deploy',
      protocol: 'wuzzy/crawl',
      protocolVersion: 1,
      contentHash: 'b'.repeat(64),
      rawHash: 'a'.repeat(64),
      fetchedAt: new Date('2026-02-01T00:00:00Z'),
    });

    const decoded = decodeAttestation(encoded);
    expect(decoded.url).toBe('https://docs.base.org/deploy');
    expect(decoded.protocol).toBe('wuzzy/crawl');
    expect(decoded.protocolVersion).toBe('1');
    expect(decoded.contentHash).toBe(`0x${'b'.repeat(64)}`);
    expect(decoded.rawHash).toBe(`0x${'a'.repeat(64)}`);
    expect(decoded.fetchedAt).toBe(String(Date.UTC(2026, 1, 1) / 1000));
    // The document body is nowhere in the payload.
    expect(encoded).not.toContain(Buffer.from('Deploy').toString('hex'));
  });
});

describe('batch attestor', () => {
  it('attests unattested documents and backfills their UIDs', async () => {
    const source = ready();
    if (!source) return;
    await saveDocument(source, 'https://docs.base.org/a');
    await saveDocument(source, 'https://docs.base.org/b');

    const { submitter, batches } = recordingSubmitter();
    const summary = await attestPending(source, { submitter });

    expect(summary.attested).toBe(2);
    expect(summary.batches).toBe(1);
    expect(batches[0]).toHaveLength(2);

    const stored = await source.getRepository(DocumentEntity).find();
    for (const document of stored) {
      expect(document.attestationUid).toMatch(/^0x[0-9a-f]{64}$/);
      expect(document.attestedAt).not.toBeNull();
    }
  });

  it('re-runs attest only what is new or changed', async () => {
    const source = ready();
    if (!source) return;
    const documents = source.getRepository(DocumentEntity);
    await saveDocument(source, 'https://docs.base.org/a');

    const first = recordingSubmitter();
    await attestPending(source, { submitter: first.submitter });
    expect(first.batches).toHaveLength(1);

    // Nothing changed: the second pass has no work at all.
    const second = recordingSubmitter();
    expect((await attestPending(source, { submitter: second.submitter })).attested).toBe(0);
    expect(second.batches).toHaveLength(0);

    // What the crawler does when content moves: clears the UID.
    const existing = await documents.findOneOrFail({ where: { url: 'https://docs.base.org/a' } });
    await documents.update({ id: existing.id }, { attestationUid: null, attestedAt: null });

    const third = recordingSubmitter();
    expect((await attestPending(source, { submitter: third.submitter })).attested).toBe(1);
  });

  it('skips documents that have not been embedded yet', async () => {
    const source = ready();
    if (!source) return;
    await saveDocument(source, 'https://docs.base.org/a', { embeddedAt: null });

    const { submitter } = recordingSubmitter();
    expect((await attestPending(source, { submitter })).attested).toBe(0);
    expect((await attestPending(source, { submitter, embeddedOnly: false })).attested).toBe(1);
  });

  it('splits large corpora into batches', async () => {
    const source = ready();
    if (!source) return;
    for (let index = 0; index < 7; index += 1) {
      await saveDocument(source, `https://docs.base.org/page-${index}`);
    }

    const { submitter, batches } = recordingSubmitter();
    const summary = await attestPending(source, { submitter, batchSize: 3 });
    expect(summary.attested).toBe(7);
    expect(summary.batches).toBe(3);
    expect(batches.map((batch) => batch.length)).toEqual([3, 3, 1]);
  });

  it('refuses to build a submitter without an attester key', () => {
    expect(() => createEasSubmitter({}, { EAS_SCHEMA_UID: `0x${'1'.repeat(64)}` })).toThrow(
      MissingAttesterKeyError,
    );
    expect(() => createEasSubmitter({}, {})).toThrow(MissingAttesterKeyError);
  });
});

describe('attestation chain', () => {
  const uid = `0x${'e'.repeat(64)}`;

  it('defaults to Base mainnet', () => {
    expect(chainSettings({}).rpcUrl).toBe('https://mainnet.base.org');
    expect(attestationUrl(uid, {})).toBe(`https://base.easscan.org/attestation/view/${uid}`);
  });

  it('moves the explorer and the RPC together', () => {
    // The failure this prevents is silent: attesting on one network while
    // linking readers to an explorer for another, where the attestation is
    // simply absent and the provenance claim looks false.
    const sepolia = { EAS_CHAIN: 'base-sepolia' };
    expect(chainSettings(sepolia).rpcUrl).toBe('https://sepolia.base.org');
    expect(attestationUrl(uid, sepolia)).toBe(
      `https://base-sepolia.easscan.org/attestation/view/${uid}`,
    );
  });

  it('refuses a chain it has no settings for', () => {
    expect(() => chainSettings({ EAS_CHAIN: 'ethereum' })).toThrow(UnknownChainError);
  });

  it('uses the same predeploy addresses on both networks', () => {
    // Verified against both RPCs: EAS and the schema registry are OP Stack
    // predeploys at identical addresses, so the address is not per-chain.
    expect(EAS_ADDRESS).toBe('0x4200000000000000000000000000000000000021');
    expect(SCHEMA_REGISTRY_ADDRESS).toBe('0x4200000000000000000000000000000000000020');
  });
});

describe('protocol identifier', () => {
  /**
   * The one place the literal is pinned. Everything else derives from the
   * constant, so this is what has to be changed deliberately, and changing it
   * is a protocol announcement rather than a refactor.
   */
  it('carries the experimental label, and is half of what identifies a procedure', () => {
    expect(PROTOCOL).toBe('wuzzy/crawl-experimental');
    expect(PROTOCOL_VERSION).toBe(1);

    // The pair goes onchain, so a verifier can tell a future stable
    // wuzzy/crawl v1 from this experimental v1 rather than running the wrong
    // procedure against a hash that will not reproduce.
    const encoded = encodeAttestation({
      url: 'https://docs.base.org/x',
      protocol: PROTOCOL,
      protocolVersion: PROTOCOL_VERSION,
      contentHash: 'b'.repeat(64),
      rawHash: 'a'.repeat(64),
      fetchedAt: new Date('2026-02-01T00:00:00Z'),
    });
    const decoded = decodeAttestation(encoded);
    expect(decoded.protocol).toBe('wuzzy/crawl-experimental');
    expect(decoded.protocolVersion).toBe('1');
  });
});
