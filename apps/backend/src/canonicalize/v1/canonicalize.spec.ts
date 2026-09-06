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

scenario('scripts, styles and comments never reach the hash', async () => {
  const result = await canonicalizeFixture('inline-code.html');

  expect(result.skipped).toBe(false);
  if (result.skipped) return;

  // A client-rendered page gives Readability nothing to extract, so the whole
  // body is converted instead. That is the path where an inline theme-switcher
  // becomes the page's entire indexed content, as seen on docs.attest.org.
  for (const fragment of [
    'localStorage',
    'setAttribute',
    'data-theme',
    'window.analytics',
    '--brand',
    '.sidebar',
    'commit 9f3ac1',
    'TODO: link the policy reference',
  ]) {
    expect(result.markdown).not.toContain(fragment);
  }

  // The article itself survives: this removes code, not content.
  expect(result.markdown).toContain('A paymaster settles gas on behalf of an account');
  expect(result.markdown).toContain('per-account spend ceiling');
  expect(result.title).toBe('Sponsoring gas with a paymaster');
});

scenario('site chrome never reaches the hash', async () => {
  const result = await canonicalizeFixture('docs-page.html');
  expect(result.skipped).toBe(false);
  if (result.skipped) return;

  // Readability's whole job. Without it every page in a docs site shares its
  // navigation, and the hash commits to the template rather than the article.
  for (const chrome of ['Skip to content', 'On this page', 'Copyright', 'Edit this page']) {
    expect(result.markdown).not.toContain(chrome);
  }
  expect(result.markdown.length).toBeGreaterThan(MIN_CONTENT_CHARS);
});

scenario('the fetch URL is part of the input', async () => {
  const bytes = await readFixture('relative-links.html');
  const at = (url: string) => canonicalize({ source: bytes, url, format: 'html' });

  // Relative links resolve against the fetch URL, so the same bytes served
  // from two places are two different documents. A verifier that does not
  // pin the URL cannot reproduce the hash.
  const first = at('https://docs.base.org/guides/deploy');
  const second = at('https://example.test/elsewhere/deploy');
  expect(first.skipped).toBe(false);
  expect(second.skipped).toBe(false);
  if (first.skipped || second.skipped) return;

  expect(first.contentHash).not.toBe(second.contentHash);
  expect(first.markdown).toContain('https://docs.base.org/deploy');
  expect(second.markdown).toContain('https://example.test/deploy');

  // Same bytes, same URL, same hash: the difference is the URL, not the run.
  expect(at('https://docs.base.org/guides/deploy')).toMatchObject({
    contentHash: first.contentHash,
  });
});

scenario('line endings do not move the content hash', async () => {
  const lf = await readFixture('docs-page.html');
  const crlf = new TextEncoder().encode(
    new TextDecoder().decode(lf).replace(/\r?\n/g, '\r\n'),
  );

  const url = fixtureUrl('docs-page.html');
  const a = canonicalize({ source: lf, url, format: 'html' });
  const b = canonicalize({ source: crlf, url, format: 'html' });
  expect(a.skipped).toBe(false);
  expect(b.skipped).toBe(false);
  if (a.skipped || b.skipped) return;

  // contentHash commits to the readable content; rawHash to the transfer.
  expect(b.contentHash).toBe(a.contentHash);
  expect(b.rawHash).not.toBe(a.rawHash);
});

scenario('malformed markup canonicalizes without failing', async () => {
  const result = await canonicalizeFixture('malformed.html');
  expect(result.skipped).toBe(false);
  if (result.skipped) return;

  // Unclosed and mis-nested tags are what the open web actually serves. The
  // parser has to resolve them the same way every time, or the hash is a
  // function of the parser's mood.
  expect(result.markdown).toContain('A bundler quotes three limits');
  expect(result.markdown).toContain('Call gas covers the operation');

  const again = await canonicalizeFixture('malformed.html');
  expect(again).toMatchObject({ contentHash: result.contentHash });
  expect(normalize(result.markdown)).toBe(result.markdown);
});

scenario('invalid UTF-8 bytes decode deterministically', async () => {
  const result = await canonicalizeFixture('invalid-utf8.html');
  expect(result.skipped).toBe(false);
  if (result.skipped) return;

  // A truncated multi-byte sequence becomes the replacement character rather
  // than throwing or being dropped, so a page with one bad byte still hashes.
  expect(result.markdown).toContain('\uFFFD');
  expect(result.markdown).toContain('the document continues normally after it');

  const again = await canonicalizeFixture('invalid-utf8.html');
  expect(again).toMatchObject({ contentHash: result.contentHash });
});
