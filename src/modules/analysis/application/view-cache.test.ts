import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cacheGet: vi.fn(), cacheSet: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cache/redis", () => ({ cacheGet: mocks.cacheGet, cacheSet: mocks.cacheSet }));

import {
  analysisViewCacheKey,
  analysisViewPayloadSchema,
  readCachedRunPayload,
  type AnalysisViewPayload,
} from "@/modules/analysis/application/view-cache";

const key = {
  organizationId: "859cf039-1cd8-41b0-bd09-66c6c52e9c52",
  analysisRunId: "11111111-1111-4111-8111-111111111111",
  resultDigest: "a".repeat(64),
};

/** A minimal, schema-valid payload -- empty arrays are a valid completed run. */
const emptyPayload: AnalysisViewPayload = { findings: [], evidence: [], recommendations: [] };

/** A payload with one of everything, for tests that need real fields to check against. */
const populatedPayload: AnalysisViewPayload = {
  findings: [
    {
      id: "f1",
      analysisRunId: key.analysisRunId,
      channelId: "channel-1",
      branchId: null,
      detectorKey: "orders-cancellation-attribution",
      detectorVersion: 1,
      kind: "finding",
      code: "HIGH_CANCELLATION_SHARE",
      severity: "high",
      priority: 1,
      metricKey: "orders.cancelled",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      valueKind: "ratio",
      valueNumerator: 12,
      valueDenominator: 100,
      currency: null,
      monetaryImpactMinorUnits: null,
      expectedPeriodCount: 31,
      observedPeriodCount: 31,
      absentPeriodCount: 0,
      qualityState: "complete",
      needsDataReason: null,
      limitations: [],
      calculationDigest: "b".repeat(64),
      createdAt: "2026-09-01T00:00:00.000Z",
    },
  ],
  evidence: [
    {
      findingId: "f1",
      evidenceKind: "normalized_metric",
      evidenceRole: "subject_period",
      referenceId: "metric-1",
      metric: {
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
        numerator: 12,
        dimensions: { channel: "delivery" },
      },
    },
  ],
  recommendations: [
    {
      id: "r1",
      analysisRunId: key.analysisRunId,
      channelId: "channel-1",
      branchId: null,
      label: "recommendation",
      headline: "Cancellations are concentrated on Fridays",
      detail: "Twelve of a hundred orders cancelled, mostly on Friday evenings.",
      supportedActions: ["review_staffing"],
      limitations: [],
      resultDigest: key.resultDigest,
      citationFindingIds: ["f1"],
      createdAt: "2026-09-01T00:00:00.000Z",
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cacheGet.mockResolvedValue(null);
  mocks.cacheSet.mockResolvedValue(undefined);
});

describe("caching a completed run", () => {
  it("names the organization in the key, so no key is reachable across tenants", () => {
    expect(analysisViewCacheKey(key)).toContain(key.organizationId);
    expect(analysisViewCacheKey(key)).toContain(key.analysisRunId);
    expect(analysisViewCacheKey(key)).toContain(key.resultDigest);
  });

  it("loads from the database on a miss and stores the result", async () => {
    const load = vi.fn().mockResolvedValue(populatedPayload);

    await expect(readCachedRunPayload({ ...key, load })).resolves.toEqual(populatedPayload);
    expect(load).toHaveBeenCalledTimes(1);
    expect(mocks.cacheSet).toHaveBeenCalledWith(
      analysisViewCacheKey(key),
      populatedPayload,
      expect.any(Number),
    );
  });

  it("does not touch the database on a hit", async () => {
    mocks.cacheGet.mockResolvedValue(emptyPayload);
    const load = vi.fn();

    await expect(readCachedRunPayload({ ...key, load })).resolves.toEqual(emptyPayload);
    expect(load).not.toHaveBeenCalled();
  });

  it("changes key when the result digest changes", () => {
    // Two runs of the same id cannot exist, but a digest in the key means a
    // stored payload can never outlive the result it describes.
    expect(analysisViewCacheKey({ ...key, resultDigest: "b".repeat(64) })).not.toBe(
      analysisViewCacheKey(key),
    );
  });

  it("still answers from the database when the cache is down", async () => {
    // cacheGet fails open to null beneath this module (Task 6's job, not
    // re-tested here); this only proves readCachedRunPayload falls through
    // to load() the same way it does for an ordinary miss.
    mocks.cacheGet.mockResolvedValue(null);
    mocks.cacheSet.mockResolvedValue(undefined);
    const load = vi.fn().mockResolvedValue(emptyPayload);

    await expect(readCachedRunPayload({ ...key, load })).resolves.toEqual(emptyPayload);
  });

  it("passes its own schema, not a cast, to cacheGet", async () => {
    const load = vi.fn().mockResolvedValue(emptyPayload);

    await readCachedRunPayload({ ...key, load });

    expect(mocks.cacheGet).toHaveBeenCalledWith(
      analysisViewCacheKey(key),
      analysisViewPayloadSchema,
    );
  });
});

describe("the run's own decisions never enter the cached shape", () => {
  it("has no field anywhere in the payload schema that could carry a decision or a personal vote", () => {
    const recommendationShape = analysisViewPayloadSchema.shape.recommendations.element.shape;
    const fieldNames = Object.keys(recommendationShape);

    expect(fieldNames).not.toContain("decisions");
    expect(fieldNames).not.toContain("myFeedback");
    // Every field this schema does carry is the run's own immutable output.
    expect(fieldNames).toEqual([
      "id",
      "analysisRunId",
      "channelId",
      "branchId",
      "label",
      "headline",
      "detail",
      "supportedActions",
      "limitations",
      "resultDigest",
      "citationFindingIds",
      "createdAt",
    ]);
  });

  it("rejects a stored value where a recommendation carries a viewer's decisions -- a corrupt or stale-shape hit reads as a miss, not as a leak", () => {
    const smuggled = {
      ...populatedPayload,
      recommendations: [
        {
          ...populatedPayload.recommendations[0],
          decisions: [
            {
              recommendationId: "r1",
              decision: "dismissed",
              reason: "not relevant to this branch",
              snoozedUntil: null,
              actorId: "some-other-viewer",
              actorName: "Some Other Viewer",
              createdAt: "2026-09-02T00:00:00.000Z",
            },
          ],
        },
      ],
    };

    expect(analysisViewPayloadSchema.safeParse(smuggled).success).toBe(false);
  });

  it("rejects a stored value where a recommendation carries a viewer's feedback vote", () => {
    const smuggled = {
      ...populatedPayload,
      recommendations: [{ ...populatedPayload.recommendations[0], myFeedback: true }],
    };

    expect(analysisViewPayloadSchema.safeParse(smuggled).success).toBe(false);
  });

  it("accepts the same payload once the smuggled fields are removed, proving the rejection is about those fields and not something else", () => {
    expect(analysisViewPayloadSchema.safeParse(populatedPayload).success).toBe(true);
  });
});
