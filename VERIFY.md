# Verifying a Wuzzy attestation

Every document Wuzzy indexes is attested onchain with a hash, not with its content. This
document is the prose twin of the executable spec in
[contracts/canonicalize-v1.feature](contracts/canonicalize-v1.feature) and the conformance
vectors in [fixtures/canonicalize-v1/](fixtures/canonicalize-v1/). It exists so that a third
party can write an independent verifier without reading our source.

> **Status: draft, pending review.** The procedure below matches the reference
> implementation as of this commit, and the vectors were generated from it. Nothing here is
> frozen until the first mainnet attestation lands. See "Freezing" at the end.

## What is attested

An attestation carries the URL, the protocol identifier `wuzzy/crawl`, the protocol version,
the fetch time, and two hashes:

- **`rawHash`** — sha256 over the exact bytes the origin served, with no normalization of any
  kind. It commits to the transfer.
- **`contentHash`** — sha256 over the canonical markdown produced by the procedure below. It
  commits to the readable content, and it is stable across changes that do not alter that
  content, such as line endings or trailing whitespace.

The content itself never goes onchain.

## The canonicalization procedure, version 1

Given the bytes of a fetched resource and the URL it was fetched from:

1. **Decode** the bytes as UTF-8.
2. **Extract**, for HTML sources only. Parse with jsdom using the fetch URL as the document
   URL, then run Mozilla Readability over a clone of the document. Use the extracted
   article's HTML. If Readability returns no article, use the document's `<body>` innerHTML
   instead, so that a page is never reduced to nothing.
   Markdown sources skip this step entirely and go straight to step 4.
3. **Convert to markdown** with Turndown, configured as:
   - `headingStyle: 'atx'`
   - `codeBlockStyle: 'fenced'`
   - `bulletListMarker: '-'`
   - `emDelimiter: '*'`
4. **Normalize**, in this order:
   1. Unicode NFC.
   2. `\r\n` and lone `\r` to `\n`.
   3. Strip trailing spaces and tabs from every line.
   4. Collapse runs of three or more newlines to exactly two.
   5. Trim leading and trailing whitespace from the whole document. This also removes a
      leading byte order mark.
   6. Append exactly one trailing `\n`.
5. **Reject thin pages.** If the canonical markdown has fewer than 80 characters after
   trimming, the page is skipped: no hash is computed, no document row is written, and no
   attestation is produced.
6. **Hash.** `contentHash` is the hex sha256 of the canonical markdown, encoded UTF-8.

Order matters and is part of the protocol. NFC runs before the whitespace passes because
composition can change which characters sit at the end of a line.

The procedure is idempotent: normalizing canonical markdown again returns it byte for byte,
so a verifier can re-derive the hash from published canonical output alone.

## Consequences worth knowing

These follow from the procedure above rather than from any separate rule, and they are
permanent for version 1:

- **Code fences carry no language for HTML sources.** Readability strips the
  `class="language-*"` attribute before Turndown sees it, so an HTML-sourced fence opens with
  a bare ` ``` `. Markdown sources keep their language tag, because they skip extraction.
- **The `<h1>` usually disappears from HTML sources.** Readability treats it as the article
  title and removes it from the body, so canonical markdown typically begins at the first
  `<h2>`. The title is kept separately as document metadata. Pages that go through the
  Readability fallback keep their `<h1>`, since the raw body is converted directly.
- **Bullets are `-` followed by three spaces**, with four spaces per nesting level, and
  ordered items are `1.` followed by two spaces. This is Turndown's layout under the options
  above.
- **Line endings do not affect `contentHash`.** The same document served with CRLF and with
  LF produces one content hash and two different raw hashes.

## Checking a vector yourself

```sh
bun scripts/generate-canonicalize-vectors.ts   # regenerates .md and .hash from the inputs
bun test apps/backend/src/canonicalize         # checks the committed vectors still reproduce
```

The input files in `fixtures/canonicalize-v1/` are authored by hand and are the spec. The
`.md` and `.hash` files are generated output, reviewed once and then frozen as regression
vectors.

## Freezing

Once the first attestation lands on Base mainnet, this document,
`contracts/canonicalize-v1.feature`, its fixtures, and the `v1` module are immutable. A
change in behaviour after that point is protocol version 2, implemented in a new module
beside `v1`, with its own feature file and its own vectors. Version 1 stays callable
indefinitely, because attestations that reference it have to stay verifiable.
