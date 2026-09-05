/**
 * Splits canonical markdown into embeddable chunks.
 *
 * Chunking is not part of the pinned protocol: it affects search quality, not
 * any hash, so it can change without a protocol version bump. Splits land on
 * markdown headings first and paragraph boundaries second, so a chunk is a
 * coherent passage rather than an arbitrary window, and each chunk carries the
 * heading trail above it so an isolated passage still says what it is about.
 */
export interface Chunk {
  readonly ordinal: number;
  readonly text: string;
}

export interface ChunkOptions {
  /** Soft ceiling; a single paragraph longer than this is split on whitespace. */
  readonly maxChars?: number;
  /** Trailing characters of the previous chunk repeated into the next. */
  readonly overlapChars?: number;
  /**
   * The document's title, prepended as the root heading of every chunk.
   *
   * Readability lifts the `<h1>` out of the body and into the title, so a page
   * frequently never states its own name in the text that gets indexed: on a
   * sample of docs.base.org that was true of nearly half the corpus. Without
   * this, searching for a page by its own name cannot match it, lexically or
   * semantically.
   */
  readonly title?: string | null;
}

const DEFAULT_MAX_CHARS = 1_800;
const DEFAULT_OVERLAP_CHARS = 200;

const HEADING = /^(#{1,6})\s+(.*)$/;

export function chunk(markdown: string, options: ChunkOptions = {}): Chunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlapChars = options.overlapChars ?? DEFAULT_OVERLAP_CHARS;

  const root = options.title?.trim() ? `# ${options.title.trim()}` : '';
  const sections = splitByHeading(markdown);
  const texts: string[] = [];

  for (const section of sections) {
    const trail = [root, section.trail].filter((part) => part !== '').join('\n');
    for (const piece of packParagraphs(section.body, maxChars - trail.length, overlapChars)) {
      texts.push(trail === '' ? piece : `${trail}\n\n${piece}`);
    }
  }

  return texts
    .map((text) => text.trim())
    .filter((text) => text !== '')
    .map((text, ordinal) => ({ ordinal, text }));
}

interface Section {
  /** The heading path above this body, e.g. "# Deploy\n## Prerequisites". */
  readonly trail: string;
  readonly body: string;
}

function splitByHeading(markdown: string): Section[] {
  const sections: Section[] = [];
  const path: { level: number; text: string }[] = [];
  let body: string[] = [];

  const flush = () => {
    const text = body.join('\n').trim();
    if (text !== '') {
      sections.push({ trail: path.map((h) => `${'#'.repeat(h.level)} ${h.text}`).join('\n'), body: text });
    }
    body = [];
  };

  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (line.trimStart().startsWith('```')) inFence = !inFence;

    const heading = inFence ? null : HEADING.exec(line);
    if (heading?.[1] && heading[2] !== undefined) {
      flush();
      const level = heading[1].length;
      while (path.length > 0 && path[path.length - 1]!.level >= level) path.pop();
      path.push({ level, text: heading[2].trim() });
      continue;
    }
    body.push(line);
  }
  flush();

  return sections;
}

/** Greedily fills chunks with whole paragraphs, splitting one only if it alone overflows. */
function packParagraphs(body: string, budget: number, overlapChars: number): string[] {
  const limit = Math.max(budget, 400);
  const paragraphs = body.split(/\n{2,}/).filter((p) => p.trim() !== '');
  const chunks: string[] = [];
  let current = '';

  const push = () => {
    if (current.trim() === '') return;
    chunks.push(current.trim());
    current = overlapChars > 0 ? current.slice(-overlapChars) : '';
  };

  for (const paragraph of paragraphs) {
    for (const piece of paragraph.length > limit ? hardSplit(paragraph, limit) : [paragraph]) {
      if (current !== '' && current.length + piece.length + 2 > limit) push();
      current = current === '' ? piece : `${current}\n\n${piece}`;
    }
  }
  if (current.trim() !== '') chunks.push(current.trim());

  return chunks;
}

/** Last resort for a paragraph with no internal blank lines, e.g. a long code block. */
function hardSplit(paragraph: string, limit: number): string[] {
  const pieces: string[] = [];
  let rest = paragraph;
  while (rest.length > limit) {
    const cut = rest.lastIndexOf('\n', limit);
    const at = cut > limit / 2 ? cut : rest.lastIndexOf(' ', limit);
    const index = at > limit / 2 ? at : limit;
    pieces.push(rest.slice(0, index));
    rest = rest.slice(index).trimStart();
  }
  if (rest !== '') pieces.push(rest);
  return pieces;
}
