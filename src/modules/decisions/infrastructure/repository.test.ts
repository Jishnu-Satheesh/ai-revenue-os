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
});
