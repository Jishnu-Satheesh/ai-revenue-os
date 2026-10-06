import { describe, expect, it } from "vitest";

import { buildBusinessPerformanceCard } from "@/modules/analysis/application/channels-overview";
import {
  evidenceFingerprint,
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
    ).toBe("gi:perf-card:v2:2dda45b8-82db-4f5f-b17d-611b9bbb7846:2026-01-01:2026-02-28:all:all");
    expect(
      performanceCardCacheKey({
        organizationId: "2dda45b8-82db-4f5f-b17d-611b9bbb7846",
        from: "2026-01-01",
        to: "2026-02-28",
        channelId: "CH-1",
        branchId: "BR-1",
      }),
    ).toBe("gi:perf-card:v2:2dda45b8-82db-4f5f-b17d-611b9bbb7846:2026-01-01:2026-02-28:ch-1:br-1");
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
      currentAggregates: [],
      previousAggregates: [],
      locationCount: 0,
      channelScopeName: null,
      locationScopeName: null,
      reportFiles: [],
    });
    expect(performanceCardViewSchema.safeParse(card).success).toBe(true);
    expect(performanceCardViewSchema.safeParse({ headline: "stale" }).success).toBe(false);
    expect(performanceCardViewSchema.safeParse(null).success).toBe(false);
  });

  it("carries the built-at anchor and the evidence fingerprint the page checks", () => {
    const card = buildBusinessPerformanceCard({
      month: { from: "2026-02-01", to: "2026-02-28" },
      channels: [],
      currentAggregates: [],
      previousAggregates: [],
      locationCount: 0,
      channelScopeName: null,
      locationScopeName: null,
      reportFiles: [],
    });
    expect(
      performanceCardEnvelopeSchema.safeParse({
        builtAt: "2026-03-01T00:00:00.000Z",
        evidenceFingerprint: evidenceFingerprint([]),
        card,
      }).success,
    ).toBe(true);
    // A v1 envelope without the fingerprint never validates.
    expect(
      performanceCardEnvelopeSchema.safeParse({
        builtAt: "2026-03-01T00:00:00.000Z",
        card: "not-a-card",
      }).success,
    ).toBe(false);
  });
});

describe("evidenceFingerprint", () => {
  const windows = [
    {
      channelId: "ch-1",
      windowStart: "2026-01-01",
      windowEnd: "2026-02-28",
      grain: "day",
      governedRowCount: 20,
      sourceFilename: "Talabat-Jan-Feb.xlsx",
    },
    {
      channelId: "ch-2",
      windowStart: "2026-02-01",
      windowEnd: "2026-02-28",
      grain: "month",
      governedRowCount: 4,
      sourceFilename: null,
    },
  ];

  it("is stable and ignores window order", () => {
    expect(evidenceFingerprint(windows)).toBe(evidenceFingerprint([...windows].reverse()));
    expect(evidenceFingerprint(windows)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("moves when a report arrives or a window changes", () => {
    const arrived = [
      ...windows,
      {
        channelId: "ch-1",
        windowStart: "2026-03-01",
        windowEnd: "2026-03-31",
        grain: "month",
        governedRowCount: 6,
        sourceFilename: "Talabat-Mar.xlsx",
      },
    ];
    expect(evidenceFingerprint(arrived)).not.toBe(evidenceFingerprint(windows));
    const recount = windows.map((window) =>
      window.channelId === "ch-1" ? { ...window, governedRowCount: 21 } : window,
    );
    expect(evidenceFingerprint(recount)).not.toBe(evidenceFingerprint(windows));
  });
});
