import type { MemoryRetrievalResult } from "@/domain/memory/schemas";
import { compareByTrustThenRelevance } from "@/domain/memory/trust";

/**
 * The only tunable numbers in retrieval. They are constants rather than
 * configuration because trust ordering must not depend on them: the comparator
 * sorts by trust rank first, so a weight change can reorder results inside a
 * rank and never across one. `src/domain/memory/trust.test.ts` asserts that.
 */
export const LEXICAL_WEIGHT = 0.5;
export const SEMANTIC_WEIGHT = 0.5;

export function blendScores(input: { lexical: number; semantic: number }): number {
  return LEXICAL_WEIGHT * input.lexical + SEMANTIC_WEIGHT * input.semantic;
}

/**
 * Merges results that came from different backing stores — memory rows ranked
 * by Postgres and structured facts projected from the digital twin — into one
 * ordering. Sorting happens here rather than in SQL because projected facts
 * never reach the search function.
 */
export function rankResults(
  results: readonly MemoryRetrievalResult[],
  limit: number,
): MemoryRetrievalResult[] {
  return [...results]
    .sort((left, right) =>
      compareByTrustThenRelevance(
        {
          id: left.itemId ?? left.provenance.sourceReference ?? left.title,
          trustRank: left.trustRank,
          blended: left.scores.blended,
          observedAt: left.observedAt,
        },
        {
          id: right.itemId ?? right.provenance.sourceReference ?? right.title,
          trustRank: right.trustRank,
          blended: right.scores.blended,
          observedAt: right.observedAt,
        },
      ),
    )
    .slice(0, limit);
}
