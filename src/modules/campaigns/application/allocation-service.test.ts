import { describe, expect, it, vi } from "vitest";

import type { AllocationRuleThresholds, ResolvedMargin } from "@/domain/campaigns/allocation";
import {
  evaluateCampaign,
  type AllocationLedgerRow,
  type AllocationServiceDependencies,
} from "@/modules/campaigns/application/allocation-service";

const thresholds: AllocationRuleThresholds = {
  spendCeilingMinor: 10_000,
  ctrFloor: 0.02,
  marginFloorMinor: 5_000,
  minimumImpressions: 100,
};

function deps(overrides: Partial<AllocationServiceDependencies> = {}) {
  const readVariants = vi.fn<AllocationServiceDependencies["readVariants"]>(async () => [
    {
      variantId: "v1",
      channel: "instagram",
      diagnostics: { impressions: 500, clicks: 20, spendMinor: 5_000 },
    },
    {
      variantId: "v2",
      channel: "instagram",
      diagnostics: { impressions: 500, clicks: 2, spendMinor: 5_000 },
    },
  ]);
  const resolveMargin = vi.fn<AllocationServiceDependencies["resolveMargin"]>(async () => ({
    contributionMarginMinor: 8_000,
    qualityTier: "measured",
    currency: "AED",
  }));
  const appendLedger = vi.fn<AllocationServiceDependencies["appendLedger"]>(async () => {});

  const built: AllocationServiceDependencies = {
    readVariants,
    resolveMargin,
    appendLedger,
    thresholds,
    now: () => new Date("2026-08-19T12:00:00.000Z"),
    ...overrides,
  };
  return { built, readVariants, resolveMargin, appendLedger };
}

describe("evaluateCampaign", () => {
  it("appends a ledger row per decision, including no_action, and returns pauses", async () => {
    const { built, appendLedger } = deps();
    const result = await evaluateCampaign(
      { organizationId: "org1", campaignId: "c1", cycleId: "cycle1" },
      built,
    );

    // Two variants × three rules = six decisions.
    expect(result.decisions).toHaveLength(6);
    expect(appendLedger).toHaveBeenCalledTimes(6);

    // v2 has a CTR of 2/500 = 0.004, below the floor → one pause.
    expect(result.pauses).toHaveLength(1);
    expect(result.pauses[0]).toMatchObject({ variantId: "v2", reasonCode: "ctr_below_floor" });

    // A no_action decision is still appended with its reason.
    const noActionRows = appendLedger.mock.calls
      .map(([row]) => row)
      .filter((row: AllocationLedgerRow) => row.decision.action === "no_action");
    expect(noActionRows.length).toBeGreaterThan(0);
    expect(noActionRows.every((row) => row.actor === "agent")).toBe(true);
  });

  it("resolves the margin once per channel, not once per variant", async () => {
    const { built, resolveMargin } = deps();
    await evaluateCampaign({ organizationId: "org1", campaignId: "c1", cycleId: "cycle1" }, built);
    // Both variants are instagram, so the margin is fetched a single time.
    expect(resolveMargin).toHaveBeenCalledTimes(1);
    expect(resolveMargin).toHaveBeenCalledWith({ organizationId: "org1", channel: "instagram" });
  });

  it("reads only the single campaign it is asked to evaluate", async () => {
    const { built, readVariants } = deps();
    await evaluateCampaign({ organizationId: "org1", campaignId: "c1", cycleId: "cycle1" }, built);
    expect(readVariants).toHaveBeenCalledTimes(1);
    expect(readVariants).toHaveBeenCalledWith({ organizationId: "org1", campaignId: "c1" });
  });

  it("never lets a variant's outcome depend on another variant", async () => {
    const { built } = deps({
      readVariants: async () => [
        {
          variantId: "quiet",
          channel: "instagram",
          diagnostics: { impressions: 3, clicks: 0, spendMinor: 100 },
        },
      ],
      resolveMargin: async () => ({
        contributionMarginMinor: 8_000,
        qualityTier: "measured",
        currency: "AED",
      }),
    });
    const result = await evaluateCampaign(
      { organizationId: "org1", campaignId: "c1", cycleId: "cycle1" },
      built,
    );
    // The only variant is below the exposure floor on the ratio rule, within the
    // spend ceiling, and above the margin floor — so nothing pauses.
    expect(result.pauses).toEqual([]);
    expect(result.decisions.every((entry) => entry.variantId === "quiet")).toBe(true);
  });

  it("passes an insufficient margin through as null, so the margin rule records its refusal", async () => {
    const { built, appendLedger } = deps({
      resolveMargin: async (): Promise<ResolvedMargin | null> => null,
    });
    const result = await evaluateCampaign(
      { organizationId: "org1", campaignId: "c1", cycleId: "cycle1" },
      built,
    );
    const marginRows = appendLedger.mock.calls
      .map(([row]) => row)
      .filter((row: AllocationLedgerRow) => row.decision.ruleKey === "margin.contribution_floor");
    expect(marginRows.every((row) => row.decision.reasonCode === "margin_grade_insufficient")).toBe(
      true,
    );
    expect(result.pauses).toHaveLength(1); // v2's CTR still fires.
  });

  it("is deterministic given fixed inputs and a fixed clock", async () => {
    const first = await evaluateCampaign(
      { organizationId: "org1", campaignId: "c1", cycleId: "cycle1" },
      deps().built,
    );
    const second = await evaluateCampaign(
      { organizationId: "org1", campaignId: "c1", cycleId: "cycle1" },
      deps().built,
    );
    expect(first).toEqual(second);
  });
});
