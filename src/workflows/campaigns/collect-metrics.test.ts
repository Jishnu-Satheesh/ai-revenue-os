import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { AdInsightsResult } from "@/modules/integrations/providers/meta/insights-reader";
import {
  collectCampaignMetrics,
  collectMetricsPayloadSchema,
} from "@/workflows/campaigns/collect-metrics";

const SUBJECT = {
  organizationId: "a5000000-0000-4000-8000-000000000101",
  campaignId: "a5000000-0000-4000-8000-000000000301",
  subject: { kind: "creative_variant", variantId: "a5000000-0000-4000-8000-000000000801" } as const,
  channel: "instagram",
  currency: "AED",
  timezone: "Asia/Dubai",
  providerReference: "23840000000000000",
  since: "2026-08-18",
  until: "2026-08-19",
};

const POINT = {
  metricKey: "delivery.impressions" as const,
  periodStart: "2026-08-17T20:00:00.000Z",
  periodEnd: "2026-08-18T20:00:00.000Z",
  presence: "observed" as const,
  valueMinor: 4200,
};

const PAYLOAD = collectMetricsPayloadSchema.parse({
  collectionRunId: "a5000000-0000-4000-8000-000000000f01",
});

const signal = new AbortController().signal;

function deps(overrides: Partial<Parameters<typeof collectCampaignMetrics>[1]> = {}) {
  const ingest = {
    record: vi.fn(async () => ({ outcome: "recorded" as const, observationId: "x" })),
  };
  const reader = {
    readAdInsights: vi.fn(
      async (): Promise<AdInsightsResult> => ({ outcome: "succeeded", points: [POINT] }),
    ),
  };
  const grants = { canRead: vi.fn(async () => true) };
  const subjects = { listDue: vi.fn(async () => [SUBJECT]) };

  return {
    ingest,
    reader,
    grants,
    subjects,
    dependencies: {
      subjects,
      grants,
      reader: reader as never,
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
