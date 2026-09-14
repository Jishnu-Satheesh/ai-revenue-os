import { describe, expect, it, vi } from "vitest";

import { repairCampaignEvidence } from "@/modules/campaigns/application/evidence-repair";

function ports(overrides: Partial<Parameters<typeof repairCampaignEvidence>[1]> = {}) {
  return {
    saveBrandVoice: vi.fn(async () => {}),
    createGoal: vi.fn(async () => {}),
    refreshSnapshot: vi.fn(async () => ({ sourceSnapshotId: "snap-2", refreshed: true })),
    ...overrides,
  };
}

const goal = {
  name: "Grow gross revenue",
  metricKey: "revenue.gross",
  baselineStatus: "known" as const,
  baselineValue: 42_000,
  targetValue: 60_000,
  unit: "AED",
  currency: "AED",
};

describe("repairCampaignEvidence", () => {
  it("writes the supplied details and then pins the newer evidence", async () => {
    const port = ports();

    const result = await repairCampaignEvidence(
      { brandVoice: ["warm", "direct"], goal },
      port,
    );

    expect(port.saveBrandVoice).toHaveBeenCalledWith("Warm, Direct");
    expect(port.createGoal).toHaveBeenCalledWith(goal);
    expect(result).toEqual({
      brandVoiceSaved: true,
      goalCreated: true,
      evidenceRefreshed: true,
      sourceSnapshotId: "snap-2",
    });
  });

  it("refreshes after writing, never before", async () => {
    const order: string[] = [];
    const port = ports({
      saveBrandVoice: vi.fn(async () => {
        order.push("voice");
      }),
      createGoal: vi.fn(async () => {
        order.push("goal");
      }),
      refreshSnapshot: vi.fn(async () => {
        order.push("refresh");
        return { sourceSnapshotId: "snap-2", refreshed: true };
      }),
    });

    await repairCampaignEvidence({ brandVoice: ["warm"], goal }, port);

    // Refreshing first would pin a snapshot taken before the repair, which is
    // the exact failure this whole path exists to end.
    expect(order).toEqual(["voice", "goal", "refresh"]);
  });

  it("says plainly when the repair changed nothing", async () => {
    const port = ports({
      refreshSnapshot: vi.fn(async () => ({ sourceSnapshotId: "snap-1", refreshed: false })),
    });

    const result = await repairCampaignEvidence({ brandVoice: ["warm"] }, port);

    // Reporting a refresh that did not happen would send somebody to press
    // "Generate again" for a run that must fail identically.
    expect(result.evidenceRefreshed).toBe(false);
    expect(result.sourceSnapshotId).toBe("snap-1");
  });

  it("touches only what was supplied", async () => {
    const port = ports();

    const result = await repairCampaignEvidence({ goal }, port);

    expect(port.saveBrandVoice).not.toHaveBeenCalled();
    expect(result.brandVoiceSaved).toBe(false);
    expect(result.goalCreated).toBe(true);
  });

  it("still re-pins when the request supplies nothing itself", async () => {
    const port = ports();

    // Someone may have fixed the organization elsewhere — in onboarding, or in
    // another tab. Refusing to look would strand the campaign on stale
    // evidence for a repair that has already happened.
    const result = await repairCampaignEvidence({}, port);

    expect(port.refreshSnapshot).toHaveBeenCalled();
    expect(result.evidenceRefreshed).toBe(true);
  });

  it("does not pin new evidence when a write failed", async () => {
    const port = ports({
      createGoal: vi.fn(async () => {
        throw new Error("goal rejected");
      }),
    });

    await expect(repairCampaignEvidence({ goal }, port)).rejects.toThrow("goal rejected");

    // A snapshot pinned after a partial write would record evidence the
    // operator never actually supplied.
    expect(port.refreshSnapshot).not.toHaveBeenCalled();
  });

  it("ignores a brand voice that names no traits", async () => {
    const port = ports();

    const result = await repairCampaignEvidence({ brandVoice: ["  ", ""] }, port);

    expect(port.saveBrandVoice).not.toHaveBeenCalled();
    expect(result.brandVoiceSaved).toBe(false);
  });
});
