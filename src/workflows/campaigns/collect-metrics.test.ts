import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { AdInsightsResult } from "@/modules/integrations/providers/meta/insights-reader";
import {
  collectCampaignMetrics,
  collectMetricsPayloadSchema,
  type MetricCollectionSubject,
} from "@/workflows/campaigns/collect-metrics";

const SUBJECT: MetricCollectionSubject = {
  organizationId: "a5000000-0000-4000-8000-000000000101",
  campaignId: "a5000000-0000-4000-8000-000000000301",
  subject: { kind: "creative_variant", variantId: "a5000000-0000-4000-8000-000000000801" } as const,
  channel: "instagram",
  delivery: "paid" as const,
  currency: "AED",
  timezone: "Asia/Dubai",
  providerReference: "23840000000000000",
  since: "2026-08-18",
  until: "2026-08-19",
};

/** The same post, published organically. Its id is a media id, not an ad id. */
const ORGANIC_SUBJECT: MetricCollectionSubject = {
  ...SUBJECT,
  delivery: "organic" as const,
  providerReference: "17895695668004550",
};

const POINT = {
  metricKey: "delivery.impressions" as const,
  periodStart: "2026-08-17T20:00:00.000Z",
  periodEnd: "2026-08-18T20:00:00.000Z",
  presence: "observed" as const,
  valueMinor: 4200,
};

const ORGANIC_POINT = {
  metricKey: "instagram.post_reach" as const,
  periodStart: "2026-08-17T20:00:00.000Z",
  periodEnd: "2026-08-18T20:00:00.000Z",
  presence: "observed" as const,
  valueMinor: 1840,
};

const PAYLOAD = collectMetricsPayloadSchema.parse({
  collectionRunId: "a5000000-0000-4000-8000-000000000f01",
});

const signal = new AbortController().signal;

function deps(overrides: Partial<Parameters<typeof collectCampaignMetrics>[1]> = {}) {
  const ingest = {
    // Typed so `mock.calls[0][0]` is the recorded point rather than `never`.
    record: vi.fn<(point: Record<string, unknown>) => Promise<unknown>>(async () => ({
      outcome: "recorded" as const,
      observationId: "x",
    })),
  };
  const reader = {
    readAdInsights: vi.fn(
      async (): Promise<AdInsightsResult> => ({ outcome: "succeeded", points: [POINT] }),
    ),
  };
  const mediaReader = {
    readMediaInsights: vi.fn<(input: Record<string, unknown>) => Promise<unknown>>(async () => ({
      outcome: "succeeded" as const,
      points: [ORGANIC_POINT],
    })),
  };
  const grants = { canRead: vi.fn(async () => true) };
  const subjects = {
    listDue: vi.fn(async (): Promise<readonly MetricCollectionSubject[]> => [SUBJECT]),
  };

  const readersFor = vi.fn(async () => ({ ads: reader, media: mediaReader }));

  return {
    ingest,
    reader,
    mediaReader,
    readersFor,
    grants,
    subjects,
    dependencies: {
      subjects,
      grants,
      readersFor: readersFor as never,
      ingest: ingest as never,
      isCancelled: () => false,
      ...overrides,
    },
  };
}

describe("the loop honours the grant before any provider call", () => {
  it("records nothing when the organization has no metrics-read grant", async () => {
    const { dependencies, reader, ingest, grants } = deps();
    grants.canRead.mockResolvedValueOnce(false);

    const result = await collectCampaignMetrics(PAYLOAD, dependencies, signal);

    expect(reader.readAdInsights).not.toHaveBeenCalled();
    expect(ingest.record).not.toHaveBeenCalled();
    expect(result.outcomes).toEqual([
      {
        subject: SUBJECT,
        outcome: { result: "blocked", reasonCode: "meta.metrics_capability_blocked" },
      },
    ]);
  });
});

describe("a successful read is recorded at the subject's grain", () => {
  it("hands each point to the ingest with the subject, timezone and run id", async () => {
    const { dependencies, ingest } = deps();

    const result = await collectCampaignMetrics(PAYLOAD, dependencies, signal);

    expect(result.collected).toBe(1);
    expect(ingest.record).toHaveBeenCalledTimes(1);
    expect(ingest.record).toHaveBeenCalledWith({
      organizationId: SUBJECT.organizationId,
      campaignId: SUBJECT.campaignId,
      subject: SUBJECT.subject,
      channel: "instagram",
      metricKey: "delivery.impressions",
      periodStart: "2026-08-17T20:00:00.000Z",
      periodEnd: "2026-08-18T20:00:00.000Z",
      periodTimezone: "Asia/Dubai",
      presence: "observed",
      valueMinor: 4200,
      currency: "AED",
      qualityTier: "measured",
      collectionRunId: PAYLOAD.collectionRunId,
      observedAt: expect.any(String),
    });
  });
});

describe("a read that did not succeed is reported, never recorded", () => {
  it("surfaces a failed read with its failure code", async () => {
    const { dependencies, reader, ingest } = deps();
    reader.readAdInsights.mockResolvedValueOnce({
      outcome: "failed",
      failureCode: "meta.400.OAuthException.190",
      retryable: false,
    });

    const result = await collectCampaignMetrics(PAYLOAD, dependencies, signal);

    expect(ingest.record).not.toHaveBeenCalled();
    expect(result.outcomes).toEqual([
      {
        subject: SUBJECT,
        outcome: { result: "failed", failureCode: "meta.400.OAuthException.190" },
      },
    ]);
  });

  it("leaves an unknown outcome for reconciliation rather than guessing", async () => {
    const { dependencies, reader, ingest } = deps();
    reader.readAdInsights.mockResolvedValueOnce({ outcome: "unknown", reason: "timeout" });

    const result = await collectCampaignMetrics(PAYLOAD, dependencies, signal);

    expect(ingest.record).not.toHaveBeenCalled();
    expect(result.outcomes).toEqual([{ subject: SUBJECT, outcome: { result: "unknown" } }]);
  });
});

describe("the loop stands down when asked", () => {
  it("stops before the first provider call when already cancelled", async () => {
    const { dependencies, subjects, reader } = deps({ isCancelled: () => true });

    const result = await collectCampaignMetrics(PAYLOAD, dependencies, signal);

    // Listing is the cheap read; the fence is what stops the provider call.
    expect(subjects.listDue).toHaveBeenCalledTimes(1);
    expect(reader.readAdInsights).not.toHaveBeenCalled();
    expect(result.considered).toBe(1);
    expect(result.collected).toBe(0);
  });
});

describe("an organic post is asked the question it can answer", () => {
  it("reads an organic post from the media insights edge, not the ads edge", async () => {
    const { dependencies, reader, mediaReader, subjects } = deps();
    subjects.listDue.mockResolvedValueOnce([ORGANIC_SUBJECT]);

    await collectCampaignMetrics(PAYLOAD, dependencies, signal);

    // The provider reference on an organic exposure is a media id. Handing it
    // to the ads edge would query the wrong object entirely and return nothing,
    // which would read as "measured, and there was nothing".
    expect(reader.readAdInsights).not.toHaveBeenCalled();
    expect(mediaReader.readMediaInsights).toHaveBeenCalledTimes(1);
    expect(mediaReader.readMediaInsights.mock.calls[0]?.[0]).toMatchObject({
      mediaId: "17895695668004550",
    });
  });

  it("still reads a paid subject from the ads edge", async () => {
    const { dependencies, reader, mediaReader } = deps();

    await collectCampaignMetrics(PAYLOAD, dependencies, signal);

    expect(reader.readAdInsights).toHaveBeenCalledTimes(1);
    expect(mediaReader.readMediaInsights).not.toHaveBeenCalled();
  });

  it("stamps an organic reading with the day it was taken", async () => {
    const { dependencies, mediaReader, subjects } = deps();
    subjects.listDue.mockResolvedValueOnce([ORGANIC_SUBJECT]);

    await collectCampaignMetrics(PAYLOAD, dependencies, signal);

    // A lifetime total has no window of its own, so the reading is filed under
    // the day it was read. `until` is that day.
    expect(mediaReader.readMediaInsights.mock.calls[0]?.[0]).toMatchObject({
      observedOn: ORGANIC_SUBJECT.until,
      timezone: "Asia/Dubai",
    });
  });

  it("records what an organic post reports", async () => {
    const { dependencies, ingest, subjects } = deps();
    subjects.listDue.mockResolvedValueOnce([ORGANIC_SUBJECT]);

    const result = await collectCampaignMetrics(PAYLOAD, dependencies, signal);

    expect(ingest.record).toHaveBeenCalledTimes(1);
    expect(ingest.record.mock.calls[0]?.[0]).toMatchObject({
      metricKey: "instagram.post_reach",
      presence: "observed",
    });
    expect(result.collected).toBe(1);
  });

  it("honours the grant before an organic read too", async () => {
    const { dependencies, mediaReader, grants, subjects } = deps();
    subjects.listDue.mockResolvedValueOnce([ORGANIC_SUBJECT]);
    grants.canRead.mockResolvedValueOnce(false);

    await collectCampaignMetrics(PAYLOAD, dependencies, signal);

    expect(mediaReader.readMediaInsights).not.toHaveBeenCalled();
  });

  it("keeps an unknown organic read unknown", async () => {
    const { dependencies, mediaReader, ingest, subjects } = deps();
    subjects.listDue.mockResolvedValueOnce([ORGANIC_SUBJECT]);
    mediaReader.readMediaInsights.mockResolvedValueOnce({
      outcome: "unknown",
      reason: "timeout",
    } as never);

    const result = await collectCampaignMetrics(PAYLOAD, dependencies, signal);

    expect(ingest.record).not.toHaveBeenCalled();
    expect(result.outcomes[0]?.outcome).toEqual({ result: "unknown" });
  });
});

describe("each organization's results come from its own connection", () => {
  it("resolves readers for the organization the subject belongs to", async () => {
    const { dependencies, readersFor } = deps();

    await collectCampaignMetrics(PAYLOAD, dependencies, signal);

    // One shared reader across a cross-tenant sweep would read one account and
    // file its answers against everybody's posts.
    expect(readersFor).toHaveBeenCalledWith(SUBJECT.organizationId);
  });

  it("blocks rather than fails when the connection cannot be resolved", async () => {
    const { dependencies, ingest, readersFor } = deps();
    readersFor.mockResolvedValueOnce(null as never);

    const result = await collectCampaignMetrics(PAYLOAD, dependencies, signal);

    // Nothing went wrong; the organization simply has nothing to read from.
    expect(ingest.record).not.toHaveBeenCalled();
    expect(result.outcomes[0]?.outcome).toEqual({
      result: "blocked",
      reasonCode: "meta.metrics_capability_blocked",
    });
  });
});
