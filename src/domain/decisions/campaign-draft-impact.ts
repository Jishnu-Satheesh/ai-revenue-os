import { DecisionError } from "@/domain/decisions/errors";
import { expectedContributionMinor } from "@/domain/decisions/value";

/**
 * The deterministic impact method for a governed Campaign draft (spec 022
 * section 10.1). Every number arrives governed: the range from current
 * business evidence, the confidence and its basis from the detector that
 * authored them, the cost from configured policy. The method validates,
 * carries, and sorts — it never estimates, never converts, and never fills a
 * missing basis with its own words, because a rationale nobody authored is a
 * promise nobody can keep.
 */

export type DraftImpactInput = {
  impactLowMinor: number;
  impactHighMinor: number;
  executionCostMinor: number;
  currency: string;
  /** Declared by the authoring detector, 0 to 1 inclusive. Never derived here. */
  confidence: number;
  /** Why that confidence, in the author's words. Empty refuses. */
  confidenceBasis: string;
  evidenceTier: "computed" | "observed" | "prior";
  timeToImpactDays: number;
  /** At least one stated assumption; the operator saw these exact words. */
  assumptions: readonly string[];
  /** Governed revisions the range rests on; empty refuses. */
  sourceRevisionIds: readonly string[];
  observedAt: Date | null;
};

export type DraftImpact = {
  outcome: "supported";
  impactLowMinor: number;
  impactHighMinor: number;
  executionCostMinor: number;
  currency: string;
  confidence: number;
  /** The carried basis, prefixed with the tier so the tier is never separated. */
  confidenceRationale: string;
  evidenceTier: "computed" | "observed" | "prior";
  timeToImpactDays: number;
  assumptions: readonly string[];
  sourceRevisionIds: readonly string[];
  observedAt: Date;
  expectedContributionMinor: number;
};

function assertMinor(value: number, field: string): void {
  if (!Number.isInteger(value)) {
    throw new DecisionError(
      "DECISION_IMPACT_RANGE_INVALID",
      `${field} must be an integer in minor units.`,
    );
  }
}

export function qualifyDraftImpact(input: DraftImpactInput): DraftImpact {
  assertMinor(input.impactLowMinor, "impactLowMinor");
  assertMinor(input.impactHighMinor, "impactHighMinor");
  assertMinor(input.executionCostMinor, "executionCostMinor");

  if (input.impactHighMinor < input.impactLowMinor) {
    throw new DecisionError(
      "DECISION_IMPACT_RANGE_INVALID",
      "The impact range is inverted; a range nobody authored cannot be drafted.",
    );
  }
  if (!/^[A-Z]{3}$/.test(input.currency)) {
    throw new DecisionError(
      "DECISION_CURRENCY_MISMATCH",
      "Currency must be an ISO code; no implicit conversion is performed.",
    );
  }
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw new DecisionError(
      "DECISION_CONFIDENCE_OUT_OF_RANGE",
      "Confidence must be between 0 and 1 inclusive.",
    );
  }
  if (input.confidenceBasis.trim().length === 0) {
    throw new DecisionError(
      "DECISION_CONFIDENCE_OUT_OF_RANGE",
      "Confidence without a stated basis is a guess, not an input.",
    );
  }
  if (input.sourceRevisionIds.length === 0) {
    throw new DecisionError(
      "DECISION_IMPACT_RANGE_INVALID",
      "A range resting on no governed revision cannot be drafted.",
    );
  }
  if (input.observedAt === null) {
    throw new DecisionError(
      "DECISION_IMPACT_RANGE_INVALID",
      "A range with no observation date cannot be drafted.",
    );
  }
  if (
    input.assumptions.length === 0 ||
    input.assumptions.some((line) => line.trim().length === 0)
  ) {
    throw new DecisionError(
      "DECISION_IMPACT_RANGE_INVALID",
      "A draft without stated assumptions hides what the operator agreed to.",
    );
  }
  if (!Number.isInteger(input.timeToImpactDays) || input.timeToImpactDays < 0) {
    throw new DecisionError(
      "DECISION_IMPACT_RANGE_INVALID",
      "Time to impact must be a non-negative whole number of days.",
    );
  }

  return {
    outcome: "supported",
    impactLowMinor: input.impactLowMinor,
    impactHighMinor: input.impactHighMinor,
    executionCostMinor: input.executionCostMinor,
    currency: input.currency,
    confidence: input.confidence,
    confidenceRationale: `${input.evidenceTier} tier: ${input.confidenceBasis.trim()}`,
    evidenceTier: input.evidenceTier,
    timeToImpactDays: input.timeToImpactDays,
    assumptions: input.assumptions,
    sourceRevisionIds: input.sourceRevisionIds,
    observedAt: input.observedAt,
    // The one deterministic method, shared with scoring: midpoint times
    // confidence, minus cost. Never displayed without its range.
    expectedContributionMinor: expectedContributionMinor({
      candidateFingerprint: "0".repeat(64),
      evidenceTier: input.evidenceTier,
      impactLowMinor: input.impactLowMinor,
      impactHighMinor: input.impactHighMinor,
      executionCostMinor: input.executionCostMinor,
      currency: input.currency,
      confidence: input.confidence,
      timeToImpactDays: input.timeToImpactDays,
    }),
  };
}
