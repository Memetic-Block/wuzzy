/**
 * wuzzy/crawl canonicalization, protocol version 1, experimental.
 *
 * This module is the pinned public procedure that every EAS attestation with
 * protocolVersion=1 refers to. Third parties build independent verifiers
 * against it, so its output is a protocol artifact, not an implementation
 * detail: identical input bytes must produce an identical content hash on any
 * machine, forever.
 *
 * While the protocol identifier carries `-experimental` this procedure may
 * still change: it is a demo-stage artifact and nothing has been promised to
 * anyone. Dropping that suffix is the moment it freezes, and from then on no
 * change to observable behaviour belongs in this directory — a behaviour
 * change is protocol v2 in a new module, and v1 stays callable indefinitely so
 * old attestations remain verifiable.
 *
 * Nothing outside this module computes a content or raw hash.
 */
import { Readability } from '@mozilla/readability';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';

/**
 * The protocol identifier every attestation carries.
 *
 * `-experimental` says this procedure makes no permanence promise yet: it may
 * change without becoming version 2, and nobody should build a verifier
 * against it expecting stability. The label lives here rather than in
 * `PROTOCOL_VERSION` because that field is a `uint8` in the EAS schema and
 * cannot hold text.
 *
 * An attestation is identified by the PAIR (protocol, protocolVersion), never
 * by the version alone: a future stable `wuzzy/crawl` v1 is a different
 * procedure from `wuzzy/crawl-experimental` v1, and a verifier that keyed on
 * the number would run the wrong one. Dropping the suffix is itself the
 * announcement that the procedure has frozen.
 */
export const PROTOCOL = 'wuzzy/crawl-experimental';
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
 * Elements whose text is never content, whatever the page looks like.
 *
 * `<noscript>` is deliberately absent: for a crawler that does not execute
 * scripts, its contents are the page's own answer to "what should someone
 * without JavaScript read", which is exactly our position.
 */
const NEVER_CONTENT = 'script, style, template';

/**
 * Removes code and comments from a document before anything reads it.
 *
 * Readability strips these itself when it succeeds, so this only shows on the
 * fallback path — which is precisely where it matters. A client-rendered shell
 * gives Readability nothing to extract, the whole body is converted instead,
 * and an inline theme-switcher becomes the page's entire indexed content and
 * gets hashed and attested as such. Observed on docs.attest.org.
 */
function stripNonContent(document: Document): void {
  for (const element of document.querySelectorAll(NEVER_CONTENT)) element.remove();

  // Comments carry build output, editor notes and commented-out markup. None
  // of it is content, and all of it moves the hash when a site's tooling changes.
  const walker = document.createTreeWalker(document, 128 /* NodeFilter.SHOW_COMMENT */);
  const comments: ChildNode[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode as ChildNode);
  for (const comment of comments) comment.remove();
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

  // Before either path reads it, so Readability and the fallback agree on what
  // the page even contains.
  stripNonContent(document);

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
