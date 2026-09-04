import { join } from 'node:path';
import type { SourceFormat } from './index';

export const FIXTURES_DIR = join(import.meta.dir, '../../../../../fixtures/canonicalize-v1');

/**
 * The URL each fixture is treated as having been fetched from. Readability
 * resolves relative links against it, so it is part of the input and has to be
 * pinned alongside the bytes for the vectors to reproduce.
 */
export const fixtureUrl = (input: string): string => `https://docs.base.org/fixtures/${input}`;

export const formatOf = (input: string): SourceFormat =>
  input.endsWith('.md') ? 'markdown' : 'html';

/** The Examples table of contracts/canonicalize-v1.feature, in file form. */
export const CONFORMANCE_VECTORS = [
  { input: 'docs-page.html', md: 'docs-page.md', hash: 'docs-page.hash' },
  { input: 'code-blocks.html', md: 'code-blocks.md', hash: 'code-blocks.hash' },
  { input: 'nested-lists.html', md: 'nested-lists.md', hash: 'nested-lists.hash' },
  { input: 'unicode-nfc.html', md: 'unicode-nfc.md', hash: 'unicode-nfc.hash' },
  { input: 'crlf-endings.html', md: 'crlf-endings.md', hash: 'crlf-endings.hash' },
  {
    input: 'trailing-whitespace.html',
    md: 'trailing-whitespace.md',
    hash: 'trailing-whitespace.hash',
  },
  { input: 'markdown-native.md', md: 'markdown-native.expected.md', hash: 'markdown-native.hash' },
  {
    input: 'readability-fallback.html',
    md: 'readability-fallback.md',
    hash: 'readability-fallback.hash',
  },
] as const;
