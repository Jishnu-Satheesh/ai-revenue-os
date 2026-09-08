import "server-only";

import { z } from "zod";

import { cacheGet, cacheSet } from "@/lib/cache/redis";

/**
 * A completed analysis run never changes, so its findings, its evidence and
 * its recommendation text can be held for as long as memory allows. The TTL
 * below is a memory bound, not a correctness device: there is no invalidation
 * to forget, because there is nothing that can go stale.
 *
 * What is deliberately *not* in here: the viewer's own accept and dismiss
 * decisions, or their own feedback vote. `loadRecommendationsForRun` reads
 * both per `actorId`/`viewerId`, so an assembled view carries "did *you* act
 * on this" and "did *you* find this useful". Storing either under a run id
 * would hand one operator's answers to every other operator who opens the
 * same range. Callers read decisions and feedback fresh, per person, and
 * merge them onto what comes back from here.
 *
 * `analysisViewPayloadSchema` enforces this structurally, not just by
 * convention: neither `decisions` nor `myFeedback` is a field the schema
 * knows about, and the recommendation shape is `.strict()`, so a stored value
 * that somehow carries either -- a bug in a future caller's `load`, or a
 * payload left over from a build that once cached them -- fails validation on
 * read. `cacheGet` already treats a failed validation as a miss, which is
 * exactly the outcome wanted: the database answers instead, and nobody's
 * decision is ever served to anybody else.
 *
 * Also deliberately not cached anywhere: the question "has this range been
 * analysed?". That is one indexed query, and caching it keyed on a date range
 * is exactly how a client is served an audit the reports have since
 * contradicted. See ADR 0043 and ADR 0047.
 */
const TTL_SECONDS = 7 * 24 * 60 * 60;

const detectorSeveritySchema = z.enum(["critical", "high", "medium", "low"]);
const findingKindSchema = z.enum(["observation", "finding", "needs_data"]);

const cachedFindingSchema = z
  .object({
    id: z.string(),
    analysisRunId: z.string(),
    channelId: z.string().nullable(),
    branchId: z.string().nullable(),
    detectorKey: z.string(),
    detectorVersion: z.number(),
    kind: findingKindSchema,
    code: z.string(),
    severity: detectorSeveritySchema.nullable(),
    priority: z.number().nullable(),
    metricKey: z.string().nullable(),
    periodStart: z.string().nullable(),
    periodEnd: z.string().nullable(),
    valueKind: z.enum(["money", "count", "ratio"]).nullable(),
    valueNumerator: z.number().nullable(),
    valueDenominator: z.number().nullable(),
    currency: z.string().nullable(),
    monetaryImpactMinorUnits: z.number().nullable(),
    expectedPeriodCount: z.number().nullable(),
    observedPeriodCount: z.number().nullable(),
    absentPeriodCount: z.number().nullable(),
    qualityState: z.enum(["complete", "partial"]),
    needsDataReason: z.string().nullable(),
    limitations: z.array(z.string()),
    calculationDigest: z.string(),
    createdAt: z.string(),
  })
  .strict();

const cachedEvidenceSchema = z
  .object({
    findingId: z.string(),
    evidenceKind: z.enum([
      "normalized_metric",
      "exact_range_metric_observation",
      "report_projection_reconciliation",
      "projection_run",
    ]),
    evidenceRole: z.enum([
      "subject_period",
      "prior_period",
      "component",
      "denominator",
      "held_evidence",
      "gap_count",
    ]),
    referenceId: z.string(),
    metric: z
      .object({
        periodStart: z.string(),
        periodEnd: z.string(),
        numerator: z.number(),
        dimensions: z.record(z.string(), z.string()),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * The run's own narration over its own findings -- headline, detail, its
 * citations and what it declares an operator could do. `.strict()` on
 * purpose: this is the one shape a viewer's private state (`decisions`,
 * `myFeedback`) could plausibly ride in on, so an unrecognised field here
 * fails the whole cached value rather than being silently forwarded.
 */
const cachedRecommendationSchema = z
  .object({
    id: z.string(),
    analysisRunId: z.string(),
    channelId: z.string(),
    branchId: z.string().nullable(),
    label: z.enum(["observation", "recommendation", "needs_data"]),
    headline: z.string(),
    detail: z.string(),
    supportedActions: z.array(z.string()),
    limitations: z.array(z.string()),
    resultDigest: z.string(),
    citationFindingIds: z.array(z.string()),
    createdAt: z.string(),
  })
  .strict();

export const analysisViewPayloadSchema = z
  .object({
    findings: z.array(cachedFindingSchema),
    evidence: z.array(cachedEvidenceSchema),
    recommendations: z.array(cachedRecommendationSchema),
  })
  .strict();

export type AnalysisViewPayload = z.infer<typeof analysisViewPayloadSchema>;

export function analysisViewCacheKey(input: {
  organizationId: string;
  analysisRunId: string;
  resultDigest: string;
}): string {
  // Organization-leading, so no key is reachable across tenants. The digest
  // is included so a re-analysed run (a new resultDigest for the same
  // analysisRunId cannot happen today, but nothing here should assume it
  // never will) can never serve its predecessor's answer.
  return `analysis:view:v1:${input.organizationId}:${input.analysisRunId}:${input.resultDigest}`;
}

export async function readCachedRunPayload(input: {
  organizationId: string;
  analysisRunId: string;
  resultDigest: string;
  load: () => Promise<AnalysisViewPayload>;
}): Promise<AnalysisViewPayload> {
  const key = analysisViewCacheKey(input);
  const cached = await cacheGet(key, analysisViewPayloadSchema);
  if (cached !== null) return cached;
  const loaded = await input.load();
  await cacheSet(key, loaded, TTL_SECONDS);
  return loaded;
}
