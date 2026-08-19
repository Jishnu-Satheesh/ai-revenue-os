import "server-only";

import { z } from "zod";
import { TZDate } from "@date-fns/tz";

import { toMinorUnits } from "@/domain/reference/currencies";
import { nextPeriodStart } from "@/domain/metrics/periods";
import type { MetaGraphClient } from "@/modules/integrations/providers/meta/client";

/**
 * Reading back what an ad did, bounded to the three diagnostics the metric
 * registry declares.
 *
 * The contract registers exactly three delivery figures — impressions, clicks,
 * spend — and deliberately nothing else. Reach and frequency are absent because
 * they count unique people and cannot be summed across days, so registering
 * them with an additive aggregation would put a false number into vocabulary
 * every consumer trusts. This reader refuses any metric outside the three, and
 * it is the only path by which a provider figure becomes a platform figure.
 *
 * Money is converted here because this is where Meta's unit is known: Meta
 * returns `spend` as a decimal string in the account currency, the platform
 * stores integer minor units. Counts arrive as integer strings. Period
 * boundaries are computed in the caller's timezone, never UTC, for the same
 * reason the metric warehouse does it everywhere else — a Dubai day begins at
 * 20:00 UTC the evening before.
 */

export const DELIVERY_METRIC_KEYS = [
  "delivery.impressions",
  "delivery.clicks",
  "delivery.spend",
] as const;
export type DeliveryMetricKey = (typeof DELIVERY_METRIC_KEYS)[number];

/** Contract metric key → Meta Insights field. The only documented mapping. */
const META_FIELD_BY_METRIC: Readonly<
  Record<DeliveryMetricKey, "impressions" | "clicks" | "spend">
> = {
  "delivery.impressions": "impressions",
  "delivery.clicks": "clicks",
  "delivery.spend": "spend",
};

const insightsRowSchema = z.object({
  date_start: z.string(),
  date_stop: z.string(),
  impressions: z.string().optional(),
  clicks: z.string().optional(),
  spend: z.string().optional(),
});

/** The documented `<object>/insights` envelope. */
const insightsEdgeSchema = z.object({ data: z.array(insightsRowSchema) });

export type AdInsightsPoint = {
  metricKey: DeliveryMetricKey;
  /** Start of the day, in the caller's timezone, as an ISO instant. */
  periodStart: string;
  /** End of the day (exclusive), in the caller's timezone. */
  periodEnd: string;
  presence: "observed" | "absent";
  /** Integer in platform units: minor for money, whole for counts. Null when absent. */
  valueMinor: number | null;
};

export type ReadAdInsightsInput = {
  adId: string;
  /** Inclusive window, as `YYYY-MM-DD` calendar dates in the account timezone. */
  since: string;
  until: string;
  /** The account currency, so a decimal spend becomes integer minor units. */
  currency: string;
  /** The timezone day boundaries are computed in. */
  timezone: string;
  metricKeys: readonly DeliveryMetricKey[];
};

export type AdInsightsResult =
  | { outcome: "succeeded"; points: readonly AdInsightsPoint[] }
  | { outcome: "failed"; failureCode: string; retryable: boolean }
  | { outcome: "unknown"; reason: "timeout" | "transport" };

export type MetaInsightsReader = {
  readAdInsights(input: ReadAdInsightsInput, signal: AbortSignal): Promise<AdInsightsResult>;
};

export function createMetaInsightsReader(client: MetaGraphClient): MetaInsightsReader {
  return {
    async readAdInsights(input, signal) {
      if (input.metricKeys.length === 0) {
        return { outcome: "succeeded", points: [] };
      }

      const unknown = input.metricKeys.filter((key) => !(key in META_FIELD_BY_METRIC));
      if (unknown.length > 0) {
        // An undocumented field is unavailable, never inferred. A caller asking
        // for one has misunderstood what the contract registers.
        return {
          outcome: "failed",
          failureCode: "meta.insights.metric_unregistered",
          retryable: false,
        };
      }

      const fields = [...new Set(input.metricKeys.map((key) => META_FIELD_BY_METRIC[key]))];

      const result = await client.request({
        method: "GET",
        path: [input.adId, "insights"],
        params: {
          fields: fields.join(","),
          time_range: { since: input.since, until: input.until },
          time_increment: 1,
          limit: 250,
        },
        schema: insightsEdgeSchema,
        signal,
      });

      if (result.outcome === "unknown") return { outcome: "unknown", reason: result.reason };
      if (result.outcome === "failed") {
        return { outcome: "failed", failureCode: result.failureCode, retryable: result.retryable };
      }

      const points: AdInsightsPoint[] = [];
      for (const row of result.data.data) {
        const periodStart = localDayStart(row.date_start, input.timezone);
        const periodEnd = nextPeriodStart(periodStart, "day", input.timezone);

        for (const metricKey of input.metricKeys) {
          const raw = row[META_FIELD_BY_METRIC[metricKey]];
          const valueMinor =
            raw === undefined ? null : toValueMinor(metricKey, raw, input.currency);
          points.push({
            metricKey,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
            // An unreadable figure is not a figure. A metric the provider did
            // not return, and a figure that cannot be converted, are both
            // recorded as absent rather than as a guessed zero.
            presence: raw === undefined || valueMinor === null ? "absent" : "observed",
            valueMinor,
          });
        }
      }

      return { outcome: "succeeded", points };
    },
  };
}

function toValueMinor(metricKey: DeliveryMetricKey, raw: string, currency: string): number | null {
  if (metricKey === "delivery.spend") return toMinorUnits(raw, currency);
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

/** The instant local midnight of a `YYYY-MM-DD` calendar date falls on. */
function localDayStart(date: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(new TZDate(year, month - 1, day, 0, 0, 0, timeZone).getTime());
}
