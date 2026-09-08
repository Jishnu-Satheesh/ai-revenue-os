import { describe, expect, it } from "vitest";

import {
  ANALYSIS_RESOLVER_VERSION,
  MONTHLY_ANALYSIS_RESOLVER_VERSION,
  createAnalysisEvidenceDigest,
  createMonthlyAnalysisCacheKey,
  createWindowAnalysisCacheKey,
} from "@/domain/analysis/digest";

const base = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  channelId: "22222222-2222-4222-8222-222222222222",
  branchId: null,
  month: "2026-02",
  windowStart: "2026-02-01",
  windowEnd: "2026-02-28",
  timeZone: "Asia/Dubai",
  grain: "day",
  registryVersion: 9,
  detectorVersions: [{ key: "revenue.window_gross", calculationVersion: 3 }],
  metricKeys: ["revenue.gross"],
  evidenceDigest: "a".repeat(64),
} as const;

describe("monthly analysis cache key", () => {
  it("is a stable sha256 hex value", () => {
    const first = createMonthlyAnalysisCacheKey({ ...base });
    const second = createMonthlyAnalysisCacheKey({ ...base });
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("pins the resolver version it was computed under", () => {
    expect(MONTHLY_ANALYSIS_RESOLVER_VERSION).toBe(1);
  });

  it("misses when any provenance input changes", () => {
    const hit = createMonthlyAnalysisCacheKey({ ...base });
    expect(createMonthlyAnalysisCacheKey({ ...base, month: "2026-03" })).not.toBe(hit);
    expect(createMonthlyAnalysisCacheKey({ ...base, timeZone: "Asia/Kolkata" })).not.toBe(hit);
    expect(createMonthlyAnalysisCacheKey({ ...base, grain: "week" })).not.toBe(hit);
    expect(createMonthlyAnalysisCacheKey({ ...base, registryVersion: 8 })).not.toBe(hit);
    expect(
      createMonthlyAnalysisCacheKey({
        ...base,
        detectorVersions: [{ key: "revenue.window_gross", calculationVersion: 4 }],
      }),
    ).not.toBe(hit);
    expect(
      createMonthlyAnalysisCacheKey({
        ...base,
        metricKeys: ["revenue.rejection_loss"],
      }),
    ).not.toBe(hit);
    expect(createMonthlyAnalysisCacheKey({ ...base, evidenceDigest: "b".repeat(64) })).not.toBe(
      hit,
    );
  });

  it("changes when the month bounds change but nothing else does", () => {
    const january = createMonthlyAnalysisCacheKey({ ...base, month: "2026-01" });
    const february = createMonthlyAnalysisCacheKey({ ...base, month: "2026-02" });
    expect(january).not.toBe(february);
  });

  it("orders detector and definition tuples before hashing", () => {
    const ordered = createMonthlyAnalysisCacheKey({
      ...base,
      detectorVersions: [
        { key: "a.first", calculationVersion: 1 },
        { key: "b.second", calculationVersion: 2 },
      ],
    });
    const reversed = createMonthlyAnalysisCacheKey({
      ...base,
      detectorVersions: [
        { key: "b.second", calculationVersion: 2 },
        { key: "a.first", calculationVersion: 1 },
      ],
    });
    expect(reversed).toBe(ordered);
  });
});

const evidencePoint = {
  normalizedMetricId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  channelId: "22222222-2222-4222-8222-222222222222",
  branchId: null,
  metricKey: "revenue.gross",
  grain: "day",
  periodStart: "2026-02-01",
  periodEnd: "2026-02-01",
  periodTimezone: "Asia/Dubai",
  valueKind: "money",
  numerator: 120000,
  currency: "AED",
  qualityTier: "measured",
  projectionRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  dimensions: {},
} as const;

const evidenceLoad = {
  points: [{ ...evidencePoint }],
  exactRangePoints: [],
  incomparablePointCount: 0,
  projectionRuns: [{ projectionRunId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", absentRowCount: 0 }],
  heldEvidence: [],
};

describe("analysis evidence digest", () => {
  it("is a stable sha256 hex value", () => {
    const first = createAnalysisEvidenceDigest(evidenceLoad);
    expect(first).toBe(createAnalysisEvidenceDigest(evidenceLoad));
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when the candidate evidence changes", () => {
    const digest = createAnalysisEvidenceDigest(evidenceLoad);
    // A corrected figure arrives as a new row the loader now returns.
    expect(
      createAnalysisEvidenceDigest({
        ...evidenceLoad,
        points: [{ ...evidencePoint, numerator: 130000 }],
      }),
    ).not.toBe(digest);
    // A newly projected row joins the candidate set.
    expect(
      createAnalysisEvidenceDigest({
        ...evidenceLoad,
        points: [
          { ...evidencePoint },
          { ...evidencePoint, normalizedMetricId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
        ],
      }),
    ).not.toBe(digest);
    // Held evidence resolving changes what the run may cite.
    expect(
      createAnalysisEvidenceDigest({
        ...evidenceLoad,
        heldEvidence: [
          {
            reconciliationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            projectionTarget: "period_grain",
            channelId: "22222222-2222-4222-8222-222222222222",
            branchId: null,
            periodStart: "2026-02-01",
            periodEnd: "2026-02-01",
          },
        ],
      }),
    ).not.toBe(digest);
  });

  it("treats an empty month as an explicit empty shape, not as missing input", () => {
    const empty = createAnalysisEvidenceDigest({
      points: [],
      exactRangePoints: [],
      incomparablePointCount: 0,
      projectionRuns: [],
      heldEvidence: [],
    });
    expect(empty).toMatch(/^[a-f0-9]{64}$/);
    expect(empty).not.toBe(createAnalysisEvidenceDigest(evidenceLoad));
  });
});

describe("createWindowAnalysisCacheKey", () => {
  const base = {
    organizationId: "859cf039-1cd8-41b0-bd09-66c6c52e9c52",
    channelId: "11111111-1111-4111-8111-111111111111",
    branchId: null,
    windowStart: "2026-01-01",
    windowEnd: "2026-01-04",
    timeZone: "Asia/Dubai",
    grain: "day" as const,
    registryVersion: 1,
    detectorVersions: [{ key: "revenue.window_gross", calculationVersion: 2 }],
    metricKeys: ["revenue.gross"],
    evidenceDigest: "a".repeat(64),
  };

  it("is a sha256 hex digest", () => {
    expect(createWindowAnalysisCacheKey(base)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is stable for the same question asked twice", () => {
    expect(createWindowAnalysisCacheKey(base)).toBe(createWindowAnalysisCacheKey(base));
  });

  it("changes when the window changes", () => {
    // The whole point. Four days and five days are different questions and
    // must never share a cached answer.
    expect(createWindowAnalysisCacheKey({ ...base, windowEnd: "2026-01-05" })).not.toBe(
      createWindowAnalysisCacheKey(base),
    );
  });

  it("changes when the evidence changes, so a correction is never served stale", () => {
    expect(createWindowAnalysisCacheKey({ ...base, evidenceDigest: "b".repeat(64) })).not.toBe(
      createWindowAnalysisCacheKey(base),
    );
  });

  it("ignores the order detectors and metric keys arrive in", () => {
    expect(
      createWindowAnalysisCacheKey({
        ...base,
        detectorVersions: [
          { key: "orders.cancellation_loss", calculationVersion: 1 },
          { key: "revenue.window_gross", calculationVersion: 2 },
        ],
        metricKeys: ["orders.cancelled", "revenue.gross"],
      }),
    ).toBe(
      createWindowAnalysisCacheKey({
        ...base,
        detectorVersions: [
          { key: "revenue.window_gross", calculationVersion: 2 },
          { key: "orders.cancellation_loss", calculationVersion: 1 },
        ],
        metricKeys: ["revenue.gross", "orders.cancelled"],
      }),
    );
  });

  it("does not collide with a key the monthly resolver would have produced", () => {
    // The real comparison, not a hash-shaped literal. January 2026 as a month
    // and January 2026 as a window are the same question asked two ways; the
    // two resolvers must still answer with different keys, or a run cached
    // under the retired scheme would be served for a window nobody analysed.
    const monthly = createMonthlyAnalysisCacheKey({
      ...base,
      month: "2026-01",
      windowStart: "2026-01-01",
      windowEnd: "2026-01-31",
    });
    const windowed = createWindowAnalysisCacheKey({
      ...base,
      windowStart: "2026-01-01",
      windowEnd: "2026-01-31",
    });

    expect(windowed).not.toBe(monthly);
  });

  it("pins the resolver version, so a deliberate invalidation stays deliberate", () => {
    // The sibling suite pins MONTHLY_ANALYSIS_RESOLVER_VERSION the same way.
    // Without this, `resolverVersion` could be dropped from the hashed object
    // entirely and every test would still pass -- and the one lever that can
    // invalidate every cached answer at once would be gone unnoticed.
    expect(ANALYSIS_RESOLVER_VERSION).toBe(2);
  });

  it("misses when the organization or channel changes", () => {
    // Tenant scope is part of the question's identity. The database also scopes
    // the lookup by organization, so this is the inner of two fences -- but a
    // key that ignored either would make the outer fence the only one.
    const key = createWindowAnalysisCacheKey(base);

    expect(
      createWindowAnalysisCacheKey({
        ...base,
        organizationId: "22222222-2222-4222-8222-222222222222",
      }),
    ).not.toBe(key);
    expect(
      createWindowAnalysisCacheKey({ ...base, channelId: "33333333-3333-4333-8333-333333333333" }),
    ).not.toBe(key);
  });
});
