import { describe, expect, it, vi } from "vitest";

import { createDecisionService } from "@/modules/decisions/application/service";

const organizationId = "11111111-1111-4111-8111-111111111111";
const decisionCycleId = "22222222-2222-4222-8222-222222222222";
const opportunityId = "33333333-3333-4333-8333-333333333333";

describe("DecisionService", () => {
  it("persists an action selection and emits only safe identifier events", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn().mockResolvedValue(undefined);
    const service = createDecisionService({
      workerStore: { persist, promoteArtifact: vi.fn(), startCycle: vi.fn() },
      events: { publish },
    });

    await service.record({
      record: selectedRecord(),
      candidates: [selectedCandidate()],
      opportunity: selectedOpportunity(),
    });

    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        record: expect.objectContaining({ organizationId, opportunityId }),
      }),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "opportunity.proposed",
        organizationId,
        payload: { opportunityId, decisionCycleId },
      }),
    );
  });

  it("records needs_data without an opportunity and routes it to readiness", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn().mockResolvedValue(undefined);
    const service = createDecisionService({
      workerStore: { persist, promoteArtifact: vi.fn(), startCycle: vi.fn() },
      events: { publish },
    });

    await service.record({
      record: {
        decisionCycleId,
        organizationId,
        correlationId: "44444444-4444-4444-8444-444444444444",
        outcome: "needs_data",
        reason: "economics_ledger_indicative",
        selectedCandidateFingerprint: null,
        opportunityId: null,
        rejectionHistogram: {},
        screenedCount: 0,
        scoredCount: 0,
        inputsDigest: "b".repeat(64),
        versionTuple: tuple(),
        propensity: 1,
        isExploration: false,
      },
      candidates: [],
      opportunity: null,
    });

    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({ record: expect.objectContaining({ opportunityId: null }) }),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "decision.needs_data_identified" }),
    );
  });
});

function tuple() {
  return {
    policyVersionId: "55555555-5555-4555-8555-555555555555",
    playbookVersionId: "66666666-6666-4666-8666-666666666666",
    confidenceCalibrationId: "77777777-7777-4777-8777-777777777777",
    rankingWeightsId: "88888888-8888-4888-8888-888888888888",
  };
}

function selectedRecord() {
  return {
    decisionCycleId,
    organizationId,
    correlationId: "44444444-4444-4444-8444-444444444444",
    outcome: "action_selected" as const,
    reason: null,
    selectedCandidateFingerprint: "a".repeat(64),
    opportunityId,
    rejectionHistogram: { stale_inputs: 2 },
    screenedCount: 4,
    scoredCount: 1,
    inputsDigest: "b".repeat(64),
    versionTuple: tuple(),
    propensity: 1 as const,
    isExploration: false as const,
  };
}

function selectedOpportunity() {
  return {
    id: opportunityId,
    title: "Improve listing",
    summary: "Test",
    hypothesis: "Test",
    playbookVersionId: tuple().playbookVersionId,
    candidateFingerprint: "a".repeat(64),
    subjectKind: "branch",
    subjectRef: "branch-1",
    evidenceBundle: { sourceIds: ["metric-1"] },
    assumptions: [],
    impactLowMinor: 100,
    impactHighMinor: 200,
    confidence: 0.5,
    confidenceRationale: "baseline",
    evidenceTier: "computed" as const,
    executionCostMinor: 0,
    expectedContributionMinor: 75,
    currency: "AED",
    timeToImpactDays: 7,
    riskTier: 1 as const,
    approvalPath: "human_approval" as const,
    guardrails: [],
    assertions: [{ key: "freshness", expectedOutcome: "pass" }],
    evaluationPlan: { primaryMetricKey: "contribution.gross_profit" },
    expiresAt: "2026-09-01T00:00:00.000Z",
    status: "proposed" as const,
  };
}

function selectedCandidate() {
  return {
    playbookVersionId: tuple().playbookVersionId,
    candidateFingerprint: "a".repeat(64),
    subjectKind: "branch",
    subjectRef: "branch-1",
    parameterDigest: "c".repeat(64),
    impactLowMinor: 100,
    impactHighMinor: 200,
    confidence: 0.5,
    executionCostMinor: 0,
    expectedContributionMinor: 75,
    currency: "AED",
    evidenceTier: "computed" as const,
    eligibilityResult: { eligible: true },
    policyResult: { admitted: true },
    rejectionReason: null,
    rank: 1,
  };
}
