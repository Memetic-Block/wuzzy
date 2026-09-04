/**
 * wuzzy/crawl canonicalization, protocol version 1.
 *
 * This module is the pinned public procedure that every EAS attestation with
 * protocolVersion=1 refers to. Third parties build independent verifiers
 * against it, so its output is a protocol artifact, not an implementation
 * detail: identical input bytes must produce an identical content hash on any
 * machine, forever.
 *
 * FROZEN once the first mainnet attestation lands. After that point no change
 * to observable behaviour belongs in this directory — a behaviour change is
 * protocol v2 in a new module, and v1 stays callable indefinitely so old
 * attestations remain verifiable.
 *
 * Nothing outside this module computes a content or raw hash.
 */
import { Readability } from '@mozilla/readability';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';

export const PROTOCOL = 'wuzzy/crawl';
export const PROTOCOL_VERSION = 1;

/** Canonical markdown shorter than this is not worth indexing or attesting. */
export const MIN_CONTENT_CHARS = 80;

export type SourceFormat = 'html' | 'markdown';

export interface CanonicalDocument {
  readonly skipped: false;
  readonly title: string | null;
  /** Canonical markdown. The bytes `contentHash` commits to. */
  readonly markdown: string;
  /** sha256 of the canonical markdown, hex. */
  readonly contentHash: string;
  /** sha256 of the exact received bytes, hex. */
  readonly rawHash: string;
  readonly protocol: typeof PROTOCOL;
  readonly protocolVersion: typeof PROTOCOL_VERSION;
}

export interface SkippedDocument {
  readonly skipped: true;
  readonly reason: 'thin';
  readonly rawHash: string;
}

export type CanonicalizeResult = CanonicalDocument | SkippedDocument;

const turndown = (): TurndownService =>
  new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });

/**
 * The normalization tail, applied to markdown from either source format.
 * Ordering is part of the protocol: NFC before the whitespace passes, because
 * composition can turn a combining sequence into a single character and change
 * what counts as trailing.
 */
export function normalize(markdown: string): string {
  return markdown
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .concat('\n');
}

/**
 * Readability first, so navigation, sidebars and footers never reach the hash.
 * When Readability declines to extract an article — short pages, pages with no
 * candidate container — the whole `<body>` is converted instead, so a page is
 * never silently reduced to nothing.
 */
export function extract(html: string, url: string): { title: string | null; markdown: string } {
  const dom = new JSDOM(html, { url });
  const { document } = dom.window;
  const documentTitle = document.title.trim() || null;

  // Readability mutates the document it is given, so it gets a clone and the
  // fallback path still sees the original markup.
  const article = new Readability(document.cloneNode(true) as Document).parse();
  const fragment = article?.content ?? document.body.innerHTML;

  return {
    title: article?.title?.trim() || documentTitle,
    markdown: turndown().turndown(fragment),
  };
}

/** sha256 over exact bytes, with no normalization applied. */
export function rawHash(source: Uint8Array | string): string {
  return createHash('sha256')
    .update(typeof source === 'string' ? Buffer.from(source, 'utf8') : source)
    .digest('hex');
}

/** sha256 over canonical markdown. Only meaningful on `normalize` output. */
export function contentHash(canonicalMarkdown: string): string {
  return createHash('sha256').update(canonicalMarkdown, 'utf8').digest('hex');
}

export interface CanonicalizeInput {
  /** Exact bytes as received. Strings are treated as their UTF-8 encoding. */
  readonly source: Uint8Array | string;
  readonly url: string;
  /** Defaults to HTML; markdown sources skip extraction and normalize directly. */
  readonly format?: SourceFormat;
}

export function canonicalize(input: CanonicalizeInput): CanonicalizeResult {
  const { source, url, format = 'html' } = input;
  const raw = rawHash(source);
  const text = typeof source === 'string' ? source : new TextDecoder('utf-8').decode(source);

  const extracted =
    format === 'markdown' ? { title: null, markdown: text } : extract(text, url);
  const markdown = normalize(extracted.markdown);

  // Measured on the canonical markdown rather than the extracted HTML, so the
  // threshold means the same thing to a third-party verifier.
  if (markdown.trim().length < MIN_CONTENT_CHARS) {
    return { skipped: true, reason: 'thin', rawHash: raw };
  }

  return {
    skipped: false,
    title: extracted.title,
    markdown,
    contentHash: contentHash(markdown),
    rawHash: raw,
    protocol: PROTOCOL,
    protocolVersion: PROTOCOL_VERSION,
  };
}
