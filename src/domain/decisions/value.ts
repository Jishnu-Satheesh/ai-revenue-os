import { DecisionError } from "@/domain/decisions/errors";
import type { CompletenessGrade } from "@/domain/economics/types";

/**
 * The only ranking quantity, per ADR 0014 and `specs/005` section 5.4.
 *
 * `strategic_fit`, `risk_penalty`, and `opportunity_delay_penalty` are
 * deliberately absent: goal alignment is a screening predicate, risk is a gate
 * that selects an approval path, and time to impact is a displayed field and an
 * intra-tier tie-break. Nothing about risk may move a number.
 */
export type EvidenceTier = "computed" | "observed" | "prior";

/** Ranking is by tier first. Values from different tiers are never compared. */
const TIER_ORDER: Readonly<Record<EvidenceTier, number>> = {
  computed: 0,
  observed: 1,
  prior: 2,
};

export type ScoredCandidate = {
  candidateFingerprint: string;
  evidenceTier: EvidenceTier;
  impactLowMinor: number;
  impactHighMinor: number;
  executionCostMinor: number;
  currency: string;
  confidence: number;
  timeToImpactDays: number;
};

function assertMinor(value: number, field: string): void {
  if (!Number.isInteger(value)) {
    throw new DecisionError(
      "DECISION_IMPACT_RANGE_INVALID",
      `${field} must be an integer in minor units.`,
    );
  }
}

/**
 * `round(impact_point_minor * confidence) - execution_cost_minor`.
 *
 * Both bounds are always stored; the midpoint exists to sort and is never
 * displayed without its range. The result may be negative, which is a real
 * answer about a costly action rather than something to clamp away.
 */
export function expectedContributionMinor(candidate: ScoredCandidate): number {
  assertMinor(candidate.impactLowMinor, "impactLowMinor");
  assertMinor(candidate.impactHighMinor, "impactHighMinor");
  assertMinor(candidate.executionCostMinor, "executionCostMinor");

  if (candidate.impactHighMinor < candidate.impactLowMinor) {
    throw new DecisionError(
      "DECISION_IMPACT_RANGE_INVALID",
      "The impact range is inverted; a range nobody authored cannot be sorted.",
    );
  }

  if (
    !Number.isFinite(candidate.confidence) ||
    candidate.confidence < 0 ||
    candidate.confidence > 1
  ) {
    throw new DecisionError(
      "DECISION_CONFIDENCE_OUT_OF_RANGE",
      "Confidence must be between 0 and 1 inclusive.",
    );
  }

  const midpoint = (candidate.impactLowMinor + candidate.impactHighMinor) / 2;
  return Math.round(midpoint * candidate.confidence) - candidate.executionCostMinor;
}

/**
 * `indicative` maps to no tier: it is `needs_data`, matching
 * `specs/012` section 4.4. It never falls back to a `prior` estimate.
 */
export function evidenceTierForCompleteness(grade: CompletenessGrade): EvidenceTier | null {
  return grade === "indicative" ? null : "computed";
}

/**
 * Total order: tier, then expected contribution descending, then time to impact
 * ascending, then fingerprint. The final key exists so re-running a cycle with
 * identical inputs produces an identical feed rather than an arbitrary one.
 */
export function compareCandidates(left: ScoredCandidate, right: ScoredCandidate): number {
  const byTier = TIER_ORDER[left.evidenceTier] - TIER_ORDER[right.evidenceTier];
  if (byTier !== 0) return byTier;

  const byValue = expectedContributionMinor(right) - expectedContributionMinor(left);
  if (byValue !== 0) return byValue;

  const byTime = left.timeToImpactDays - right.timeToImpactDays;
  if (byTime !== 0) return byTime;

  return left.candidateFingerprint < right.candidateFingerprint
    ? -1
    : left.candidateFingerprint > right.candidateFingerprint
      ? 1
      : 0;
}

export function rankCandidates<T extends ScoredCandidate>(candidates: readonly T[]): readonly T[] {
  const currencies = new Set(candidates.map(({ currency }) => currency));
  if (currencies.size > 1) {
    // A candidate set spanning currencies is a defect, not a conversion.
    throw new DecisionError(
      "DECISION_CURRENCY_MISMATCH",
      "Candidates span more than one currency; no implicit conversion is performed.",
    );
  }

  return [...candidates].sort(compareCandidates);
}
