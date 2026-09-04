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

  function readRepository(rows: unknown[]) {
    const eq = vi.fn().mockResolvedValue({ data: rows, error: null });
    const order = vi.fn(() => ({ eq }));
    const select = vi.fn(() => ({ order }));
    const from = vi.fn(() => ({ select }));
    return createDecisionRepository({ from, rpc: vi.fn() });
  }

  function storedRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "22222222-2222-4222-8222-222222222222",
      organization_id: "11111111-1111-4111-8111-111111111111",
      decision_record_id: "33333333-3333-4333-8333-333333333333",
      playbook_version_id: "44444444-4444-4444-8444-444444444444",
      action_key: "campaign.meta_bundle_v1",
      created_at: "2026-08-01T10:00:00.000Z",
      title: "Run a governed Meta campaign",
      summary: "A bounded recommendation with a registered measurement plan.",
      evidence_tier: "computed",
      impact_low_minor: 600_000,
      impact_high_minor: 900_000,
      execution_cost_minor: 450_000,
      expected_contribution_minor: 112_500,
      currency: "AED",
      time_to_impact_days: 7,
      status: "proposed",
      expires_at: "2026-08-22T10:00:00.000Z",
      ...overrides,
    };
  }

  it("returns the stored action key and creation time on the opportunity read", async () => {
    const repository = readRepository([storedRow()]);

    const [item] = await repository.listOpportunities("11111111-1111-4111-8111-111111111111");

    expect(item!.actionKey).toBe("campaign.meta_bundle_v1");
    expect(item!.createdAt).toBe("2026-08-01T10:00:00.000Z");
  });

  it("refuses a row without a stored action key instead of substituting a default", async () => {
    const repository = readRepository([storedRow({ action_key: null })]);

    await expect(
      repository.listOpportunities("11111111-1111-4111-8111-111111111111"),
    ).rejects.toThrow(/could not be loaded/);
  });

  it("refuses a malformed stored action key", async () => {
    const repository = readRepository([storedRow({ action_key: "NOT A KEY" })]);

    await expect(
      repository.listOpportunities("11111111-1111-4111-8111-111111111111"),
    ).rejects.toThrow(/could not be loaded/);
  });

  it("does not expose the unfenced cycle-start or aggregate-write paths", () => {
    const rpc = vi.fn();
    const repository = createDecisionRepository({ from: vi.fn(), rpc });

    expect("startCycle" in repository).toBe(false);
    expect("persist" in repository).toBe(false);
  });
});
