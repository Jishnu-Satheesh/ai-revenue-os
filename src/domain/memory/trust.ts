import {
  memoryOrigins,
  sourceTiers,
  verificationStates,
  type MemoryOrigin,
  type MemoryType,
  type SourceTier,
  type TrustRank,
  type VerificationState,
} from "@/domain/memory/types";

export { memoryOrigins, sourceTiers, verificationStates };

export type SourceTierInput = {
  origin: MemoryOrigin;
  verificationState: VerificationState;
  memoryType: MemoryType;
  reviewDueAt?: string;
  now?: Date;
};

/**
 * Derives the precedence rank from `context/09-business-memory.md`. The order
 * of these checks is the rule, not an implementation detail, so the branches
 * read top to bottom in decreasing authority:
 *
 * 1. Human confirmation outranks everything, including how the item was
 *    produced. A model proposal a person verified is verified knowledge.
 * 2. Unconfirmed model output is inference no matter what it describes, so it
 *    is checked before the document and provider branches. Otherwise a
 *    model-authored document would be promoted to "approved document".
 * 3. Direct user input is tier 1 even before confirmation, because the source
 *    is still a person stating something about their own business.
 * 4. A document is an approved document.
 * 5. Provider data is current system-of-record data until its review date
 *    passes, after which it is historical.
 *
 * A caller never supplies this value; it is always derived.
 */
export function deriveSourceTier(input: SourceTierInput): SourceTier {
  if (input.verificationState === "verified") return 1;
  if (input.origin === "ai_proposed" || input.origin === "outcome_learned") return 5;
  if (input.origin === "user_verified") return 1;
  if (input.memoryType === "document") return 3;
  if (input.origin === "provider_imported") {
    return isPastReviewDate(input.reviewDueAt, input.now) ? 4 : 2;
  }
  return 2;
}

function isPastReviewDate(reviewDueAt: string | undefined, now: Date | undefined): boolean {
  if (!reviewDueAt) return false;
  const dueAt = Date.parse(reviewDueAt);
  if (!Number.isFinite(dueAt)) return false;
  return dueAt < (now ?? new Date()).getTime();
}

export type TrustRankInput = {
  verificationState: VerificationState;
  sourceTier: SourceTier;
};

/**
 * The single ordering key. Retrieval sorts by this first and by relevance only
 * inside a rank, which is what makes "verified facts rank above inferences" a
 * structural guarantee rather than a weight-tuning accident.
 *
 * `proposed` and `rejected` items take the lowest rank as a second line of
 * defence. They are already excluded from retrieval, but if an exclusion is
 * ever missed they must not be able to outrank real knowledge.
 */
export function deriveTrustRank(input: TrustRankInput): TrustRank {
  if (input.verificationState === "proposed" || input.verificationState === "rejected") return 4;

  if (input.verificationState === "verified") {
    return input.sourceTier === 1 ? 0 : 1;
  }

  switch (input.sourceTier) {
    case 1:
      return 1;
    case 2:
      return 2;
    case 3:
    case 4:
      return 3;
    default:
      return 4;
  }
}

export type RankableMemoryResult = {
  id: string;
  trustRank: TrustRank;
  blended: number;
  observedAt?: string;
};

/**
 * Total ordering: trust rank ascending, then blended relevance descending, then
 * recency, then id. The final id comparison exists so two otherwise identical
 * results always sort the same way, which keeps cached rankings and fresh
 * rankings byte-identical.
 */
export function compareByTrustThenRelevance(
  left: RankableMemoryResult,
  right: RankableMemoryResult,
): number {
  if (left.trustRank !== right.trustRank) return left.trustRank - right.trustRank;
  if (left.blended !== right.blended) return right.blended - left.blended;

  const leftObservedAt = toTimestamp(left.observedAt);
  const rightObservedAt = toTimestamp(right.observedAt);
  if (leftObservedAt !== rightObservedAt) return rightObservedAt - leftObservedAt;

  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function toTimestamp(value: string | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}
