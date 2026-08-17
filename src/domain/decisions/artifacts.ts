import type { CompletenessGrade } from "@/domain/economics/types";

export const RANKING_IMPLEMENTATION_KEY = "decision.ranking.evidence_value_time_v1" as const;
export const CONFIDENCE_IMPLEMENTATION_KEY = "decision.confidence.computed_baseline_v1" as const;

type RankableCandidate = {
  evidenceTier: "computed" | "observed" | "prior";
  expectedContributionMinor: number;
  timeToImpactDays: number;
  candidateFingerprint: string;
};

type ConfidenceInput = {
  evidenceTier: "computed" | "observed" | "prior";
  completenessGrade: CompletenessGrade;
  inputAgeMinutes: number;
  freshnessBoundMinutes: number;
};

const evidenceTierOrder = { computed: 0, observed: 1, prior: 2 } as const;

const rankingImplementation = Object.freeze({
  implementationKey: RANKING_IMPLEMENTATION_KEY,
  rank<T extends RankableCandidate>(candidates: readonly T[]): readonly T[] {
    return [...candidates].sort(
      (left, right) =>
        evidenceTierOrder[left.evidenceTier] - evidenceTierOrder[right.evidenceTier] ||
        right.expectedContributionMinor - left.expectedContributionMinor ||
        left.timeToImpactDays - right.timeToImpactDays ||
        left.candidateFingerprint.localeCompare(right.candidateFingerprint),
    );
  },
});

const confidenceImplementation = Object.freeze({
  implementationKey: CONFIDENCE_IMPLEMENTATION_KEY,
  compute(input: ConfidenceInput): { confidence: number; rationaleCode: string } {
    if (input.evidenceTier !== "computed") {
      throw new Error("decision_evidence_tier_unsupported");
    }
    if (
      input.freshnessBoundMinutes <= 0 ||
      input.inputAgeMinutes < 0 ||
      input.inputAgeMinutes > input.freshnessBoundMinutes
    ) {
      throw new Error("decision_evidence_stale");
    }
    if (input.completenessGrade === "indicative") {
      throw new Error("decision_evidence_completeness_unsupported");
    }

    const aging = input.inputAgeMinutes > input.freshnessBoundMinutes / 2;
    const baseline = input.completenessGrade === "complete" ? 0.75 : 0.55;
    return {
      confidence: Number((baseline - (aging ? 0.1 : 0)).toFixed(2)),
      rationaleCode: `computed_${input.completenessGrade}_${aging ? "aging" : "fresh"}`,
    };
  },
});

export function resolveRankingImplementation(implementationKey: string) {
  if (implementationKey !== RANKING_IMPLEMENTATION_KEY) {
    throw new Error("decision_artifact_implementation_unknown");
  }
  return rankingImplementation;
}

export function resolveConfidenceImplementation(implementationKey: string) {
  if (implementationKey !== CONFIDENCE_IMPLEMENTATION_KEY) {
    throw new Error("decision_artifact_implementation_unknown");
  }
  return confidenceImplementation;
}
