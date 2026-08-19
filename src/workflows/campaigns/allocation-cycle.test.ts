import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { AllocationDecision } from "@/domain/campaigns/allocation";
import {
  runAllocationCycle,
  type AllocationCycleDependencies,
} from "@/workflows/campaigns/allocation-cycle";

function pauseDecision(variantId: string): AllocationDecision {
  return {
    variantId,
    ruleKey: "diagnostic.spend_ceiling",
    ruleVersion: "v1",
    observedValue: 12_000,
    threshold: 10_000,
    resolvedMarginGrade: null,
    action: "pause",
    reasonCode: "spend_ceiling_exceeded",
  };
}

function deps(overrides: Partial<AllocationCycleDependencies> = {}) {
  const listActiveCampaigns = vi.fn(async () => ["c1", "c2"]);
  const evaluateCampaign = vi.fn(async ({ campaignId }: { campaignId: string }) => ({
    campaignId,
    decisions:
      campaignId === "c1"
        ? [
            pauseDecision("v1"),
            {
              ...pauseDecision("v1"),
              action: "no_action" as const,
              reasonCode: "no_threshold_breached",
            },
          ]
        : [],
    pauses: campaignId === "c1" ? [pauseDecision("v1")] : [],
  }));
  const pause = vi.fn(async () => {});
  const emitCycleCompleted = vi.fn(async () => {});

  const built: AllocationCycleDependencies = {
    listActiveCampaigns,
    evaluateCampaign,
    pause,
    emitCycleCompleted,
    isCancelled: () => false,
    ...overrides,
  };
  return { built, listActiveCampaigns, evaluateCampaign, pause, emitCycleCompleted };
}

describe("runAllocationCycle", () => {
  it("runs per organization and decides each campaign independently", async () => {
    const { built, listActiveCampaigns, evaluateCampaign } = deps();
    const result = await runAllocationCycle(
      { organizationId: "org1", cycleId: "cycle1" },
      built,
      new AbortController().signal,
    );

    expect(listActiveCampaigns).toHaveBeenCalledWith({ organizationId: "org1" });
    expect(evaluateCampaign).toHaveBeenCalledTimes(2);
    expect(evaluateCampaign).toHaveBeenNthCalledWith(1, {
      organizationId: "org1",
      campaignId: "c1",
      cycleId: "cycle1",
    });
    expect(evaluateCampaign).toHaveBeenNthCalledWith(2, {
      organizationId: "org1",
      campaignId: "c2",
      cycleId: "cycle1",
    });
    expect(result.campaignCount).toBe(2);
  });

  it("routes every pause decision through the pause port with its own variant", async () => {
    const { built, pause } = deps();
    await runAllocationCycle(
      { organizationId: "org1", cycleId: "cycle1" },
      built,
      new AbortController().signal,
    );

    expect(pause).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledWith({
      organizationId: "org1",
      campaignId: "c1",
      variantId: "v1",
      decision: expect.objectContaining({ action: "pause", reasonCode: "spend_ceiling_exceeded" }),
    });
  });

  it("emits a cycle-completed event with counts", async () => {
    const { built, emitCycleCompleted } = deps();
    await runAllocationCycle(
      { organizationId: "org1", cycleId: "cycle1" },
      built,
      new AbortController().signal,
    );

    expect(emitCycleCompleted).toHaveBeenCalledWith({
      organizationId: "org1",
      cycleId: "cycle1",
      campaignCount: 2,
      decisionCount: 2,
      pauseCount: 1,
    });
  });

  it("stops at the cancellation fence and does not proceed to later campaigns", async () => {
    const evaluateCampaign = vi.fn(async () => ({ campaignId: "x", decisions: [], pauses: [] }));
    const { built } = deps({ evaluateCampaign, isCancelled: () => true });
    const result = await runAllocationCycle(
      { organizationId: "org1", cycleId: "cycle1" },
      built,
      new AbortController().signal,
    );
    expect(evaluateCampaign).not.toHaveBeenCalled();
    expect(result.decisionCount).toBe(0);
  });

  it("keeps no cross-campaign state: a decision in one campaign cannot change the next", async () => {
    const { built } = deps({
      evaluateCampaign: vi.fn(async ({ campaignId }) => ({
        campaignId,
        // Each campaign is evaluated from its own input alone; the loop passes
        // no previous campaign's result into the next.
        decisions: campaignId === "c1" ? [pauseDecision("v1")] : [],
        pauses: campaignId === "c1" ? [pauseDecision("v1")] : [],
      })),
    });
    const result = await runAllocationCycle(
      { organizationId: "org1", cycleId: "cycle1" },
      built,
      new AbortController().signal,
    );
    expect(result.campaigns.map((entry) => entry.campaignId)).toEqual(["c1", "c2"]);
    expect(result.campaigns[1].pauses).toBe(0);
  });
});

/**
 * The wall, asserted at the source level.
 *
 * The allocation loop may not write to the evidence loop's records. The
 * strongest test available before `campaign_outcomes` exists (Task 21) is to
 * prove that no allocation source file even names the tables it is forbidden
 * to touch, so no future edit can silently grow a write path without failing
 * here first.
 */
describe("the allocation loop wall", () => {
  const sources = [
    "src/domain/campaigns/allocation.ts",
    "src/modules/campaigns/application/allocation-service.ts",
    "src/modules/campaigns/infrastructure/allocation-repository.ts",
    "src/workflows/campaigns/allocation-cycle.ts",
  ];

  it.each(sources)("never references an evidence-loop table in %s", (file) => {
    const text = readFileSync(resolve(process.cwd(), file), "utf8");
    expect(text).not.toMatch(/campaign_exposures/);
    expect(text).not.toMatch(/campaign_metric_observations/);
    expect(text).not.toMatch(/campaign_outcomes/);
  });
});
