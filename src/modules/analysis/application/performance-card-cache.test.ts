import { describe, expect, it } from "vitest";

import { buildBusinessPerformanceCard } from "@/modules/analysis/application/channels-overview";
import {
  performanceCardCacheKey,
  performanceCardEnvelopeSchema,
  performanceCardViewSchema,
} from "@/modules/analysis/application/performance-card-cache";

describe("performanceCardCacheKey", () => {
  it("namespaces every segment so scopes cannot collide", () => {
    expect(
      performanceCardCacheKey({
        organizationId: "2DDA45B8-82DB-4F5F-B17D-611B9BBB7846",
        from: "2026-01-01",
        to: "2026-02-28",
        channelId: null,
        branchId: null,
      }),
    ).toBe("gi:perf-card:v1:2dda45b8-82db-4f5f-b17d-611b9bbb7846:2026-01-01:2026-02-28:all:all");
    expect(
      performanceCardCacheKey({
        organizationId: "2dda45b8-82db-4f5f-b17d-611b9bbb7846",
        from: "2026-01-01",
        to: "2026-02-28",
        channelId: "CH-1",
        branchId: "BR-1",
      }),
    ).toBe("gi:perf-card:v1:2dda45b8-82db-4f5f-b17d-611b9bbb7846:2026-01-01:2026-02-28:ch-1:br-1");
  });

  it("never answers one organization with another's card", () => {
    const keyFor = (organizationId: string) =>
      performanceCardCacheKey({
        organizationId,
        from: "2026-01-01",
        to: "2026-02-28",
        channelId: null,
        branchId: null,
      });
    expect(keyFor("11111111-1111-4111-8111-111111111111")).not.toBe(
      keyFor("22222222-2222-4222-8222-222222222222"),
    );
  });
});

describe("performanceCardViewSchema", () => {
  it("accepts the builder's own output and rejects anything else", () => {
    const card = buildBusinessPerformanceCard({
      month: { from: "2026-02-01", to: "2026-02-28" },
      channels: [],
      current: new Map(),
      previous: new Map(),
      trendWeeks: [],
      locationCount: 0,
      channelScopeName: null,
      locationScopeName: null,
      reportFiles: [],
    });
    expect(performanceCardViewSchema.safeParse(card).success).toBe(true);
    expect(performanceCardViewSchema.safeParse({ headline: "stale" }).success).toBe(false);
    expect(performanceCardViewSchema.safeParse(null).success).toBe(false);
  });

  it("carries the built-at anchor the revalidation query reads", () => {
    expect(
      performanceCardEnvelopeSchema.safeParse({
        builtAt: "2026-03-01T00:00:00.000Z",
        card: "not-a-card",
      }).success,
    ).toBe(false);
  });
});
