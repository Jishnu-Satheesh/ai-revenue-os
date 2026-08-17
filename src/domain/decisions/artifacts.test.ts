import { describe, expect, it } from "vitest";

import {
  CONFIDENCE_IMPLEMENTATION_KEY,
  RANKING_IMPLEMENTATION_KEY,
  resolveConfidenceImplementation,
  resolveRankingImplementation,
} from "@/domain/decisions/artifacts";

describe("deterministic Decision artifact implementations", () => {
  it("resolves only the two approved implementation keys", () => {
    expect(resolveRankingImplementation(RANKING_IMPLEMENTATION_KEY).implementationKey).toBe(
      "decision.ranking.evidence_value_time_v1",
    );
    expect(resolveConfidenceImplementation(CONFIDENCE_IMPLEMENTATION_KEY).implementationKey).toBe(
      "decision.confidence.computed_baseline_v1",
    );
    expect(() => resolveRankingImplementation("decision.ranking.unknown_v1")).toThrow(
      /decision_artifact_implementation_unknown/,
    );
    expect(() => resolveConfidenceImplementation("decision.confidence.unknown_v1")).toThrow(
      /decision_artifact_implementation_unknown/,
    );
  });

  it.each([
    ["complete", 0, 0.75, "computed_complete_fresh"],
    ["partial", 720, 0.55, "computed_partial_fresh"],
    ["complete", 721, 0.65, "computed_complete_aging"],
    ["partial", 1_440, 0.45, "computed_partial_aging"],
  ] as const)(
    "maps %s computed evidence at age %i to the approved confidence",
    (completenessGrade, inputAgeMinutes, confidence, rationaleCode) => {
      expect(
        resolveConfidenceImplementation(CONFIDENCE_IMPLEMENTATION_KEY).compute({
          evidenceTier: "computed",
          completenessGrade,
          inputAgeMinutes,
          freshnessBoundMinutes: 1_440,
        }),
      ).toEqual({ confidence, rationaleCode });
    },
  );

  it("screens evidence beyond the freshness bound instead of scoring it", () => {
    expect(() =>
      resolveConfidenceImplementation(CONFIDENCE_IMPLEMENTATION_KEY).compute({
        evidenceTier: "computed",
        completenessGrade: "complete",
        inputAgeMinutes: 1_441,
        freshnessBoundMinutes: 1_440,
      }),
    ).toThrow(/decision_evidence_stale/);
  });

  it("rejects observed and prior evidence until their approved sources exist", () => {
    for (const evidenceTier of ["observed", "prior"] as const) {
      expect(() =>
        resolveConfidenceImplementation(CONFIDENCE_IMPLEMENTATION_KEY).compute({
          evidenceTier,
          completenessGrade: "complete",
          inputAgeMinutes: 0,
          freshnessBoundMinutes: 1_440,
        }),
      ).toThrow(/decision_evidence_tier_unsupported/);
    }
  });
});
