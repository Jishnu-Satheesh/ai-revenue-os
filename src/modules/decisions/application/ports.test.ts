import { describe, expect, it } from "vitest";

import {
  artifactPromotionInputSchema,
  decisionAggregateSchema,
  decisionCycleInputSchema,
} from "@/modules/decisions/application/ports";

const organizationId = "11111111-1111-4111-8111-111111111111";
const decisionCycleId = "22222222-2222-4222-8222-222222222222";
const opportunityId = "33333333-3333-4333-8333-333333333333";
const policyVersionId = "44444444-4444-4444-8444-444444444444";
const playbookVersionId = "55555555-5555-4555-8555-555555555555";
const confidenceCalibrationId = "66666666-6666-4666-8666-666666666666";
const rankingWeightsId = "77777777-7777-4777-8777-777777777777";
const selectedFingerprint = "a".repeat(64);

describe("decision aggregate", () => {
  it("accepts one selected candidate and its matching opportunity", () => {
    expect(decisionAggregateSchema.parse(selectedAggregate()).record.opportunityId).toBe(
      opportunityId,
    );
  });

  it("rejects unknown candidate and opportunity fields at the worker boundary", () => {
    const aggregate = selectedAggregate();

    expect(() =>
      decisionAggregateSchema.parse({
        ...aggregate,
        candidates: [{ ...aggregate.candidates[0], modelScore: 0.99 }],
      }),
    ).toThrow();
    expect(() =>
      decisionAggregateSchema.parse({
        ...aggregate,
        opportunity: { ...aggregate.opportunity, providerPayload: { secret: true } },
      }),
    ).toThrow();
  });

  it("requires candidate cardinality, selected fingerprint, and opportunity id to agree", () => {
    const aggregate = selectedAggregate();

    expect(() => decisionAggregateSchema.parse({ ...aggregate, candidates: [] })).toThrow();
    expect(() =>
      decisionAggregateSchema.parse({
        ...aggregate,
        record: { ...aggregate.record, selectedCandidateFingerprint: "b".repeat(64) },
      }),
    ).toThrow();
    expect(() =>
      decisionAggregateSchema.parse({
        ...aggregate,
        opportunity: {
          ...aggregate.opportunity,
          id: "88888888-8888-4888-8888-888888888888",
        },
      }),
    ).toThrow();
  });

  it("persists no opportunity for no_action and needs_data outcomes", () => {
    const aggregate = selectedAggregate();

    for (const outcome of ["no_action", "needs_data"] as const) {
      expect(() =>
        decisionAggregateSchema.parse({
          ...aggregate,
          record: {
            ...aggregate.record,
            outcome,
            reason: "candidate_did_not_clear",
            selectedCandidateFingerprint: null,
            opportunityId: null,
          },
        }),
      ).toThrow();
    }
  });

  it("allows pre-playbook needs_data only when no candidate was scored", () => {
    const aggregate = selectedAggregate();
    const { playbookVersionId: _playbookVersionId, ...prePlaybookTuple } =
      aggregate.record.versionTuple;
    const record = {
      ...aggregate.record,
      outcome: "needs_data" as const,
      reason: "economics_configured",
      selectedCandidateFingerprint: null,
      opportunityId: null,
      screenedCount: 0,
      scoredCount: 0,
      versionTuple: prePlaybookTuple,
    };

    expect(
      decisionAggregateSchema.parse({ record, candidates: [], opportunity: null }).record.outcome,
    ).toBe("needs_data");
    expect(() =>
      decisionAggregateSchema.parse({
        record: { ...record, screenedCount: 1, scoredCount: 1 },
        candidates: aggregate.candidates,
        opportunity: null,
      }),
    ).toThrow();
  });
});

describe("decision worker controls", () => {
  it("accepts a bounded artifact promotion and rejects unknown or null input", () => {
    const input = {
      organizationId,
      artifactKey: "ranking_weights" as const,
      artifactVersionId: rankingWeightsId,
      expectedCurrentArtifactVersionId: confidenceCalibrationId,
      promotedBy: "manual-review",
    };

    expect(artifactPromotionInputSchema.parse(input)).toEqual(input);
    expect(() => artifactPromotionInputSchema.parse({ ...input, optimizerScore: 0.9 })).toThrow();
    expect(() =>
      artifactPromotionInputSchema.parse({ ...input, expectedCurrentArtifactVersionId: null }),
    ).toThrow();
  });

  it("normalizes a strict bounded cycle input and rejects null or operationally unsafe values", () => {
    const input = {
      organizationId,
      triggerName: "  scheduled evaluation  ",
      correlationId: "99999999-9999-4999-8999-999999999999",
      slotBudget: 10,
      maxScoredCandidates: 500,
    };

    expect(decisionCycleInputSchema.parse(input).triggerName).toBe("scheduled evaluation");
    expect(() => decisionCycleInputSchema.parse({ ...input, id: null })).toThrow();
    expect(() => decisionCycleInputSchema.parse({ ...input, unexpected: true })).toThrow();
    expect(() => decisionCycleInputSchema.parse({ ...input, slotBudget: 101 })).toThrow();
    expect(() => decisionCycleInputSchema.parse({ ...input, maxScoredCandidates: 501 })).toThrow();
  });
});

function selectedAggregate() {
  const candidate = {
    playbookVersionId,
    candidateFingerprint: selectedFingerprint,
    subjectKind: "branch",
    subjectRef: "branch-1",
    parameterDigest: "b".repeat(64),
    impactLowMinor: 100,
    impactHighMinor: 200,
    confidence: 0.5,
    executionCostMinor: 25,
    expectedContributionMinor: 50,
    currency: "AED",
    evidenceTier: "computed" as const,
    eligibilityResult: { eligible: true },
    policyResult: { admitted: true },
    rejectionReason: null,
    rank: 1,
  };

  return {
    record: {
      decisionCycleId,
      organizationId,
      correlationId: "99999999-9999-4999-8999-999999999999",
      outcome: "action_selected" as const,
      reason: null,
      selectedCandidateFingerprint: selectedFingerprint,
      opportunityId,
      rejectionHistogram: { stale_inputs: 2 },
      screenedCount: 1,
      scoredCount: 1,
      inputsDigest: "c".repeat(64),
      versionTuple: {
        policyVersionId,
        playbookVersionId,
        confidenceCalibrationId,
        rankingWeightsId,
      },
      propensity: 1 as const,
      isExploration: false as const,
    },
    candidates: [candidate],
    opportunity: {
      id: opportunityId,
      title: "Improve listing",
      summary: "Refresh the listing with measured creative.",
      hypothesis: "A stronger listing increases qualified demand.",
      playbookVersionId,
      candidateFingerprint: selectedFingerprint,
      subjectKind: candidate.subjectKind,
      subjectRef: candidate.subjectRef,
      evidenceBundle: { sourceIds: ["metric-1"] },
      assumptions: ["Inventory remains available"],
      impactLowMinor: candidate.impactLowMinor,
      impactHighMinor: candidate.impactHighMinor,
      confidence: candidate.confidence,
      confidenceRationale: "Seeded deterministic calibration",
      evidenceTier: candidate.evidenceTier,
      executionCostMinor: candidate.executionCostMinor,
      expectedContributionMinor: candidate.expectedContributionMinor,
      currency: candidate.currency,
      timeToImpactDays: 7,
      riskTier: 1 as const,
      approvalPath: "human_approval" as const,
      guardrails: [{ key: "spend.total", threshold: 450_000 }],
      assertions: [{ key: "budget_available", expectedOutcome: "pass" }],
      evaluationPlan: { primaryMetricKey: "contribution.gross_profit" },
      expiresAt: "2026-09-01T00:00:00.000Z",
      status: "proposed" as const,
    },
  };
}
