import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getMetaCampaignProviderContract } from "@/modules/integrations/providers/meta/contract";
import { createMetaGraphClient } from "@/modules/integrations/providers/meta/client";
import {
  createMetaMediaInsightsReader,
  ORGANIC_POST_METRIC_KEYS,
} from "@/modules/integrations/providers/meta/media-insights-reader";

// Inside the checked-in contract's review window. Moves whenever the contract
// is re-verified; these tests only need a parseable contract, not a date.
const CONTRACT = getMetaCampaignProviderContract(new Date("2026-09-15T12:00:00.000Z"));

function credential() {
  return {
    value: "token-abc",
    toJSON(): never {
      throw new Error("A credential must never be serialised.");
    },
  };
}

function reader(call: (...args: unknown[]) => Promise<unknown>, timeoutMs?: number) {
  const client = createMetaGraphClient({
    contract: CONTRACT,
    credential: credential(),
    apiFactory: () => ({ call }) as never,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return createMetaMediaInsightsReader(client);
}

const signal = new AbortController().signal;

const BASE = {
  mediaId: "17895695668004550",
  observedOn: "2026-09-15",
  timezone: "Asia/Dubai",
  metricKeys: ORGANIC_POST_METRIC_KEYS,
};

/**
 * The shape Meta's media insights edge actually returns: one entry per metric,
 * each carrying a single lifetime value.
 */
function edge(values: Readonly<Record<string, number>>) {
  return {
    data: Object.entries(values).map(([name, value]) => ({
      name,
      period: "lifetime",
      values: [{ value }],
      title: name,
      description: `Documented description of ${name}`,
      id: `17895695668004550/insights/${name}/lifetime`,
    })),
  };
}

const FULL = {
  reach: 1840,
  likes: 96,
  comments: 7,
  saved: 23,
  shares: 11,
  total_interactions: 137,
  profile_visits: 42,
  profile_activity: 18,
  reposts: 3,
};

describe("Meta media insights reader", () => {
  it("asks the media's own insights edge for the documented metric names", async () => {
    const call = vi.fn().mockResolvedValue(edge(FULL));

    await reader(call).readMediaInsights(BASE, signal);

    const [method, path, params] = call.mock.calls[0] ?? [];
    expect(method).toBe("GET");
    expect(path).toEqual(["17895695668004550", "insights"]);
    // Meta's own names, not the platform's keys.
    expect(String((params as { metric: string }).metric).split(",").sort()).toEqual(
      [
        "comments",
        "likes",
        "profile_activity",
        "profile_visits",
        "reach",
        "reposts",
        "saved",
        "shares",
        "total_interactions",
      ].sort(),
    );
  });

  it("sends no period, because Meta fixes it at lifetime regardless", async () => {
    const call = vi.fn().mockResolvedValue(edge(FULL));

    await reader(call).readMediaInsights(BASE, signal);

    const [, , params] = call.mock.calls[0] ?? [];
    // Asking for something the provider ignores would describe a request this
    // reader does not make.
    expect(params).not.toHaveProperty("period");
  });

  it("reads every lifetime figure back against its platform key", async () => {
    const result = await reader(vi.fn().mockResolvedValue(edge(FULL))).readMediaInsights(
      BASE,
      signal,
    );

    if (result.outcome !== "succeeded") throw new Error("expected success");
    const byKey = Object.fromEntries(result.points.map((p) => [p.metricKey, p.valueMinor]));
    expect(byKey["instagram.post_reach"]).toBe(1840);
    expect(byKey["instagram.post_likes"]).toBe(96);
    expect(byKey["instagram.post_total_interactions"]).toBe(137);
    expect(result.points.every((point) => point.presence === "observed")).toBe(true);
  });

  it("stamps every reading with the day it was taken, in the caller's timezone", async () => {
    const result = await reader(vi.fn().mockResolvedValue(edge(FULL))).readMediaInsights(
      BASE,
      signal,
    );

    if (result.outcome !== "succeeded") throw new Error("expected success");
    // A Dubai day begins at 20:00 UTC the evening before. Stamping in UTC would
    // file a reading under the wrong day for most of the client's afternoon.
    expect(result.points[0]?.periodStart).toBe("2026-09-14T20:00:00.000Z");
    expect(result.points[0]?.periodEnd).toBe("2026-09-15T20:00:00.000Z");
  });

  it("records a metric Meta left out as a gap, not a zero", async () => {
    // Meta returns only what it has. A post with no shares yet may simply not
    // carry the entry.
    const partial = { ...FULL } as Record<string, number>;
    delete partial.shares;
    delete partial.reposts;

    const result = await reader(vi.fn().mockResolvedValue(edge(partial))).readMediaInsights(
      BASE,
      signal,
    );

    if (result.outcome !== "succeeded") throw new Error("expected success");
    const shares = result.points.find((p) => p.metricKey === "instagram.post_shares");
    // A zero here would read as "measured, and it was nothing", which is a
    // claim nobody made.
    expect(shares?.presence).toBe("absent");
    expect(shares?.valueMinor).toBeNull();
    // Still produced, so the gap is recorded rather than the row missing.
    expect(result.points).toHaveLength(ORGANIC_POST_METRIC_KEYS.length);
  });

  it("treats a non-integer count as unreadable rather than rounding it", async () => {
    const result = await reader(
      vi.fn().mockResolvedValue(edge({ ...FULL, reach: 18.4 })),
    ).readMediaInsights(BASE, signal);

    if (result.outcome !== "succeeded") throw new Error("expected success");
    const reach = result.points.find((p) => p.metricKey === "instagram.post_reach");
    expect(reach?.presence).toBe("absent");
    expect(reach?.valueMinor).toBeNull();
  });

  it("records an entry with no values at all as a gap", async () => {
    const result = await reader(
      vi.fn().mockResolvedValue({
        data: [{ name: "reach", period: "lifetime", values: [] }],
      }),
    ).readMediaInsights({ ...BASE, metricKeys: ["instagram.post_reach"] }, signal);

    if (result.outcome !== "succeeded") throw new Error("expected success");
    expect(result.points[0]?.presence).toBe("absent");
  });

  it("asks for nothing when nothing was requested", async () => {
    const call = vi.fn();

    const result = await reader(call).readMediaInsights({ ...BASE, metricKeys: [] }, signal);

    expect(result).toEqual({ outcome: "succeeded", points: [] });
    expect(call).not.toHaveBeenCalled();
  });

  it("refuses a metric the contract does not register", async () => {
    const call = vi.fn();

    const result = await reader(call).readMediaInsights(
      // `impressions` is deprecated for anything published after 2024-07-02, so
      // there is deliberately no key for it. Asking anyway is a caller bug.
      { ...BASE, metricKeys: ["instagram.post_impressions" as never] },
      signal,
    );

    expect(result).toEqual({
      outcome: "failed",
      failureCode: "meta.media_insights.metric_unregistered",
      retryable: false,
    });
    expect(call).not.toHaveBeenCalled();
  });

  it("keeps a timeout unknown rather than calling it a failure", async () => {
    // A short timeout so the suite does not wait out the real one. What is
    // under test is the outcome, not the duration.
    const result = await reader(
      vi.fn().mockImplementation(() => new Promise(() => {})),
      25,
    ).readMediaInsights(BASE, signal);

    // Reading is idempotent, so an unknown read is safe to retry — but it must
    // not be recorded as "measured nothing" in the meantime.
    expect(result.outcome).toBe("unknown");
  });

  it("passes a provider refusal back with its own code", async () => {
    const result = await reader(
      vi.fn().mockRejectedValue({
        response: { error: { code: 100, type: "OAuthException", http_status: 400 } },
        status: 400,
      }),
    ).readMediaInsights(BASE, signal);

    expect(result.outcome).toBe("failed");
    if (result.outcome !== "failed") throw new Error("expected failure");
    expect(result.failureCode).toMatch(/meta/);
  });
});
