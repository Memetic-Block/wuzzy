import { DEFAULT_B, DEFAULT_K1 } from './lexical';
import { DEFAULT_RRF_K } from './fusion';

export type SearchMode = 'hybrid' | 'vector' | 'lexical';

export interface SearchConfig {
  readonly mode: SearchMode;
  readonly rrfK: number;
  readonly k1: number;
  readonly b: number;
  /** Candidates each arm contributes before fusion. */
  readonly candidates: number;
}

export const SEARCH_CONFIG = Symbol('SEARCH_CONFIG');

const MODES: SearchMode[] = ['hybrid', 'vector', 'lexical'];

export function buildSearchConfig(
  env: Record<string, string | undefined> = process.env,
): SearchConfig {
  const mode = env.SEARCH_MODE as SearchMode | undefined;
  return {
    mode: mode && MODES.includes(mode) ? mode : 'hybrid',
    rrfK: Number(env.SEARCH_RRF_K ?? DEFAULT_RRF_K),
    k1: Number(env.SEARCH_BM25_K1 ?? DEFAULT_K1),
    b: Number(env.SEARCH_BM25_B ?? DEFAULT_B),
    // Deeper than topK so fusion has something to reorder: a document ranked
    // 30th lexically and 3rd by vector should be able to surface.
    candidates: Number(env.SEARCH_CANDIDATES ?? 50),
  };
}
