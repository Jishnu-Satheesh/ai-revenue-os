import "server-only";

import { z } from "zod";
import { TZDate } from "@date-fns/tz";

import { nextPeriodStart } from "@/domain/metrics/periods";
import type { MetaGraphClient } from "@/modules/integrations/providers/meta/client";

/**
 * Reading back what an organic Instagram post did.
 *
 * Separate from the ads insights reader on purpose, because it is a different
 * endpoint answering a different question. An ad reports delivery per day
 * against money spent; a post reports engagement as a running total and has no
 * money in it at all. Pointing the ads reader at a media id would call the
 * wrong edge with the wrong identifier and quietly return nothing.
 *
 * Two provider facts shape everything here.
 *
 * The period is fixed. Meta's own reference says it "is automatically set to
 * `lifetime` in the request and cannot be changed", so every figure below is a
 * running total for the post rather than a figure for a day. That is why the
 * registry declares these with `last`: each collection supersedes the previous
 * reading, and nothing is ever summed. A reading is still stamped with the day
 * it was taken, so re-reading the same day corrects that day's answer while a
 * new day adds a new point — which is what makes growth visible.
 *
 * And `impressions` is gone. Meta deprecated it for media created after
 * 2024-07-02, which is every post this platform will ever publish. Nothing is
 * substituted for it: `reach` counts unique people and `views` counts plays,
 * and putting either behind a name that meant "times seen" would be a
 * different measurement wearing a trusted label.
 */

export const ORGANIC_POST_METRIC_KEYS = [
  "instagram.post_reach",
  "instagram.post_likes",
  "instagram.post_comments",
  "instagram.post_saved",
  "instagram.post_shares",
  "instagram.post_total_interactions",
  "instagram.post_profile_visits",
  "instagram.post_profile_activity",
  "instagram.post_reposts",
] as const;
export type OrganicPostMetricKey = (typeof ORGANIC_POST_METRIC_KEYS)[number];

/**
 * Contract metric key → the name Meta answers to. The only documented mapping.
 *
 * `likes` and `comments` rather than `total_likes` and `total_comments`: Meta's
 * reference says the totals "include engagement from promoted/boosted/ad
 * media" while these are "organic interaction metrics only". A post nobody paid
 * to promote must not report a number inflated by advertising.
 */
const META_FIELD_BY_METRIC: Readonly<Record<OrganicPostMetricKey, string>> = {
  "instagram.post_reach": "reach",
  "instagram.post_likes": "likes",
  "instagram.post_comments": "comments",
  "instagram.post_saved": "saved",
  "instagram.post_shares": "shares",
  "instagram.post_total_interactions": "total_interactions",
  "instagram.post_profile_visits": "profile_visits",
  "instagram.post_profile_activity": "profile_activity",
  "instagram.post_reposts": "reposts",
};

/** The documented `/{ig-media-id}/insights` envelope, bounded to what is used. */
const insightsEdgeSchema = z.object({
  data: z.array(
    z.object({
      name: z.string(),
      period: z.string().optional(),
      values: z.array(z.object({ value: z.number() })).optional(),
    }),
  ),
});

export type MediaInsightsPoint = {
  metricKey: OrganicPostMetricKey;
  /** Start of the day the reading was taken, in the caller's timezone. */
  periodStart: string;
  /** End of that day (exclusive). */
  periodEnd: string;
  presence: "observed" | "absent";
  /** A whole count. These metrics carry no money, so there is nothing to convert. */
  valueMinor: number | null;
};

export type MediaInsightsResult =
  | { outcome: "succeeded"; points: readonly MediaInsightsPoint[] }
  | { outcome: "failed"; failureCode: string; retryable: boolean }
  | { outcome: "unknown"; reason: "timeout" | "transport" };

export type ReadMediaInsightsInput = {
  /** The published post's own id, as the provider returned it on publish. */
  mediaId: string;
  /** The calendar date this reading is stamped with, `YYYY-MM-DD`. */
  observedOn: string;
  /** The timezone day boundaries are computed in. */
  timezone: string;
  metricKeys: readonly OrganicPostMetricKey[];
};

export type MetaMediaInsightsReader = {
  readMediaInsights(
    input: ReadMediaInsightsInput,
    signal: AbortSignal,
  ): Promise<MediaInsightsResult>;
};

export function createMetaMediaInsightsReader(client: MetaGraphClient): MetaMediaInsightsReader {
  return {
    async readMediaInsights(input, signal) {
      if (input.metricKeys.length === 0) {
        return { outcome: "succeeded", points: [] };
      }

      const unknown = input.metricKeys.filter((key) => !(key in META_FIELD_BY_METRIC));
      if (unknown.length > 0) {
        // An undocumented field is unavailable, never inferred. A caller asking
        // for one has misunderstood what the contract registers.
        return {
          outcome: "failed",
          failureCode: "meta.media_insights.metric_unregistered",
          retryable: false,
        };
      }

      const metrics = [...new Set(input.metricKeys.map((key) => META_FIELD_BY_METRIC[key]))];

      const result = await client.request({
        method: "GET",
        path: [input.mediaId, "insights"],
        // No period is sent. Meta fixes it at `lifetime` regardless, and asking
        // for something else would describe a request this reader does not make.
        params: { metric: metrics.join(",") },
        schema: insightsEdgeSchema,
        signal,
      });

      if (result.outcome === "unknown") return { outcome: "unknown", reason: result.reason };
      if (result.outcome === "failed") {
        return { outcome: "failed", failureCode: result.failureCode, retryable: result.retryable };
      }

      const returned = new Map<string, number | null>();
      for (const row of result.data.data) {
        const [first] = row.values ?? [];
        returned.set(row.name, first ? first.value : null);
      }

      const periodStart = localDayStart(input.observedOn, input.timezone);
      const periodEnd = nextPeriodStart(periodStart, "day", input.timezone);

      // Every requested metric produces a point, including the ones Meta left
      // out. A metric missing from the response is a recorded gap, not a row
      // that silently never existed — "asked and got nothing" and "nobody
      // asked" are different claims about the same post.
      const points = input.metricKeys.map((metricKey): MediaInsightsPoint => {
        const raw = returned.get(META_FIELD_BY_METRIC[metricKey]);
        const usable = typeof raw === "number" && Number.isInteger(raw);
        return {
          metricKey,
          periodStart: periodStart.toISOString(),
          periodEnd: periodEnd.toISOString(),
          presence: usable ? "observed" : "absent",
          valueMinor: usable ? raw : null,
        };
      });

      return { outcome: "succeeded", points };
    },
  };
}

/** The instant local midnight of a `YYYY-MM-DD` calendar date falls on. */
function localDayStart(date: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(new TZDate(year, month - 1, day, 0, 0, 0, timeZone).getTime());
}
