import { describe, expect, it, vi } from "vitest";

import {
  createMeasurementRepository,
  type MeasurementPersistence,
} from "@/modules/campaigns/infrastructure/measurement-repository";

function makePersistence() {
  const rpc = vi.fn();
  return { persistence: { rpc } as unknown as MeasurementPersistence, rpc };
}

const CONTEXT = {
  bundle_version_id: "11111111-1111-4111-8111-111111111111",
  plan_digest: "a".repeat(64),
  first_exposure_at: "2026-08-01T00:00:00.000Z",
  plan: {
    primary_metric_key: "revenue.purchase_value",
    guardrail_metric_keys: ["delivery.spend"],
    baseline_source: "goal_baseline_measured:revenue.purchase_value",
    baseline_lookback_days: 28,
    attribution_method: "observational_prepost",
    outcome_window_days: 14,
    settlement_delay_days: 3,
    minimum_evidence_tier: "observed",
  },
  planned_exposure_count: 6,
  realized_exposure_count: "4",
  truncations: [
    {
      variant_id: "22222222-2222-4222-8222-222222222222",
      cause: "agent_pause",
      rule_key: "diagnostic.ctr_floor",
      at: "2026-08-02T00:00:00.000Z",
    },
  ],
  spend_ceiling_minor: "10000",
  spend_currency: "USD",
  realized_spend_minor: 12000,
  primary_observations: [
    { value_minor: "100", period_start: "2026-08-01T00:00:00.000Z", evidence_tier: "observed" },
  ],
  baseline_observation: { value_minor: "50", evidence_tier: "observed" },
  provider_effect: null,
};

describe("createMeasurementRepository", () => {
  it("reads the context and reconstructs realized exposure and the guardrail", async () => {
    const { persistence, rpc } = makePersistence();
    rpc.mockResolvedValueOnce({ data: CONTEXT, error: null });

    const repo = createMeasurementRepository(persistence);
    const context = await repo.readContext("org1", "camp1");

    expect(rpc).toHaveBeenCalledWith("read_campaign_measurement_context", {
      target_organization_id: "org1",
      target_campaign_id: "camp1",
    });
    expect(context.exposure).toEqual({
      plannedCount: 6,
      realizedCount: 4,
      truncations: [
        {
          variantId: "22222222-2222-4222-8222-222222222222",
          cause: "agent_pause",
          ruleKey: "diagnostic.ctr_floor",
          at: "2026-08-02T00:00:00.000Z",
        },
      ],
    });
    // Realized spend above the ceiling resolves to a breach, never "clear".
    expect(context.guardrail).toEqual({
      state: "breached",
      realizedSpendMinor: 12000,
      spendCeilingMinor: 10000,
      currency: "USD",
    });
    expect(context.primaryObservations[0].valueMinor).toBe(100);
  });

  it("coerces absent numeric fields to a null guardrail rather than zero", async () => {
    const { persistence, rpc } = makePersistence();
    rpc.mockResolvedValueOnce({
      data: { ...CONTEXT, realized_spend_minor: null },
      error: null,
    });

    const repo = createMeasurementRepository(persistence);
    const context = await repo.readContext("org1", "camp1");
    expect(context.guardrail.state).toBe("unmeasured");
    expect(context.guardrail.realizedSpendMinor).toBeNull();
  });

  it("writes an outcome and parses the write result", async () => {
    const { persistence, rpc } = makePersistence();
    rpc.mockResolvedValueOnce({
      data: { outcome: "recorded", outcome_id: "33333333-3333-4333-8333-333333333333" },
      error: null,
    });

    const repo = createMeasurementRepository(persistence);
    const result = await repo.writeOutcome({
      organizationId: "org1",
      campaignId: "camp1",
      bundleVersionId: "11111111-1111-4111-8111-111111111111",
      planDigest: "a".repeat(64),
      verdict: "validated_outcome",
      attributionMethod: "observational_prepost",
      primaryMetricKey: "revenue.purchase_value",
      outcomeWindowDays: 14,
      settlementDelayDays: 3,
      plannedExposureCount: 6,
      realizedExposureCount: 6,
      estimateMinor: 50,
      estimateLowMinor: 0,
      estimateHighMinor: 100,
      estimateCurrency: "USD",
      evidenceTier: "observed",
      guardrailState: "clear",
      realizedSpendMinor: 4000,
      spendCeilingMinor: 10000,
      spendCurrency: "USD",
      truncationCauses: [],
      limitations: ["none"],
      baselineSource: "goal_baseline_measured:revenue.purchase_value",
      baselineLookbackDays: 28,
    });

    expect(result).toEqual({
      result: "recorded",
      outcomeId: "33333333-3333-4333-8333-333333333333",
    });
    expect(rpc).toHaveBeenCalledWith("settle_campaign_outcome", {
      target_organization_id: "org1",
      input_outcome: expect.objectContaining({
        verdict: "validated_outcome",
        planned_exposure_count: 6,
        realized_exposure_count: 6,
      }),
    });
  });

  it("surfaces an RPC refusal as a refused result with its reason code", async () => {
    const { persistence, rpc } = makePersistence();
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "settlement_not_due", message: "not due" },
    });

    const repo = createMeasurementRepository(persistence);
    const result = await repo.writeOutcome({
      organizationId: "org1",
      campaignId: "camp1",
      bundleVersionId: "11111111-1111-4111-8111-111111111111",
      planDigest: "a".repeat(64),
      verdict: "inconclusive",
      attributionMethod: "observational_prepost",
      primaryMetricKey: "revenue.purchase_value",
      outcomeWindowDays: 14,
      settlementDelayDays: 3,
      plannedExposureCount: 6,
      realizedExposureCount: 0,
      estimateMinor: null,
      estimateLowMinor: null,
      estimateHighMinor: null,
      estimateCurrency: null,
      evidenceTier: null,
      guardrailState: "unmeasured",
      realizedSpendMinor: null,
      spendCeilingMinor: 10000,
      spendCurrency: "USD",
      truncationCauses: [],
      limitations: ["no data"],
      baselineSource: "goal_baseline_measured:revenue.purchase_value",
      baselineLookbackDays: 28,
    });

    expect(result).toEqual({ result: "refused", reasonCode: "settlement_not_due" });
  });

  it("throws when the context RPC fails", async () => {
    const { persistence, rpc } = makePersistence();
    rpc.mockResolvedValueOnce({ data: null, error: { code: "campaign_not_found", message: "no" } });

    const repo = createMeasurementRepository(persistence);
    await expect(repo.readContext("org1", "camp1")).rejects.toThrow();
  });
});
