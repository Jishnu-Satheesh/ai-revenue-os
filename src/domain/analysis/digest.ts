import { createHash } from "node:crypto";

import type { AnalysisWindow, DetectorOutcome } from "@/domain/analysis/types";

/**
 * Key order in a hashed object is not incidental. Two runs over identical
 * evidence must produce identical digests, and `JSON.stringify` preserves
 * insertion order, so an object built by a different code path would hash
 * differently while meaning the same thing.
 */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Identifies one finding: its inputs, and the version of the arithmetic that
 * produced it.
 *
 * The cited evidence ids are part of the identity, which is the point. The same
 * window analysed again after a correction lands cites different rows and
 * therefore digests differently, so an operator can tell a re-run that changed
 * nothing from one that changed the answer.
 */
export function createFindingCalculationDigest(input: {
  detectorKey: string;
  calculationVersion: number;
  window: AnalysisWindow;
  outcome: DetectorOutcome;
}): string {
  return createHash("sha256")
    .update(
      canonicalize({
        detectorKey: input.detectorKey,
        calculationVersion: input.calculationVersion,
        window: {
          organizationId: input.window.organizationId,
          channelId: input.window.channelId,
          branchId: input.window.branchId,
          windowStart: input.window.windowStart,
          windowEnd: input.window.windowEnd,
          grain: input.window.grain,
          timeZone: input.window.timeZone,
        },
        outcome: input.outcome,
      }),
    )
    .digest("hex");
}

/**
 * The monthly resolver version. A completed run is reusable only under the
 * resolver that bound it; bumping this retires every cached run at once.
 */
export const MONTHLY_ANALYSIS_RESOLVER_VERSION = 1;

/**
 * The content address of one monthly analysis: every input that could change
 * its answer, and nothing else. A late correction, a held reconciliation, a
 * supersession, or a newly projected row changes the evidence digest and
 * makes the prior run ineligible immediately. No TTL, no wall clock.
 */
export function createMonthlyAnalysisCacheKey(input: {
  organizationId: string;
  channelId: string | null;
  branchId: string | null;
  month: string;
  windowStart: string;
  windowEnd: string;
  timeZone: string;
  grain: "day" | "week" | "month" | "span";
  registryVersion: number;
  detectorVersions: readonly { key: string; calculationVersion: number }[];
  metricKeys: readonly string[];
  evidenceDigest: string;
}): string {
  return createHash("sha256")
    .update(
      canonicalize({
        resolverVersion: MONTHLY_ANALYSIS_RESOLVER_VERSION,
        organizationId: input.organizationId,
        channelId: input.channelId,
        branchId: input.branchId,
        month: input.month,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        timeZone: input.timeZone,
        grain: input.grain,
        registryVersion: input.registryVersion,
        detectorVersions: [...input.detectorVersions].sort((left, right) =>
          left.key.localeCompare(right.key),
        ),
        metricKeys: [...input.metricKeys].sort(),
        evidenceDigest: input.evidenceDigest,
      }),
    )
    .digest("hex");
}

/**
 * The fingerprint of the exact candidate evidence one analysis pass read.
 *
 * Built from the loader's output rather than from the database directly, so
 * the key the worker claims with always describes the evidence it is about
 * to analyse. Any new, corrected, superseded, or reconciled row changes the
 * loaded set and misses the cache. An empty month hashes its explicit empty
 * shape, so "no governed evidence" is a cacheable answer rather than a miss.
 */
export function createAnalysisEvidenceDigest(input: {
  points: readonly {
    normalizedMetricId: string;
    channelId: string;
    branchId: string | null;
    metricKey: string;
    grain: string;
    periodStart: string;
    periodEnd: string;
    periodTimezone: string;
    valueKind: string;
    numerator: number;
    currency: string | null;
    qualityTier: string;
    projectionRunId: string | null;
    dimensions: Readonly<Record<string, string>>;
  }[];
  exactRangePoints: readonly {
    exactRangeMetricObservationId: string;
    channelId: string;
    branchId: string | null;
    metricKey: string;
    periodStart: string;
    periodEnd: string;
    periodTimezone: string;
    valueKind: string;
    numerator: number;
    currency: string | null;
    projectionRunId: string | null;
  }[];
  incomparablePointCount: number;
  projectionRuns: readonly { projectionRunId: string; absentRowCount: number | null }[];
  heldEvidence: readonly {
    reconciliationId: string;
    projectionTarget: string;
    channelId: string | null;
    branchId: string | null;
    periodStart: string;
    periodEnd: string;
  }[];
}): string {
  return createHash("sha256")
    .update(
      canonicalize({
        points: [...input.points].sort((left, right) =>
          left.normalizedMetricId.localeCompare(right.normalizedMetricId),
        ),
        exactRangePoints: [...input.exactRangePoints].sort((left, right) =>
          left.exactRangeMetricObservationId.localeCompare(right.exactRangeMetricObservationId),
        ),
        incomparablePointCount: input.incomparablePointCount,
        projectionRuns: [...input.projectionRuns].map((run) => run.projectionRunId).sort(),
        heldEvidence: [...input.heldEvidence].map((held) => held.reconciliationId).sort(),
      }),
    )
    .digest("hex");
}

/** Identifies the whole pass, so a replayed run is recognisably the same answer. */
export function createAnalysisResultDigest(input: {
  registryVersion: number;
  findings: readonly { calculationDigest: string }[];
}): string {
  return createHash("sha256")
    .update(
      canonicalize({
        registryVersion: input.registryVersion,
        calculationDigests: input.findings.map((finding) => finding.calculationDigest),
      }),
    )
    .digest("hex");
}
