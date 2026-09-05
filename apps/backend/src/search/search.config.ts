import { DEFAULT_B, DEFAULT_K1 } from './lexical';
import { DEFAULT_RRF_K } from './fusion';

export type SearchMode = 'hybrid' | 'vector' | 'lexical';

export interface SearchConfig {
  readonly mode: SearchMode;
  readonly rrfK: number;
  readonly k1: number;
  readonly b: number;
  /**
   * How deep each arm goes, per query. Fixed, and deliberately independent of
   * which page is being served: deepening an arm changes which arms contribute
   * to a chunk's fused score, so a depth that grew with the offset would
   * reorder earlier pages under the reader. This is the retrieval window, and
   * paging is bounded by the documents it yields.
   */
  readonly candidates: number;
  /**
   * Scoped chunk count at or below which the vector arm scans exhaustively
   * instead of using the approximate index. See SearchService.vectorSearch.
   */
  readonly exactScanChunks: number;
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
    // 30th lexically and 3rd by vector should be able to surface. Deep enough,
    // too, that there are several pages to walk before the window runs out.
    candidates: Number(env.SEARCH_CANDIDATES ?? 200),
    // Well above the index page cap and below the size at which a sequential
    // scan of embeddings stops being cheap.
    exactScanChunks: Number(env.SEARCH_EXACT_SCAN_CHUNKS ?? 20000),
  };
}
