import { createHash } from "node:crypto";

import { z } from "zod";

import {
  createAnalysisResultDigest,
  createFindingCalculationDigest,
} from "@/domain/analysis/digest";
import { ChannelAnalysisError } from "@/domain/analysis/errors";
import {
  CHANNEL_ANALYSIS_REGISTRY_VERSION,
  requiredMetricKeys,
  runDetectors,
  selectDetectors,
  type AttributedOutcome,
} from "@/domain/analysis/registry";
import type {
  AnalysisEvidence,
  AnalysisExactRangePoint,
  AnalysisHeldEvidence,
  AnalysisProjectionRun,
  AnalysisSeriesPoint,
  AnalysisWindow,
} from "@/domain/analysis/types";

/**
 * The channel analysis worker.
 *
 * The same shape as the report projection worker, for the same reason: claim a
 * lease, read the evidence under it, compute deterministically, and hand the
 * result to a fenced database function that checks every rule again. The worker
 * is not the authority on what may be recorded as a finding.
 *
 * See `specs/018-governed-channel-intelligence.md` section 11 and ADR 0031.
 */

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const channelAnalysisTaskSchema = z
  .object({
    organizationId: z.string().uuid(),
    /** Null asks how the channels compare; a value asks about one of them. */
    channelId: z.string().uuid().nullable(),
    branchId: z.string().uuid().nullable(),
    /** Inclusive local dates. Supplied by the caller, never inferred. */
    windowStart: localDate,
    windowEnd: localDate,
    periodGrain: z.enum(["day", "week", "month"]),
    analysisRunId: z.string().uuid(),
    correlationId: z.string().uuid(),
    idempotencyKey: z.string().trim().min(16).max(200),
  })
  .strict();

export type ChannelAnalysisPayload = z.infer<typeof channelAnalysisTaskSchema>;

/** Every code `fail_channel_analysis` will accept. */
export type ChannelAnalysisFailureCode =
  | "EVIDENCE_UNAVAILABLE"
  | "WINDOW_CONTEXT_UNAVAILABLE"
  | "DETECTOR_REGISTRY_MISMATCH"
  | "ANALYSIS_PROCESSING_FAILED";

export class ChannelAnalysisFailure extends Error {
  constructor(public readonly code: ChannelAnalysisFailureCode) {
    super(code);
    this.name = "ChannelAnalysisFailure";
  }
}

export type ChannelAnalysisEvidenceLoad = {
  points: readonly AnalysisSeriesPoint[];
  /**
   * Totals covering a whole declared span, from providers that report one
   * figure per export rather than one per day. Empty for most of them.
   */
  exactRangePoints: readonly AnalysisExactRangePoint[];
  incomparablePointCount: number;
  projectionRuns: readonly AnalysisProjectionRun[];
  heldEvidence: readonly AnalysisHeldEvidence[];
};

type FindingPayload = {
  detectorKey: string;
  detectorVersion: number;
  kind: string;
  code: string;
  severity?: string;
  priority?: number;
  channelId?: string;
  branchId?: string;
  metricKey?: string;
  periodStart?: string;
  periodEnd?: string;
  valueKind?: string;
  /** Integer strings, so nothing is rounded on its way through JSON. */
  valueNumerator?: string;
  valueDenominator?: string;
  currency?: string;
  monetaryImpactMinorUnits?: string;
  expectedPeriodCount?: number;
  observedPeriodCount?: number;
  absentPeriodCount?: number;
  qualityState: "complete" | "partial";
  needsDataReason?: string;
  limitations: readonly string[];
  calculationDigest: string;
  evidence: readonly { kind: string; role: string; id: string }[];
};

export type ChannelAnalysisDependencies = {
  claim(input: {
    organizationId: string;
    channelId: string | null;
    branchId: string | null;
    windowStart: string;
    windowEnd: string;
    periodGrain: "day" | "week" | "month";
    analysisRunId: string;
    registryVersion: number;
    detectors: readonly { key: string; calculationVersion: number }[];
    metricKeys: readonly string[];
    idempotencyKey: string;
    claimToken: string;
    correlationId: string;
  }): Promise<
    | {
        outcome: "acquired";
        windowTimezone: string;
        boundDetectors: readonly { key: string; calculationVersion: number }[];
      }
    | { outcome: "completed" | "not_found" | "not_ready" | "in_progress" | "conflict" }
  >;
  loadEvidence(input: {
    window: AnalysisWindow;
    metricKeys: readonly string[];
  }): Promise<ChannelAnalysisEvidenceLoad>;
  complete(input: {
    organizationId: string;
    analysisRunId: string;
    claimToken: string;
    resultDigest: string;
    findings: readonly FindingPayload[];
  }): Promise<void>;
  fail(input: {
    organizationId: string;
    analysisRunId: string;
    claimToken: string;
    code: ChannelAnalysisFailureCode;
    resultDigest: string;
  }): Promise<void>;
};

function failureDigest(code: string): string {
  // The same shape the projection worker uses: a failure still has to carry a
  // digest, and it identifies the failure rather than pretending to identify a
  // result nobody computed.
  return createHash("sha256").update(`channel-analysis-failure:${code}`).digest("hex");
}

function toFindingPayload(window: AnalysisWindow, attributed: AttributedOutcome): FindingPayload {
  const { detector, outcome } = attributed;
  const measurement = outcome.kind === "needs_data" ? undefined : outcome.measurement;

  // A figure that has stopped being exact must not be recorded behind a digest
  // that claims it is reproducible. Money and counts are held to safe integers;
  // a ratio's two parts may carry exactly the decimals the ledger holds, because
  // the provider measured closed minutes as `34216.93` and rounding them here
  // would fabricate time nobody lost (ADR 0036). Anything non-finite, or beyond
  // the exact integer range, is refused in either shape.
  const isRatio = measurement?.valueKind === "ratio";
  for (const [value, fractionAllowed] of [
    [measurement?.numerator, isRatio],
    [measurement?.denominator, isRatio],
    [measurement?.monetaryImpactMinorUnits, false],
  ] as const) {
    if (value === undefined) continue;
    if (fractionAllowed) {
      if (!Number.isFinite(value) || Math.abs(value) >= Number.MAX_SAFE_INTEGER) {
        throw new ChannelAnalysisError("VALUE_NOT_EXACT");
      }
    } else if (!Number.isSafeInteger(value)) {
      throw new ChannelAnalysisError("VALUE_NOT_EXACT");
    }
  }

  return {
    detectorKey: detector.key,
    detectorVersion: detector.calculationVersion,
    kind: outcome.kind,
    code: outcome.code,
    severity: outcome.kind === "finding" ? outcome.severity : undefined,
    priority: outcome.kind === "finding" ? outcome.priority : undefined,
    channelId: outcome.channelId,
    branchId: outcome.branchId,
    metricKey: outcome.metricKey,
    periodStart: outcome.periodStart,
    periodEnd: outcome.periodEnd,
    valueKind: measurement?.valueKind,
    valueNumerator: measurement === undefined ? undefined : String(measurement.numerator),
    valueDenominator:
      measurement?.denominator === undefined ? undefined : String(measurement.denominator),
    currency: measurement?.currency,
    monetaryImpactMinorUnits:
      measurement?.monetaryImpactMinorUnits === undefined
        ? undefined
        : String(measurement.monetaryImpactMinorUnits),
    expectedPeriodCount: outcome.expectedPeriodCount,
    observedPeriodCount: outcome.observedPeriodCount,
    absentPeriodCount: outcome.absentPeriodCount,
    qualityState: outcome.qualityState,
    needsDataReason: outcome.kind === "needs_data" ? outcome.needsDataReason : undefined,
    limitations: outcome.limitations,
    calculationDigest: createFindingCalculationDigest({
      detectorKey: detector.key,
      calculationVersion: detector.calculationVersion,
      window,
      outcome,
    }),
    evidence: outcome.evidence,
  };
}

export async function runChannelAnalysis(
  input: unknown,
  dependencies: ChannelAnalysisDependencies,
): Promise<{
  outcome: string;
  findingCount?: number;
  observationCount?: number;
  needsDataCount?: number;
}> {
  const payload = channelAnalysisTaskSchema.parse(input);
  if (payload.windowEnd < payload.windowStart) throw new ChannelAnalysisError("INVALID_WINDOW");

  const scope = payload.channelId === null ? "organization" : "channel";
  const detectors = selectDetectors({ scope, grain: payload.periodGrain });
  // Nothing is claimed and no run is recorded. A run that bound no detector
  // would sit in the audit trail looking like an analysis that found nothing.
  if (detectors.length === 0) return { outcome: "no_compatible_detectors" };

  const metricKeys = requiredMetricKeys(detectors);
  const claimToken = crypto.randomUUID();
  const claim = await dependencies.claim({
    organizationId: payload.organizationId,
    channelId: payload.channelId,
    branchId: payload.branchId,
    windowStart: payload.windowStart,
    windowEnd: payload.windowEnd,
    periodGrain: payload.periodGrain,
    analysisRunId: payload.analysisRunId,
    registryVersion: CHANNEL_ANALYSIS_REGISTRY_VERSION,
    detectors: detectors.map((detector) => ({
      key: detector.key,
      calculationVersion: detector.calculationVersion,
    })),
    metricKeys,
    idempotencyKey: payload.idempotencyKey,
    claimToken,
    correlationId: payload.correlationId,
  });
  if (claim.outcome !== "acquired") return { outcome: claim.outcome };

  try {
    // A lease resumed after a deployment could belong to a run that bound a
    // different registry. Writing today's arithmetic under yesterday's version
    // tuple would make the finding unreproducible, which is the one thing the
    // tuple exists to prevent.
    const bound = [...claim.boundDetectors]
      .map((detector) => `${detector.key}@${detector.calculationVersion}`)
      .sort()
      .join(",");
    const selected = detectors
      .map((detector) => `${detector.key}@${detector.calculationVersion}`)
      .sort()
      .join(",");
    if (bound !== selected) throw new ChannelAnalysisFailure("DETECTOR_REGISTRY_MISMATCH");

    const window: AnalysisWindow = {
      organizationId: payload.organizationId,
      channelId: payload.channelId,
      branchId: payload.branchId,
      windowStart: payload.windowStart,
      windowEnd: payload.windowEnd,
      grain: payload.periodGrain,
      timeZone: claim.windowTimezone,
    };

    let loaded: ChannelAnalysisEvidenceLoad;
    try {
      loaded = await dependencies.loadEvidence({ window, metricKeys });
    } catch {
      throw new ChannelAnalysisFailure("EVIDENCE_UNAVAILABLE");
    }

    const evidence: AnalysisEvidence = { window, ...loaded };
    const outcomes = runDetectors(detectors, evidence);
    if (outcomes.length === 0) throw new ChannelAnalysisFailure("ANALYSIS_PROCESSING_FAILED");

    const findings = outcomes.map((attributed) => toFindingPayload(window, attributed));
    await dependencies.complete({
      organizationId: payload.organizationId,
      analysisRunId: payload.analysisRunId,
      claimToken,
      resultDigest: createAnalysisResultDigest({
        registryVersion: CHANNEL_ANALYSIS_REGISTRY_VERSION,
        findings,
      }),
      findings,
    });

    // All three kinds, because a detector can return any of them and the run
    // summary is the only thing an operator reads before opening the workspace.
    // Counting two of three made a run that filed twelve observations report
    // zero of everything, which reads as "nothing was analysed" (staging run
    // cb8d3675). `channel_analysis_runs.observation_count` always held it.
    return {
      outcome: "completed",
      findingCount: findings.filter((finding) => finding.kind === "finding").length,
      observationCount: findings.filter((finding) => finding.kind === "observation").length,
      needsDataCount: findings.filter((finding) => finding.kind === "needs_data").length,
    };
  } catch (error) {
    const code: ChannelAnalysisFailureCode =
      error instanceof ChannelAnalysisFailure
        ? error.code
        : error instanceof ChannelAnalysisError &&
            ["INVALID_WINDOW", "WINDOW_TOO_WIDE", "INVALID_LOCAL_DATE"].includes(error.code)
          ? "WINDOW_CONTEXT_UNAVAILABLE"
          : "ANALYSIS_PROCESSING_FAILED";
    await dependencies.fail({
      organizationId: payload.organizationId,
      analysisRunId: payload.analysisRunId,
      claimToken,
      code,
      resultDigest: failureDigest(code),
    });
    return { outcome: "failed" };
  }
}
