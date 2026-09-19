import { z } from "zod";

/**
 * The assembled business-performance card, cached per selected period.
 *
 * The figures a card aggregates are governed report rows -- what this cache
 * saves is re-reading and re-aggregating them on every visit to the same
 * period. Following ADR 0048 it holds answers, never verdicts about whether
 * an answer is current: every hit is revalidated against the live evidence
 * fingerprint by the caller, and a miss (or a failed revalidation) rebuilds
 * from the database. Redis holds no authority here.
 *
 * The fingerprint names the report arrival the card depends on. Card figures
 * come straight from governed rows, never from an analysis run, so a
 * completed run is no signal: only a changed evidence-window list -- a new
 * report filed, a window re-declared, a governed row count moved -- rebuilds
 * the card. The list is newest-first and capped like the picker's, so an
 * arrival always shifts it; an old window falling off the cap only causes an
 * extra rebuild, never a stale read. The TTL below stays as the backstop.
 */

/** An hour: a memory bound, not a correctness device. Revalidation decides. */
export const CARD_CACHE_TTL_SECONDS = 3600;
/**
 * Bumped when the card's source moved from analysed findings to governed
 * aggregates: v1 envelopes carry no evidence fingerprint and never validate.
 */
const CARD_CACHE_VERSION = "v2";

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
 * The envelope around a cached card. `builtAt` dates the answer;
 * `evidenceFingerprint` is the live currency verdict's anchor: a hit is
 * served only when the organization's evidence-window list still hashes to
 * the same value, so a newer report always rebuilds instead of reading stale.
 */
export const performanceCardEnvelopeSchema = z.object({
  builtAt: z.string(),
  evidenceFingerprint: z.string(),
  card: performanceCardViewSchema,
});

export type CachedPerformanceCardEnvelope = z.infer<typeof performanceCardEnvelopeSchema>;

/**
 * The report-arrival signal behind a cached card: one line per evidence
 * window, sorted so window order never matters, hashed so the envelope stays
 * small. Two 32-bit FNV-1a lanes rather than a cryptographic digest: this
 * only decides rebuild-vs-serve, and a collision merely serves a TTL-bounded
 * answer. Plain 32-bit arithmetic throughout, so the function runs wherever
 * the cache module is imported.
 */
export function evidenceFingerprint(
  windows: readonly {
    channelId: string;
    windowStart: string;
    windowEnd: string;
    grain: string;
    governedRowCount: number;
    sourceFilename: string | null;
  }[],
): string {
  const lines = windows
    .map(
      (window) =>
        `${window.channelId}|${window.windowStart}|${window.windowEnd}|${window.grain}|${window.governedRowCount}|${window.sourceFilename ?? ""}`,
    )
    .sort();
  let first = 0x811c9dc5;
  let second = 0x811c9dc5 ^ 0x9e3779b9;
  const feed = (code: number) => {
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x01000193) >>> 0;
  };
  for (const line of lines) {
    for (let index = 0; index < line.length; index += 1) {
      feed(line.charCodeAt(index));
    }
    feed(10);
  }
  return `${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}
