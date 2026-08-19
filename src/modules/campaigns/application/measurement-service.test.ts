import { describe, expect, it, vi } from "vitest";

import type {
  MeasurementContext,
  MeasurementServiceDependencies,
} from "@/modules/campaigns/application/measurement-service";
import {
  settleCampaign,
  settlementEligibleAt,
} from "@/modules/campaigns/application/measurement-service";

const FIRST_EXPOSURE = "2026-08-01T00:00:00.000Z";

function context(overrides: Partial<MeasurementContext> = {}): MeasurementContext {
  return {
    organizationId: "org1",
    campaignId: "camp1",
    plan: {
      primaryMetricKey: "revenue.purchase_value",
      guardrailMetricKeys: ["delivery.spend"],
      baselineSource: "goal_baseline_measured:revenue.purchase_value",
      baselineLookbackDays: 28,
      attributionMethod: "observational_prepost",
      outcomeWindowDays: 14,
      settlementDelayDays: 3,
      minimumEvidenceTier: "observed",
    },
    bundleVersionId: "bundle1",
    planDigest: "a".repeat(64),
    firstExposureAt: FIRST_EXPOSURE,
    exposure: {
      plannedCount: 6,
      realizedCount: 6,
      truncations: [
        {
          variantId: "v1",
          cause: "agent_pause",
          ruleKey: "diagnostic.ctr_floor",
          at: FIRST_EXPOSURE,
        },
      ],
    },
    guardrail: {
      state: "clear",
      realizedSpendMinor: 4000,
      spendCeilingMinor: 10000,
      currency: "USD",
    },
    primaryObservations: [
      { valueMinor: 100, periodStart: FIRST_EXPOSURE, evidenceTier: "observed" },
    ],
    baseline: { valueMinor: 50, periodStart: FIRST_EXPOSURE, evidenceTier: "observed" },
    providerEffect: null,
    ...overrides,
  };
}

function deps(overrides: Partial<MeasurementServiceDependencies> = {}) {
  const readContext = vi.fn(async () => context());
  const writeOutcome = vi.fn<MeasurementServiceDependencies["writeOutcome"]>();
  writeOutcome.mockResolvedValue({ result: "recorded", outcomeId: "o1" });
  const now = vi.fn(() => new Date("2026-08-20T00:00:00.000Z"));

  const built: MeasurementServiceDependencies = {
    readContext,
    writeOutcome,
    now,
    ...overrides,
  };
  return { built, readContext, writeOutcome, now };
}

describe("settlementEligibleAt", () => {
  it("is first exposure plus window plus delay", () => {
    expect(settlementEligibleAt(FIRST_EXPOSURE, 14, 3)).toBe("2026-08-18T00:00:00.000Z");
  });
});

describe("settleCampaign", () => {
  it("refuses to settle before the window and delay have passed", async () => {
    const { built } = deps({ now: () => new Date("2026-08-17T23:59:59.000Z") });
    const result = await settleCampaign({ organizationId: "org1", campaignId: "camp1" }, built);

    expect(result).toEqual({ result: "not_ready", eligibleAt: "2026-08-18T00:00:00.000Z" });
  });

  it("settles once the delay has passed", async () => {
    const { built, writeOutcome } = deps();
    const result = await settleCampaign({ organizationId: "org1", campaignId: "camp1" }, built);

    expect(result).toMatchObject({ result: "settled" });
    expect(writeOutcome).toHaveBeenCalledTimes(1);
    expect(writeOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: "validated_outcome",
        plannedExposureCount: 6,
        realizedExposureCount: 6,
        estimateMinor: 50,
      }),
    );
  });

  it("never passes engagement diagnostics to the verdict", async () => {
    const { built, writeOutcome } = deps();
    await settleCampaign({ organizationId: "org1", campaignId: "camp1" }, built);

    const write = writeOutcome.mock.calls[0][0];
    expect(write).not.toHaveProperty("impressions");
    expect(write).not.toHaveProperty("clicks");
  });

  it("computes against the plan it read, and stores planned and realized exposure separately", async () => {
    const { built, writeOutcome } = deps();
    await settleCampaign({ organizationId: "org1", campaignId: "camp1" }, built);

    const write = writeOutcome.mock.calls[0][0];
    expect(write.plannedExposureCount).toBe(6);
    expect(write.realizedExposureCount).toBe(6);
    // No single "effective exposure" number exists anywhere in the payload.
    expect(write).not.toHaveProperty("exposureCount");
    expect(write).not.toHaveProperty("effectiveExposure");
  });

  it("records truncation causes on the write", async () => {
    const { built, writeOutcome } = deps();
    await settleCampaign({ organizationId: "org1", campaignId: "camp1" }, built);

    const write = writeOutcome.mock.calls[0][0];
    expect(write.truncationCauses).toEqual([
      {
        variantId: "v1",
        cause: "agent_pause",
        ruleKey: "diagnostic.ctr_floor",
        at: FIRST_EXPOSURE,
      },
    ]);
  });

  it("surfaces a write refusal as a failure, never a silent overwrite", async () => {
    const { built } = deps({
      writeOutcome: vi.fn(async () => ({
        result: "refused" as const,
        reasonCode: "settlement_not_due",
      })),
    });
    const result = await settleCampaign({ organizationId: "org1", campaignId: "camp1" }, built);

    expect(result).toEqual({ result: "failed", failureCode: "settlement_not_due" });
  });

  it("fails when there is no first exposure to anchor the window", async () => {
    const { built } = deps({ readContext: vi.fn(async () => context({ firstExposureAt: "" })) });
    const result = await settleCampaign({ organizationId: "org1", campaignId: "camp1" }, built);

    expect(result).toEqual({ result: "failed", failureCode: "campaign_has_no_exposure" });
  });
});
