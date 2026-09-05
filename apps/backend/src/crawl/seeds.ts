import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const SEEDS_FILE = join(import.meta.dir, '../../../../seeds.json');

interface SeedEntry {
  readonly url: string;
  readonly note?: string;
}

/**
 * The curated seed list. Kept as data rather than a flag default so that what
 * the index is built from is reviewable in the repository, and so a crawl is
 * reproducible without remembering a command line.
 */
export async function readSeeds(path = SEEDS_FILE): Promise<string[]> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as { seeds?: SeedEntry[] };
  const seeds = (parsed.seeds ?? []).map((entry) => entry.url).filter(Boolean);
  if (seeds.length === 0) throw new Error(`${path} lists no seeds`);
  return seeds;
}
