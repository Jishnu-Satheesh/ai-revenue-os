import { describe, expect, it, vi } from "vitest";

import { createCampaignMetricIngest } from "@/modules/campaigns/infrastructure/metric-ingest";

type RpcCall = {
  name: string;
  args: { target_organization_id: string; input_observation: Record<string, unknown> };
};

function ingest(results: Record<string, unknown>[] = []) {
  const calls: RpcCall[] = [];
  const rpc = vi.fn(async (name: string, args: RpcCall["args"]) => {
    calls.push({ name, args });
    const result = results.shift();
    if (result && typeof result === "object" && "error" in result) {
      return { data: null, error: result.error };
    }
    return { data: result, error: null };
  });

  return { calls, ingest: createCampaignMetricIngest({ rpc: rpc as never }) };
}

const BASE_POINT = {
  organizationId: "a5000000-0000-4000-8000-000000000101",
  campaignId: "a5000000-0000-4000-8000-000000000301",
  subject: { kind: "creative_variant", variantId: "a5000000-0000-4000-8000-000000000801" } as const,
  channel: "instagram",
  metricKey: "delivery.impressions",
  periodStart: "2026-08-17T20:00:00.000Z",
  periodEnd: "2026-08-18T20:00:00.000Z",
  periodTimezone: "Asia/Dubai",
  presence: "observed" as const,
  valueMinor: 4200,
  currency: null,
  qualityTier: "measured" as const,
  collectionRunId: "a5000000-0000-4000-8000-000000000f01",
  observedAt: "2026-08-19T21:00:00.000Z",
};

describe("a collected figure is translated into the RPC contract", () => {
  it("maps a variant figure with the exact snake-case keys the RPC expects", async () => {
    const { calls, ingest: record } = ingest([
      {
        outcome: "recorded",
        observation_id: "a5000000-0000-4000-8000-000000000901",
        revision: 1,
      },
    ]);

    const result = await record.record(BASE_POINT);

    expect(result).toEqual({
      outcome: "recorded",
      observationId: "a5000000-0000-4000-8000-000000000901",
      revision: 1,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("record_campaign_metric_observation");
    expect(calls[0].args.target_organization_id).toBe(BASE_POINT.organizationId);
    expect(calls[0].args.input_observation).toEqual({
      metric_key: "delivery.impressions",
      subject_kind: "creative_variant",
      campaign_id: BASE_POINT.campaignId,
      variant_id: BASE_POINT.subject.variantId,
      action_run_id: null,
      presence: "observed",
      period_grain: "day",
      period_start: "2026-08-17T20:00:00.000Z",
      period_end: "2026-08-18T20:00:00.000Z",
      period_timezone: "Asia/Dubai",
      value_numerator: 4200,
      currency: null,
      quality_tier: "measured",
      channel: "instagram",
      observed_at: "2026-08-19T21:00:00.000Z",
      collection_run_id: "a5000000-0000-4000-8000-000000000f01",
    });
  });

  it("maps an action-run subject with the action id rather than a variant id", async () => {
    const { calls, ingest: record } = ingest([
      { outcome: "recorded", observation_id: "a5000000-0000-4000-8000-000000000901" },
    ]);

    await record.record({
      ...BASE_POINT,
      subject: { kind: "campaign_action", actionRunId: "a5000000-0000-4000-8000-000000000e01" },
    });

    expect(calls[0].args.input_observation).toMatchObject({
      subject_kind: "campaign_action",
      action_run_id: "a5000000-0000-4000-8000-000000000e01",
      variant_id: null,
    });
  });
});

describe("money and gaps are never quietly rewritten", () => {
  it("attaches a currency only to the spend metric", async () => {
    const { calls, ingest: record } = ingest([
      { outcome: "recorded", observation_id: "a5000000-0000-4000-8000-000000000901" },
    ]);

    await record.record({
      ...BASE_POINT,
      metricKey: "delivery.spend",
      valueMinor: 123,
      currency: "AED",
    });
    expect(calls[0].args.input_observation).toMatchObject({
      metric_key: "delivery.spend",
      value_numerator: 123,
      currency: "AED",
    });
  });

  it("strips a currency from a count metric even if a caller passed one", async () => {
    const { calls, ingest: record } = ingest([
      { outcome: "recorded", observation_id: "a5000000-0000-4000-8000-000000000901" },
    ]);

    // A count carrying a currency violates the warehouse's declarative check.
    await record.record({ ...BASE_POINT, currency: "AED" });
    expect(calls[0].args.input_observation.currency).toBeNull();
  });

  it("records an absent period with no value rather than a zero", async () => {
    const { calls, ingest: record } = ingest([
      { outcome: "recorded", observation_id: "a5000000-0000-4000-8000-000000000901" },
    ]);

    await record.record({ ...BASE_POINT, presence: "absent", valueMinor: null });
    expect(calls[0].args.input_observation).toMatchObject({
      presence: "absent",
      value_numerator: null,
    });
  });
});

describe("a settled window is safe to sweep twice", () => {
  it("passes the unchanged outcome back rather than throwing", async () => {
    const { ingest: record } = ingest([
      { outcome: "unchanged", observation_id: "a5000000-0000-4000-8000-000000000901" },
    ]);

    const result = await record.record(BASE_POINT);
    expect(result).toEqual({
      outcome: "unchanged",
      observationId: "a5000000-0000-4000-8000-000000000901",
    });
  });

  it("surfaces a database refusal rather than pretending it recorded", async () => {
    const { ingest: record } = ingest([{ error: { code: "23503", message: "not found" } }]);

    await expect(record.record(BASE_POINT)).rejects.toThrow("could not be recorded");
  });
});
