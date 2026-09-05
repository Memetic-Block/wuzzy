/**
 * Reciprocal Rank Fusion.
 *
 *   score(d) = SUM over arms of  weight / (k + rank(d))
 *
 * Rank-based rather than score-based on purpose: BM25 is an unbounded sum over
 * query terms and cosine similarity is bounded in [-1, 1], so the two cannot be
 * added or averaged without inventing a normalisation that changes meaning as
 * the corpus grows. RRF only needs each arm's ordering, which makes the fusion
 * stable no matter how either arm is scaled or tuned.
 *
 * k damps the contribution of top ranks so a single arm cannot dominate on its
 * own confidence; 60 is the value from the original RRF paper and the common
 * default.
 */
export const DEFAULT_RRF_K = 60;

export interface RankedArm<T> {
  readonly items: readonly T[];
  readonly weight?: number;
}

export interface FusedItem<K> {
  readonly key: K;
  readonly score: number;
  /** 1-based rank in each arm that returned it, for explaining a result. */
  readonly ranks: Record<string, number>;
}

export function reciprocalRankFusion<T, K extends string>(
  arms: Record<string, RankedArm<T>>,
  keyOf: (item: T) => K,
  options: { k?: number } = {},
): FusedItem<K>[] {
  const k = options.k ?? DEFAULT_RRF_K;
  const fused = new Map<K, { score: number; ranks: Record<string, number> }>();

  for (const [armName, arm] of Object.entries(arms)) {
    const weight = arm.weight ?? 1;
    for (const [index, item] of arm.items.entries()) {
      const key = keyOf(item);
      const rank = index + 1;
      const existing = fused.get(key) ?? { score: 0, ranks: {} };
      existing.score += weight / (k + rank);
      existing.ranks[armName] = rank;
      fused.set(key, existing);
    }
  }

  return [...fused.entries()]
    .map(([key, value]) => ({ key, score: value.score, ranks: value.ranks }))
    .sort((a, b) => b.score - a.score);
}
