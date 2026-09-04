/**
 * Regenerates the expected outputs for fixtures/canonicalize-v1/ from the
 * reference implementation.
 *   bun scripts/generate-canonicalize-vectors.ts
 *
 * Inputs are authored by hand and are the spec; the .md and .hash files are
 * generated, human-reviewed, then frozen as regression vectors. Once the first
 * mainnet attestation lands this script must not change any existing output —
 * if it does, the change is protocol v2, not a fix.
 */
import { join } from 'node:path';
import { canonicalize } from '../apps/backend/src/canonicalize/v1';
import {
  CONFORMANCE_VECTORS,
  FIXTURES_DIR,
  formatOf,
  fixtureUrl,
} from '../apps/backend/src/canonicalize/v1/fixtures';

for (const vector of CONFORMANCE_VECTORS) {
  const source = new Uint8Array(await Bun.file(join(FIXTURES_DIR, vector.input)).arrayBuffer());
  const result = canonicalize({
    source,
    url: fixtureUrl(vector.input),
    format: formatOf(vector.input),
  });

  if (result.skipped) {
    console.error(`${vector.input}: canonicalizer skipped it (${result.reason})`);
    process.exit(1);
  }

  await Bun.write(join(FIXTURES_DIR, vector.md), result.markdown);
  await Bun.write(join(FIXTURES_DIR, vector.hash), `${result.contentHash}\n`);
  console.log(`${vector.input.padEnd(26)} -> ${result.contentHash}  (${result.markdown.length} chars)`);
}
