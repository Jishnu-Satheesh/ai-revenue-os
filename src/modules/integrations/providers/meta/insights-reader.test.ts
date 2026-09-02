import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getMetaCampaignProviderContract } from "@/modules/integrations/providers/meta/contract";
import { createMetaGraphClient } from "@/modules/integrations/providers/meta/client";
import { createMetaInsightsReader } from "@/modules/integrations/providers/meta/insights-reader";

const CONTRACT = getMetaCampaignProviderContract(new Date("2026-08-18T00:00:00.000Z"));

function credential() {
  return {
    value: "token-abc",
    toJSON(): never {
      throw new Error("A credential must never be serialised.");
    },
  };
}

function reader(call: (...args: unknown[]) => Promise<unknown>) {
  const client = createMetaGraphClient({
    contract: CONTRACT,
    credential: credential(),
    apiFactory: () => ({ call }) as never,
  });
  return createMetaInsightsReader(client);
}

const signal = new AbortController().signal;
const BASE = {
  adId: "act_12345",
  since: "2026-08-18",
  until: "2026-08-19",
  currency: "AED",
  timezone: "Asia/Dubai",
  metricKeys: ["delivery.impressions", "delivery.clicks", "delivery.spend"] as const,
};

describe("the reader asks for exactly what the contract registers", () => {
  it("passes the three fields, a daily increment, and a bounded time range", async () => {
    const call = vi.fn(async () => ({ data: [] }));
    const result = await reader(call).readAdInsights(BASE, signal);

    expect(result.outcome).toBe("succeeded");

    const [method, path, params] = call.mock.calls[0] as unknown[];
    expect(method).toBe("GET");
    expect(path).toEqual(["act_12345", "insights"]);
    expect(params).toMatchObject({
      fields: "impressions,clicks,spend",
      time_range: { since: "2026-08-18", until: "2026-08-19" },
      time_increment: 1,
    });
  });

  it("does not ask for reach or frequency, which the registry deliberately omits", async () => {
    const call = vi.fn(async () => ({ data: [] }));
    await reader(call).readAdInsights(BASE, signal);
    expect(JSON.stringify(call.mock.calls[0])).not.toMatch(/reach|frequency/);
  });
});

describe("a provider row becomes platform points", () => {
  it("maps each field and converts a decimal spend into minor units", async () => {
    const call = vi.fn(async () => ({
      data: [
        {
          date_start: "2026-08-18",
          date_stop: "2026-08-18",
          impressions: "4200",
          clicks: "12",
          spend: "1.23",
        },
      ],
    }));

    const result = await reader(call).readAdInsights(BASE, signal);
    if (result.outcome !== "succeeded") throw new Error("expected success");

    expect(result.points).toEqual([
      {
        metricKey: "delivery.impressions",
        periodStart: "2026-08-17T20:00:00.000Z",
        periodEnd: "2026-08-18T20:00:00.000Z",
        presence: "observed",
        valueMinor: 4200,
      },
      {
        metricKey: "delivery.clicks",
        periodStart: "2026-08-17T20:00:00.000Z",
        periodEnd: "2026-08-18T20:00:00.000Z",
        presence: "observed",
        valueMinor: 12,
      },
      {
        metricKey: "delivery.spend",
        periodStart: "2026-08-17T20:00:00.000Z",
        periodEnd: "2026-08-18T20:00:00.000Z",
        presence: "observed",
        valueMinor: 123,
      },
    ]);
  });

  it("records a field the provider omitted as absent, never as a zero", async () => {
    const call = vi.fn(async () => ({
      data: [{ date_start: "2026-08-18", date_stop: "2026-08-18", impressions: "4200" }],
    }));

    const result = await reader(call).readAdInsights(BASE, signal);
    if (result.outcome !== "succeeded") throw new Error("expected success");

    const clicks = result.points.find((point) => point.metricKey === "delivery.clicks");
    expect(clicks).toEqual({
      metricKey: "delivery.clicks",
      periodStart: "2026-08-17T20:00:00.000Z",
      periodEnd: "2026-08-18T20:00:00.000Z",
      presence: "absent",
      valueMinor: null,
    });
  });
});

describe("the reader fails closed rather than inventing", () => {
  it("refuses a metric the registry does not declare", async () => {
    const call = vi.fn(async () => ({ data: [] }));
    const result = await reader(call).readAdInsights(
      { ...BASE, metricKeys: ["delivery.reach" as never] },
      signal,
    );

    expect(result).toEqual({
      outcome: "failed",
      failureCode: "meta.insights.metric_unregistered",
      retryable: false,
    });
    expect(call).not.toHaveBeenCalled();
  });

  it("treats an unreadable figure as absent rather than guessing", async () => {
    const call = vi.fn(async () => ({
      data: [
        {
          date_start: "2026-08-18",
          date_stop: "2026-08-18",
          impressions: "not-a-number",
        },
      ],
    }));

    const result = await reader(call).readAdInsights(BASE, signal);
    if (result.outcome !== "succeeded") throw new Error("expected success");

    const impressions = result.points.find((point) => point.metricKey === "delivery.impressions");
    expect(impressions?.presence).toBe("absent");
  });

  it("propagates an unknown outcome so the caller reconciles", async () => {
    const call = vi.fn(async () => new Promise(() => {}));
    const readerUnderTimeout = (() => {
      const client = createMetaGraphClient({
        contract: CONTRACT,
        credential: credential(),
        apiFactory: () => ({ call }) as never,
        timeoutMs: 10,
      });
      return createMetaInsightsReader(client);
    })();

    const result = await readerUnderTimeout.readAdInsights(BASE, signal);
    expect(result).toEqual({ outcome: "unknown", reason: "timeout" });
  });
});
