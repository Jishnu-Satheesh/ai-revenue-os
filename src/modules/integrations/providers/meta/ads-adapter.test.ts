import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const recorded: { edge: string; params: Record<string, unknown> }[] = [];

vi.mock("facebook-nodejs-business-sdk", () => {
  class Account {
    constructor(public id: string) {}
    async createCampaign(_f: string[], params: Record<string, unknown>) {
      recorded.push({ edge: "campaign", params });
      return {};
    }
    async createAdSet(_f: string[], params: Record<string, unknown>) {
      recorded.push({ edge: "ad_set", params });
      return {};
    }
    async createAdCreative(_f: string[], params: Record<string, unknown>) {
      recorded.push({ edge: "ad_creative", params });
      return {};
    }
    async createAd(_f: string[], params: Record<string, unknown>) {
      recorded.push({ edge: "ad", params });
      return {};
    }
  }
  return { AdAccount: Account, FacebookAdsApi: class {} };
});

import { createMetaAdsAdapter } from "@/modules/integrations/providers/meta/ads-adapter";

const ORG = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";

function request(overrides: Record<string, unknown> = {}) {
  return {
    adAccountId: "act_123",
    pageId: "page_1",
    name: "Weekend feast test",
    objective: "OUTCOME_AWARENESS",
    dailyBudgetMinor: 15_000,
    endTime: "2026-08-25T00:00:00.000Z",
    imageUrl: "https://cdn.test/a.jpg",
    caption: "Weekend table",
    targeting: { geo_locations: { countries: ["AE"] } },
    ...overrides,
  };
}

const ok = (id: string) => ({ outcome: "succeeded" as const, data: { id } });
const failed = (code: string) => ({
  outcome: "failed" as const,
  status: 400,
  failureCode: code,
  retryable: false,
});
const unknown = { outcome: "unknown" as const, reason: "timeout" as const };

function adapter(
  script: Partial<Record<string, unknown>>,
  options: { built?: Record<string, string>; request?: Record<string, unknown> } = {},
) {
  recorded.length = 0;
  const ledgerRows: Record<string, string> = { ...(options.built ?? {}) };

  return {
    adapter: createMetaAdsAdapter({
      client: {
        api: {} as never,
        guard: vi.fn(async ({ run }: { run: () => Promise<unknown> }) => {
          await run();
          const edge = recorded.at(-1)?.edge ?? "";
          return script[edge] ?? ok(`${edge}-id`);
        }),
      } as never,
      ledger: {
        read: async () => ({ ...ledgerRows }) as never,
        record: async ({ objectType, externalId }) => {
          ledgerRows[objectType] = ledgerRows[objectType] ?? externalId;
          return { externalId: ledgerRows[objectType] };
        },
      },
      loadRequest: async () => request(options.request) as never,
      now: () => new Date("2026-08-19T10:00:00.000Z"),
    }),
    ledgerRows,
  };
}

function invoke(a: ReturnType<typeof adapter>["adapter"]) {
  return a.invoke({
    organizationId: ORG,
    actionRunId: RUN,
    idempotencyKey: "idem-abcdefgh",
    signal: new AbortController().signal,
  });
}

describe("nothing can spend until the whole experiment exists", () => {
  it("creates every object paused", async () => {
    const { adapter: a } = adapter({});
    await invoke(a);

    for (const edge of ["campaign", "ad_set", "ad"]) {
      expect(recorded.find((call) => call.edge === edge)?.params).toMatchObject({
        status: "PAUSED",
      });
    }
  });

  it("reports the finished experiment as paused, not live", async () => {
    // Activation is a separate, explicit act. A build that reported ACTIVE
    // would be money leaving on a configuration nobody chose to start.
    const { adapter: a } = adapter({});
    const result = await invoke(a);

    expect(result).toMatchObject({ status: "succeeded", providerStatus: "PAUSED" });
  });

  it("puts the approved ceiling and a hard end time on the ad set", async () => {
    // The provider-side half of the double enforcement: it holds even if
    // nothing in this platform ever runs again.
    const { adapter: a } = adapter({});
    await invoke(a);

    expect(recorded.find((call) => call.edge === "ad_set")?.params).toMatchObject({
      daily_budget: 15_000,
      end_time: "2026-08-25T00:00:00.000Z",
    });
  });

  it("refuses a ceiling of zero rather than treating it as unlimited", async () => {
    const { adapter: a } = adapter({}, { request: { dailyBudgetMinor: 0 } });
    const result = await invoke(a);

    expect(result).toEqual({ status: "failed", failureCode: "meta.ads.budget_not_positive" });
    expect(recorded).toEqual([]);
  });
});

describe("a retry resumes rather than building a second experiment", () => {
  it("skips objects the ledger already holds", async () => {
    // The first pair still exists under the client's ad account. Rebuilding
    // them is how one approved experiment becomes two live campaigns.
    const { adapter: a } = adapter({}, { built: { campaign: "c-1", ad_set: "s-1" } });
    await invoke(a);

    expect(recorded.map((call) => call.edge)).toEqual(["ad_creative", "ad"]);
  });

  it("uses the resumed ids rather than fresh ones", async () => {
    const { adapter: a } = adapter({}, { built: { campaign: "c-1", ad_set: "s-1" } });
    const result = await invoke(a);

    if (result.status !== "succeeded") throw new Error("expected success");
    expect(result.normalized).toMatchObject({ campaignId: "c-1", adSetId: "s-1" });
  });

  it("records each id before making the next call", async () => {
    const { adapter: a, ledgerRows } = adapter({ ad_creative: failed("meta.400") });
    await invoke(a);

    // Creative failed, but campaign and ad set are already recorded — which is
    // what lets the retry resume instead of duplicating.
    expect(ledgerRows).toMatchObject({ campaign: "campaign-id", ad_set: "ad_set-id" });
  });

  it("stops at an unknown outcome rather than risking a second object", async () => {
    const { adapter: a } = adapter({ ad_set: unknown });
    const result = await invoke(a);

    expect(result).toEqual({ status: "unknown", failureCode: "meta.ads.ad_set_unknown" });
    // The ad was never attempted.
    expect(recorded.some((call) => call.edge === "ad")).toBe(false);
  });
});

describe("a refused step fails the whole build cleanly", () => {
  it("stops at the campaign when the provider refuses it", async () => {
    const { adapter: a } = adapter({ campaign: failed("meta.400.OAuthException.190") });
    const result = await invoke(a);

    expect(result).toEqual({ status: "failed", failureCode: "meta.400.OAuthException.190" });
    expect(recorded.map((call) => call.edge)).toEqual(["campaign"]);
  });

  it("reports nothing settled, because a paused experiment has spent nothing", async () => {
    const { adapter: a } = adapter({});
    const result = await invoke(a);

    if (result.status !== "succeeded") throw new Error("expected success");
    expect(result.settledMinor).toBe(0);
  });
});
