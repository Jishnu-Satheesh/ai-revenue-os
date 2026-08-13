import { describe, expect, it, vi } from "vitest";

import { createDecisionRepository } from "@/modules/decisions/infrastructure/repository";

describe("DecisionRepository", () => {
  it("scopes opportunity reads to the requested organization", async () => {
    const eq = vi.fn().mockResolvedValue({ data: [], error: null });
    const order = vi.fn(() => ({ eq }));
    const select = vi.fn(() => ({ order }));
    const from = vi.fn(() => ({ select }));
    const repository = createDecisionRepository({ from, rpc: vi.fn() });

    await repository.listOpportunities("11111111-1111-4111-8111-111111111111");

    expect(from).toHaveBeenCalledWith("opportunities");
    expect(eq).toHaveBeenCalledWith("organization_id", "11111111-1111-4111-8111-111111111111");
  });

  it("uses the feedback RPC rather than a direct table write", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "feedback-id", error: null });
    const repository = createDecisionRepository({ from: vi.fn(), rpc });

    await repository.appendFeedback({
      organizationId: "11111111-1111-4111-8111-111111111111",
      opportunityId: "22222222-2222-4222-8222-222222222222",
      feedbackKind: "rejected",
      reason: "Not appropriate this month",
      editDiff: null,
      correlationId: "33333333-3333-4333-8333-333333333333",
    });

    expect(rpc).toHaveBeenCalledWith(
      "append_decision_feedback",
      expect.objectContaining({ target_organization_id: "11111111-1111-4111-8111-111111111111" }),
    );
  });

  it("maps manual artifact promotion to the strict worker RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "promotion-id", error: null });
    const repository = createDecisionRepository({ from: vi.fn(), rpc });

    const result = await repository.promoteArtifact({
      organizationId: "11111111-1111-4111-8111-111111111111",
      artifactKey: "ranking_weights",
      artifactVersionId: "22222222-2222-4222-8222-222222222222",
      expectedCurrentArtifactVersionId: "33333333-3333-4333-8333-333333333333",
      promotedBy: "manual-review",
    });

    expect(result).toBe("promotion-id");
    expect(rpc).toHaveBeenCalledWith("promote_decision_artifact", {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      input_promotion: {
        organization_id: "11111111-1111-4111-8111-111111111111",
        artifact_key: "ranking_weights",
        artifact_version_id: "22222222-2222-4222-8222-222222222222",
        expected_current_artifact_version_id: "33333333-3333-4333-8333-333333333333",
        promoted_by: "manual-review",
      },
    });
  });

  it("maps a bounded cycle input to the existing snake-case worker contract", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "cycle-id", error: null });
    const repository = createDecisionRepository({ from: vi.fn(), rpc });

    const result = await repository.startCycle({
      id: "44444444-4444-4444-8444-444444444444",
      organizationId: "11111111-1111-4111-8111-111111111111",
      triggerName: "  scheduled evaluation  ",
      correlationId: "55555555-5555-4555-8555-555555555555",
      slotBudget: 10,
      maxScoredCandidates: 500,
    });

    expect(result).toBe("cycle-id");
    expect(rpc).toHaveBeenCalledWith("start_decision_cycle", {
      target_organization_id: "11111111-1111-4111-8111-111111111111",
      input_cycle: {
        id: "44444444-4444-4444-8444-444444444444",
        organization_id: "11111111-1111-4111-8111-111111111111",
        trigger_name: "scheduled evaluation",
        correlation_id: "55555555-5555-4555-8555-555555555555",
        slot_budget: 10,
        max_scored_candidates: 500,
      },
    });
  });
});
