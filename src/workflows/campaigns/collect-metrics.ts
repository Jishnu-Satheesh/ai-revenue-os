import { z } from "zod";

import { logger } from "@/lib/logger";
import type {
  CampaignMetricIngest,
  CampaignMetricPoint,
  CampaignMetricSubject,
} from "@/modules/campaigns/infrastructure/metric-ingest";
import {
  ORGANIC_POST_METRIC_KEYS,
  type MetaMediaInsightsReader,
} from "@/modules/integrations/providers/meta/media-insights-reader";
import {
  DELIVERY_METRIC_KEYS,
  type MetaInsightsReader,
} from "@/modules/integrations/providers/meta/insights-reader";

/**
 * Returning provider results to the warehouse at variant grain.
 *
 * The loop is deliberately simple: find the subjects whose results are due,
 * check the organization actually holds a usable metrics-read grant, read the
 * bounded set the contract registers, and record each figure through the one
 * RPC that can write the grain. Nothing here decides what a result means —
 * that is the allocation and evidence loops' job, and they run on a different
 * cadence. This is the feedback arrow only.
 *
 * Three things are load-bearing.
 *
 * - The grant check precedes any provider call. `read_meta_metrics` is blocked
 *   until controlled-account evidence exists, so in production this loop
 *   records nothing rather than fetching from an account nobody verified.
 * - A gap is a gap. The reader emits `absent` for a metric the provider did not
 *   return, and it is recorded as absent, never imputed into a zero.
 * - The collection run id is stable across a sweep, so a re-run over a settled
 *   window is idempotent at the database: the RPC returns `unchanged` for a
 *   figure the provider repeated, and a second current answer cannot exist.
 */

export const collectMetricsPayloadSchema = z.strictObject({
  collectionRunId: z.string().uuid(),
  limit: z.number().int().positive().max(500).default(50),
});
export type CollectMetricsPayload = z.infer<typeof collectMetricsPayloadSchema>;

export type MetricCollectionSubject = {
  organizationId: string;
  campaignId: string;
  subject: CampaignMetricSubject;
  channel: string | null;
  /**
   * How this went out, which decides what can be asked about it.
   *
   * An ad reports delivery per day against money spent; an organic post reports
   * engagement as a lifetime running total and has no money in it. They are
   * different endpoints keyed by different identifiers, so a subject that could
   * not say which it was would have to be guessed at.
   */
  delivery: "organic" | "paid";
  /** The account currency, for converting a decimal spend into minor units. */
  currency: string;
  /** The timezone day boundaries are computed in. */
  timezone: string;
  /** The provider object id the reader fetches from (an ad id). */
  providerReference: string;
  /** Inclusive `YYYY-MM-DD` window the results are due for. */
  since: string;
  until: string;
};

export type MetricSubjectReader = {
  listDue(limit: number): Promise<readonly MetricCollectionSubject[]>;
};

export type MetricsGrantReader = {
  canRead(organizationId: string): Promise<boolean>;
};

/**
 * The two endpoints a campaign's results can come from.
 *
 * Kept together because they answer for the same organization with the same
 * credential, and apart because they are genuinely different questions: `ads`
 * reports delivery per day against money spent, `media` reports engagement as a
 * lifetime running total with no money in it.
 */
export type CampaignMetricReaders = {
  ads: MetaInsightsReader;
  media: MetaMediaInsightsReader;
};

export type CollectOutcome =
  | { result: "collected"; points: number }
  | { result: "blocked"; reasonCode: "meta.metrics_capability_blocked" }
  | { result: "failed"; failureCode: string }
  | { result: "unknown" };

export type CollectMetricsDependencies = {
  subjects: MetricSubjectReader;
  grants: MetricsGrantReader;
  /**
   * This organization's readers, or null when it has no usable connection.
   *
   * Resolved per organization for the same reason the Tool Gateway resolves an
   * adapter per organization: this sweep spans every tenant while a provider
   * credential belongs to exactly one. A single shared reader would read one
   * tenant's account and file the answers against everybody's posts.
   */
  readersFor(organizationId: string): Promise<CampaignMetricReaders | null>;
  ingest: CampaignMetricIngest;
  isCancelled: () => boolean;
  now?: () => Date;
};

export type CollectMetricsResult = {
  considered: number;
  collected: number;
  outcomes: readonly { subject: MetricCollectionSubject; outcome: CollectOutcome }[];
};

export async function collectCampaignMetrics(
  payload: CollectMetricsPayload,
  dependencies: CollectMetricsDependencies,
  signal: AbortSignal,
): Promise<CollectMetricsResult> {
  const now = dependencies.now ?? (() => new Date());
  const subjects = await dependencies.subjects.listDue(payload.limit);

  const outcomes: { subject: MetricCollectionSubject; outcome: CollectOutcome }[] = [];
  let collected = 0;

  for (const subject of subjects) {
    if (dependencies.isCancelled() || signal.aborted) break;

    if (!(await dependencies.grants.canRead(subject.organizationId))) {
      outcomes.push({
        subject,
        outcome: { result: "blocked", reasonCode: "meta.metrics_capability_blocked" },
      });
      continue;
    }

    const readers = await dependencies.readersFor(subject.organizationId);
    if (!readers) {
      // The grant usually catches this first. This is the narrower case where
      // permission exists but the connection behind it does not resolve, and it
      // is still a blocked outcome rather than a failure: nothing went wrong.
      outcomes.push({
        subject,
        outcome: { result: "blocked", reasonCode: "meta.metrics_capability_blocked" },
      });
      continue;
    }

    const read =
      subject.delivery === "organic"
        ? await readers.media.readMediaInsights(
            {
              // An organic exposure's provider reference is the post's own
              // media id. The ads edge would not recognise it.
              mediaId: subject.providerReference,
              // A lifetime total has no window of its own, so the reading is
              // filed under the day it was taken.
              observedOn: subject.until,
              timezone: subject.timezone,
              metricKeys: ORGANIC_POST_METRIC_KEYS,
            },
            signal,
          )
        : await readers.ads.readAdInsights(
            {
              adId: subject.providerReference,
              since: subject.since,
              until: subject.until,
              currency: subject.currency,
              timezone: subject.timezone,
              metricKeys: DELIVERY_METRIC_KEYS,
            },
            signal,
          );

    if (read.outcome === "unknown") {
      outcomes.push({ subject, outcome: { result: "unknown" } });
      continue;
    }
    if (read.outcome === "failed") {
      outcomes.push({ subject, outcome: { result: "failed", failureCode: read.failureCode } });
      continue;
    }

    const observedAt = now().toISOString();
    for (const point of read.points) {
      const record: CampaignMetricPoint = {
        organizationId: subject.organizationId,
        campaignId: subject.campaignId,
        subject: subject.subject,
        channel: subject.channel,
        metricKey: point.metricKey,
        periodStart: point.periodStart,
        periodEnd: point.periodEnd,
        periodTimezone: subject.timezone,
        presence: point.presence,
        valueMinor: point.valueMinor,
        currency: subject.currency,
        qualityTier: "measured",
        collectionRunId: payload.collectionRunId,
        observedAt,
      };
      await dependencies.ingest.record(record);
    }

    collected += 1;
    outcomes.push({ subject, outcome: { result: "collected", points: read.points.length } });
  }

  logger.info("campaign.metrics_collected", {
    // Counts only. Which subjects were touched belongs in their own rows.
    metricsRecorded: collected,
    metricsConsidered: subjects.length,
  });

  return { considered: subjects.length, collected, outcomes };
}
