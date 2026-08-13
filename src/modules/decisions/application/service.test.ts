import { describe, expect, it, vi } from "vitest";

import { createDecisionService } from "@/modules/decisions/application/service";

const organizationId = "11111111-1111-4111-8111-111111111111";
const decisionCycleId = "22222222-2222-4222-8222-222222222222";
const opportunityId = "33333333-3333-4333-8333-333333333333";

describe("DecisionService", () => {
  it("persists an action selection and emits only safe identifier events", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn().mockResolvedValue(undefined);
    const service = createDecisionService({ workerStore: { persist }, events: { publish } });

    await service.record({
      decisionCycleId,
      organizationId,
      correlationId: "44444444-4444-4444-8444-444444444444",
      outcome: "action_selected",
      reason: null,
      selectedCandidateFingerprint: "a".repeat(64),
      opportunityId,
      rejectionHistogram: { stale_inputs: 2 },
      screenedCount: 4,
      scoredCount: 2,
      inputsDigest: "b".repeat(64),
      artifactVersions: { confidence_calibration: "seed-v1" },
      propensity: 1,
      isExploration: false,
    });

    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ organizationId, opportunityId }));
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
    const service = createDecisionService({ workerStore: { persist }, events: { publish } });

    await service.record({
      decisionCycleId,
      organizationId,
      correlationId: "44444444-4444-4444-8444-444444444444",
      outcome: "needs_data",
      reason: "economics_ledger_indicative",
      selectedCandidateFingerprint: null,
      opportunityId: null,
      rejectionHistogram: {},
      screenedCount: 1,
      scoredCount: 1,
      inputsDigest: "b".repeat(64),
      artifactVersions: { confidence_calibration: "seed-v1" },
      propensity: 1,
      isExploration: false,
    });

    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ opportunityId: null }));
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "decision.needs_data_identified" }),
    );
  });
});
