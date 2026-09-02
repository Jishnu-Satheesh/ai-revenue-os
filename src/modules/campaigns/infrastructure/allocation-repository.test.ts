import { describe, expect, it, vi } from "vitest";

import {
  createAllocationRepository,
  type AllocationPersistence,
} from "@/modules/campaigns/infrastructure/allocation-repository";

function makePersistence(overrides: Partial<AllocationPersistence> = {}) {
  const rpc = vi.fn();
  return {
    persistence: { rpc, ...overrides } as unknown as AllocationPersistence,
    rpc,
  };
}

describe("createAllocationRepository", () => {
  it("maps candidate rows onto typed diagnostics, coercing numeric strings", async () => {
    const { persistence, rpc } = makePersistence();
    rpc.mockResolvedValueOnce({
      data: [
        {
          variant_id: "11111111-1111-4111-8111-111111111111",
          channel: "instagram",
          impressions: 500,
          clicks: "20",
          spend_minor: "1200",
        },
        {
          variant_id: "22222222-2222-4222-8222-222222222222",
          channel: "facebook",
          impressions: null,
          clicks: null,
          spend_minor: null,
        },
      ],
      error: null,
    });

    const repo = createAllocationRepository(persistence);
    const candidates = await repo.listCandidates("org1", "c1");

    expect(rpc).toHaveBeenCalledWith("read_campaign_allocation_candidates", {
      target_organization_id: "org1",
      campaign_id: "c1",
    });
    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toEqual({
      variantId: "11111111-1111-4111-8111-111111111111",
      channel: "instagram",
      diagnostics: { impressions: 500, clicks: 20, spendMinor: 1200 },
    });
    // Absence maps to null, never zero.
    expect(candidates[1].diagnostics).toEqual({
      impressions: null,
      clicks: null,
      spendMinor: null,
    });
  });

  it("resolves a graded margin and returns null for an insufficient grade", async () => {
    const { persistence, rpc } = makePersistence();
    rpc.mockResolvedValueOnce({
      data: {
        contribution_margin_minor: "8400",
        resolved_margin_grade: "measured",
        currency: "AED",
      },
      error: null,
    });
    const repo = createAllocationRepository(persistence);
    await expect(repo.resolveMargin("org1", "instagram")).resolves.toEqual({
      contributionMarginMinor: 8400,
      qualityTier: "measured",
      currency: "AED",
    });

    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(repo.resolveMargin("org1", "facebook")).resolves.toBeNull();
  });

  it("appends a ledger row with the margin value resolved only for the margin rule", async () => {
    const { persistence, rpc } = makePersistence();
    rpc.mockResolvedValueOnce({ data: "event-id", error: null });
    const repo = createAllocationRepository(persistence);

    await repo.appendLedgerRow({
      organizationId: "org1",
      campaignId: "c1",
      cycleId: "cycle1",
      actor: "agent",
      at: "2026-08-19T12:00:00.000Z",
      decision: {
        variantId: "v1",
        ruleKey: "margin.contribution_floor",
        ruleVersion: "v1",
        observedValue: 4200,
        threshold: 5000,
        resolvedMarginGrade: "measured",
        action: "pause",
        reasonCode: "margin_below_floor",
      },
    });

    const args = rpc.mock.calls[0][1];
    expect(args.target_organization_id).toBe("org1");
    expect(args.input_event).toMatchObject({
      resolved_margin_minor: 4200,
      resolved_margin_grade: "measured",
      action: "pause",
      actor: "agent",
    });

    // A non-margin rule never carries a margin value or grade.
    rpc.mockResolvedValueOnce({ data: "event-id", error: null });
    await repo.appendLedgerRow({
      organizationId: "org1",
      campaignId: "c1",
      cycleId: "cycle1",
      actor: "agent",
      at: "2026-08-19T12:00:00.000Z",
      decision: {
        variantId: "v1",
        ruleKey: "diagnostic.spend_ceiling",
        ruleVersion: "v1",
        observedValue: 5000,
        threshold: 10000,
        resolvedMarginGrade: null,
        action: "no_action",
        reasonCode: "no_threshold_breached",
      },
    });
    expect(rpc.mock.calls[1][1].input_event).toMatchObject({
      resolved_margin_minor: null,
      resolved_margin_grade: null,
    });
  });

  it("maps pause and resume outcomes", async () => {
    const { persistence, rpc } = makePersistence();
    const repo = createAllocationRepository(persistence);

    rpc.mockResolvedValueOnce({ data: { outcome: "paused" }, error: null });
    await expect(repo.pauseVariant("org1", "v1", "spend_ceiling_exceeded")).resolves.toEqual({
      outcome: "paused",
    });
    expect(rpc).toHaveBeenCalledWith("pause_campaign_variant", {
      target_organization_id: "org1",
      input_pause: {
        organization_id: "org1",
        variant_id: "v1",
        reason_code: "spend_ceiling_exceeded",
      },
    });

    rpc.mockResolvedValueOnce({ data: { outcome: "resumed" }, error: null });
    await expect(repo.resumeVariant("org1", "v1")).resolves.toEqual({ outcome: "resumed" });
    expect(rpc).toHaveBeenCalledWith("resume_campaign_variant", {
      target_organization_id: "org1",
      input_resume: { organization_id: "org1", variant_id: "v1" },
    });
  });
});
