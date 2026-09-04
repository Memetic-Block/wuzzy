import { describe, expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { scenario } from '../../testing/scenario';
import { canonicalize, MIN_CONTENT_CHARS, normalize, rawHash } from './index';
import { CONFORMANCE_VECTORS, FIXTURES_DIR, formatOf, fixtureUrl } from './fixtures';

const readFixture = async (name: string): Promise<Uint8Array> =>
  new Uint8Array(await Bun.file(join(FIXTURES_DIR, name)).arrayBuffer());

const canonicalizeFixture = async (input: string) =>
  canonicalize({
    source: await readFixture(input),
    url: fixtureUrl(input),
    format: formatOf(input),
  });

describe('wuzzy/crawl canonicalization protocol v1', () => {
  scenario('conformance vectors reproduce pinned markdown and hash', async () => {
    for (const vector of CONFORMANCE_VECTORS) {
      const result = await canonicalizeFixture(vector.input);
      if (result.skipped) throw new Error(`${vector.input} was skipped, expected a document`);

      const expectedMarkdown = await Bun.file(join(FIXTURES_DIR, vector.md)).text();
      const expectedHash = (await Bun.file(join(FIXTURES_DIR, vector.hash)).text()).trim();

      expect(`${vector.input}\n${result.markdown}`).toBe(`${vector.input}\n${expectedMarkdown}`);
      expect(`${vector.input} ${result.contentHash}`).toBe(`${vector.input} ${expectedHash}`);
    }
  });

  scenario('normalization is idempotent', async () => {
    for (const vector of CONFORMANCE_VECTORS) {
      const result = await canonicalizeFixture(vector.input);
      if (result.skipped) throw new Error(`${vector.input} was skipped, expected a document`);

      // Re-normalizing canonical markdown is the operation a third-party
      // verifier performs when it re-derives a hash from published output.
      const again = normalize(result.markdown);
      expect(`${vector.input}\n${again}`).toBe(`${vector.input}\n${result.markdown}`);
      expect(createHash('sha256').update(again, 'utf8').digest('hex')).toBe(result.contentHash);
    }
  });

  scenario('thin pages are rejected, not hashed', async () => {
    const result = await canonicalizeFixture('thin-page.html');

    expect(result.skipped).toBe(true);
    if (!result.skipped) throw new Error('expected thin-page.html to be skipped');
    expect(result.reason).toBe('thin');
    // No canonical markdown and no content hash exist to write a document row
    // or an attestation from.
    expect(result).not.toHaveProperty('markdown');
    expect(result).not.toHaveProperty('contentHash');

    const asDocument = canonicalize({
      source: await readFixture('docs-page.html'),
      url: fixtureUrl('docs-page.html'),
    });
    if (asDocument.skipped) throw new Error('docs-page.html should not be thin');
    expect(asDocument.markdown.trim().length).toBeGreaterThanOrEqual(MIN_CONTENT_CHARS);
  });

  scenario('raw hash commits to exact received bytes', async () => {
    const bytes = await readFixture('docs-page.html');

    // Computed independently of the module under test, over the same bytes.
    const independent = createHash('sha256').update(Buffer.from(bytes)).digest('hex');
    expect(rawHash(bytes)).toBe(independent);

    const result = canonicalize({ source: bytes, url: fixtureUrl('docs-page.html') });
    if (result.skipped) throw new Error('docs-page.html should not be thin');
    expect(result.rawHash).toBe(independent);

    // The raw hash commits to the bytes, not to the canonical form: a source
    // that differs only in line endings keeps its content hash and changes its
    // raw hash.
    const crlf = new TextEncoder().encode(
      new TextDecoder().decode(bytes).replace(/\n/g, '\r\n'),
    );
    const fromCrlf = canonicalize({ source: crlf, url: fixtureUrl('docs-page.html') });
    if (fromCrlf.skipped) throw new Error('docs-page.html should not be thin');
    expect(fromCrlf.contentHash).toBe(result.contentHash);
    expect(fromCrlf.rawHash).not.toBe(result.rawHash);
  });
});
