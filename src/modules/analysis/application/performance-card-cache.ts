import { z } from "zod";

/**
 * The assembled business-performance card, cached per selected period.
 *
 * The findings a card aggregates are already durable rows -- what this cache
 * saves is re-reading and re-aggregating them on every visit to the same
 * period. Following ADR 0048 it holds answers, never verdicts about whether
 * an answer is current: every hit is revalidated against a live
 * completed-since query by the caller, and a miss (or a failed revalidation)
 * rebuilds from the database. Redis holds no authority here.
 */

/** An hour: a memory bound, not a correctness device. Revalidation decides. */
export const CARD_CACHE_TTL_SECONDS = 3600;
const CARD_CACHE_VERSION = "v1";

const rangeSchema = z.object({ from: z.string(), to: z.string() });
const cardMoneySchema = z.object({ minorUnits: z.number(), currency: z.string() });
const tileValueSchema = z.union([
  z.object({ kind: z.literal("money"), money: cardMoneySchema }),
  z.object({ kind: z.literal("count"), value: z.number() }),
]);
const tileSchema = z.object({
  id: z.enum(["sales", "orders", "views", "cancelled"]),
  value: tileValueSchema.nullable(),
  unavailableReason: z.string().nullable(),
  deltaPercent: z.number().nullable(),
  deltaLabel: z.string().nullable(),
  deltaAbsentReason: z.string().nullable(),
  footnote: z.string().nullable(),
});
const trendSchema = z.union([
  z.object({
    state: z.literal("ready"),
    buckets: z.array(z.object({ label: z.string(), minorUnits: z.number() })),
    currency: z.string(),
    coverageNote: z.string(),
  }),
  z.object({
    state: z.literal("empty"),
    reason: z.string(),
    weeks: z.array(z.string()),
  }),
]);
const sharesSchema = z.object({
  rows: z.array(
    z.object({
      channelId: z.string(),
      displayName: z.string(),
      minorUnits: z.number(),
      currency: z.string(),
      sharePercent: z.number(),
    }),
  ),
  totalMinorUnits: z.number(),
  currency: z.string(),
});

export const performanceCardViewSchema = z.object({
  month: rangeSchema,
  previous: rangeSchema,
  channelCount: z.number(),
  headline: z.string(),
  tiles: z.object({
    sales: tileSchema,
    orders: tileSchema,
    views: tileSchema,
    cancelled: tileSchema,
  }),
  cancelledShare: z.object({ percent: z.number(), pointChange: z.number().nullable() }).nullable(),
  trend: trendSchema,
  shares: sharesSchema.nullable(),
  sharesAbsentReason: z.string().nullable(),
  footer: z.string(),
  sources: z.object({
    reportingPeriod: z.string(),
    scope: z.string(),
    salesOrdersNote: z.string(),
    menuViewsNote: z.string(),
    costNote: z.string(),
    reportFiles: z.array(z.string()),
  }),
  fulfillment: z.object({
    ordersPlaced: z.number().nullable(),
    ordersAbsentReason: z.string().nullable(),
    cancelled: z.number().nullable(),
    cancelledAbsentReason: z.string().nullable(),
  }),
});

/**
 * One card, one key. Every segment is caller-supplied, so each is
 * lower-cased and fenced to its own position: a channel id can never drift
 * into the organization slot, and one organization's range never answers
 * another's.
 */
export function performanceCardCacheKey(input: {
  organizationId: string;
  from: string;
  to: string;
  channelId: string | null;
  branchId: string | null;
}): string {
  const scope = `${input.channelId ?? "all"}:${input.branchId ?? "all"}`;
  return `gi:perf-card:${CARD_CACHE_VERSION}:${input.organizationId.toLowerCase()}:${input.from}:${input.to}:${scope.toLowerCase()}`;
}

/**
 * The envelope around a cached card. `builtAt` is the live currency
 * verdict's anchor: a hit is served only when no run completed inside the
 * card's date box after it, so a newer analysis always rebuilds instead of
 * reading stale.
 */
export const performanceCardEnvelopeSchema = z.object({
  builtAt: z.string(),
  card: performanceCardViewSchema,
});

export type CachedPerformanceCardEnvelope = z.infer<typeof performanceCardEnvelopeSchema>;
