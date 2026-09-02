import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Written = { kind: string; id: string; params: Record<string, unknown> };
type Reads = { kind: string; id: string; fields: string[] };

const writes: Written[] = [];
const reads: Reads[] = [];

vi.mock("facebook-nodejs-business-sdk", () => {
  const model = (kind: string) =>
    class {
      constructor(public id: string) {}
      async update(_fields: string[], params: Record<string, unknown>) {
        writes.push({ kind, id: this.id, params });
        return {};
      }
      async read(fields: string[]) {
        reads.push({ kind, id: this.id, fields });
        return {};
      }
    };
  return {
    Ad: model("ad"),
    AdSet: model("ad_set"),
    Campaign: model("campaign"),
    FacebookAdsApi: class {},
  };
});

import { createMetaAdsPauseAdapter } from "@/modules/integrations/providers/meta/pause-adapter";

const ORG = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const TARGET = "33333333-3333-4333-8333-333333333333";

const FULL = { campaign: "c_1", ad_set: "s_1", ad_creative: "cr_1", ad: "a_1" };

const acknowledged = { outcome: "succeeded" as const, data: { success: true } };
const status = (effective_status: string) => ({
  outcome: "succeeded" as const,
  data: { effective_status },
});
const failed = (failureCode: string) => ({
  outcome: "failed" as const,
  status: 400,
  failureCode,
  retryable: false,
});
const unknown = { outcome: "unknown" as const, reason: "timeout" as const };

/**
 * `script` is consumed one guarded call at a time, in order, so a test states
 * exactly what the provider does at each step rather than by call shape.
 */
function adapter(options: {
  script: unknown[];
  built?: Record<string, string>;
  depth?: "ad" | "experiment";
}) {
  writes.length = 0;
  reads.length = 0;
  const queue = [...options.script];

  return createMetaAdsPauseAdapter({
    client: {
      api: {} as never,
      guard: vi.fn(async ({ run }: { run: () => Promise<unknown> }) => {
        await run();
        return queue.shift();
      }),
      request: vi.fn(),
    } as never,
    ledger: {
      read: vi.fn(async () => ({ ...(options.built ?? FULL) })),
    },
    loadRequest: vi.fn(async () => ({
      targetActionRunId: TARGET,
      depth: options.depth ?? ("ad" as const),
    })),
    now: () => new Date("2026-08-19T12:00:00.000Z"),
  });
}

function invoke(instance: ReturnType<typeof adapter>) {
  return instance.invoke({
    organizationId: ORG,
    actionRunId: RUN,
    idempotencyKey: `action:${RUN}`,
    // A pause moves no money, so nothing is reserved for it.
    reservation: { amountMinor: null, currency: null },
    signal: new AbortController().signal,
  });
}

describe("meta.ads.pause_ad", () => {
  it("pauses the ad and proves it stopped by reading the object back", async () => {
    const result = await invoke(adapter({ script: [acknowledged, status("PAUSED")] }));

    expect(writes).toEqual([{ kind: "ad", id: "a_1", params: { status: "PAUSED" } }]);
    expect(reads).toEqual([{ kind: "ad", id: "a_1", fields: ["effective_status"] }]);
    expect(result).toMatchObject({
      status: "succeeded",
      externalReference: "a_1",
      providerStatus: "PAUSED",
      settledMinor: 0,
    });
  });

  it("treats the provider's acknowledgement alone as unproven", async () => {
    // Meta accepted the write and the ad is still delivering. Reporting the
    // acknowledgement as containment is exactly the lie this guards against.
    const result = await invoke(adapter({ script: [acknowledged, status("ACTIVE")] }));

    expect(result).toEqual({ status: "unknown", failureCode: "meta.ads.pause_not_reflected" });
  });

  it("does not read a not-yet-stopped status as containment", async () => {
    const result = await invoke(adapter({ script: [acknowledged, status("PENDING_REVIEW")] }));

    expect(result.status).toBe("unknown");
  });

  it("accepts containment inherited from a parent object", async () => {
    const result = await invoke(adapter({ script: [acknowledged, status("CAMPAIGN_PAUSED")] }));

    expect(result).toMatchObject({ status: "succeeded", providerStatus: "CAMPAIGN_PAUSED" });
  });

  it("settles an unknown write when the read proves the ad stopped", async () => {
    // The whole reason a pause is verified rather than trusted: a timed-out
    // write that actually landed resolves here instead of escalating.
    const result = await invoke(adapter({ script: [unknown, status("PAUSED")] }));

    expect(result).toMatchObject({ status: "succeeded", providerStatus: "PAUSED" });
  });

  it("reports unknown when the verifying read cannot be made", async () => {
    const result = await invoke(adapter({ script: [acknowledged, unknown] }));

    expect(result).toEqual({ status: "unknown", failureCode: "meta.ads.pause_unconfirmed" });
  });

  it("carries the write's own unknown code when nothing later settles it", async () => {
    const result = await invoke(adapter({ script: [unknown, unknown] }));

    expect(result).toEqual({ status: "unknown", failureCode: "meta.ads.pause_ad_unknown" });
  });

  it("succeeds on a rejected write when the object is already contained", async () => {
    // Containment is the goal, not the request. An ad someone else already
    // paused is a stopped ad.
    const result = await invoke(
      adapter({ script: [failed("meta.400.OAuthException.100"), status("PAUSED")] }),
    );

    expect(result).toMatchObject({ status: "succeeded", providerStatus: "PAUSED" });
  });

  it("reaches the ad set and campaign when containment is a guardrail stop", async () => {
    const result = await invoke(
      adapter({
        depth: "experiment",
        script: [acknowledged, acknowledged, acknowledged, status("PAUSED")],
      }),
    );

    expect(writes.map((write) => write.kind)).toEqual(["ad", "ad_set", "campaign"]);
    // The ad goes first: it is the object whose pause stops delivery.
    expect(writes[0]).toMatchObject({ kind: "ad" });
    expect(result).toMatchObject({ status: "succeeded" });
    expect((result as { normalized: Record<string, unknown> }).normalized).toMatchObject({
      depth: "experiment",
      pausedObjects: ["ad", "ad_set", "campaign"],
    });
  });

  it("escalates on its own when the build never recorded an ad", async () => {
    // An ad created by a build whose outcome was unknown has an id nobody
    // learned. It can only be stopped from above it.
    const result = await invoke(
      adapter({
        built: { campaign: "c_1", ad_set: "s_1" },
        script: [acknowledged, acknowledged, status("PAUSED")],
      }),
    );

    expect(writes.map((write) => write.kind)).toEqual(["ad_set", "campaign"]);
    expect(result).toMatchObject({ status: "succeeded", externalReference: "s_1" });
  });

  it("keeps sweeping upward when one level rejects the pause", async () => {
    const result = await invoke(
      adapter({
        depth: "experiment",
        script: [
          failed("meta.400.OAuthException.100"),
          acknowledged,
          acknowledged,
          status("ADSET_PAUSED"),
        ],
      }),
    );

    expect(writes).toHaveLength(3);
    expect(result).toMatchObject({ status: "succeeded", providerStatus: "ADSET_PAUSED" });
  });

  it("refuses rather than reporting an all-clear when nothing is known to pause", async () => {
    const result = await invoke(adapter({ built: {}, script: [] }));

    expect(result).toEqual({ status: "failed", failureCode: "meta.ads.pause_target_unresolved" });
    expect(writes).toHaveLength(0);
  });

  it("never touches an object belonging to another action run", async () => {
    const ledger = vi.fn(async () => ({ ...FULL }));
    const instance = createMetaAdsPauseAdapter({
      client: {
        api: {} as never,
        guard: vi.fn(async ({ run }: { run: () => Promise<unknown> }) => {
          await run();
          return acknowledged;
        }),
        request: vi.fn(),
      } as never,
      ledger: { read: ledger },
      loadRequest: vi.fn(async () => ({ targetActionRunId: TARGET, depth: "ad" as const })),
    });

    await instance.invoke({
      organizationId: ORG,
      actionRunId: RUN,
      idempotencyKey: `action:${RUN}`,
      reservation: { amountMinor: null, currency: null },
      signal: new AbortController().signal,
    });

    // The pause run owns no provider objects; it reads the build's.
    expect(ledger).toHaveBeenCalledWith({ organizationId: ORG, actionRunId: TARGET });
  });

  it("is safe to run twice", async () => {
    const first = await invoke(adapter({ script: [acknowledged, status("PAUSED")] }));
    const second = await invoke(adapter({ script: [acknowledged, status("PAUSED")] }));

    // No ledger, no resume, no duplicate: the same request twice is the same
    // state. This is why a pause needs none of the build's machinery.
    expect(second).toEqual(first);
  });
});
