import type {
  AnalysisEvidence,
  AnalysisExactRangePoint,
  AnalysisHeldEvidence,
  AnalysisSeriesPoint,
  AnalysisWindow,
} from "@/domain/analysis/types";

/**
 * Evidence builders for the detector tests.
 *
 * Deliberately explicit about periods: every helper takes the local dates it
 * describes, so a test that means "the second of January is missing" says so by
 * omitting it rather than by relying on a default.
 */

export const ORGANIZATION = "00000000-0000-4000-8000-000000000001";
export const CHANNEL = "00000000-0000-4000-8000-000000000010";
export const OTHER_CHANNEL = "00000000-0000-4000-8000-000000000011";
export const BRANCH = "00000000-0000-4000-8000-000000000020";
export const PROJECTION_RUN = "00000000-0000-4000-8000-000000000030";

export function window(overrides: Partial<AnalysisWindow> = {}): AnalysisWindow {
  return {
    organizationId: ORGANIZATION,
    channelId: CHANNEL,
    branchId: BRANCH,
    windowStart: "2026-01-01",
    windowEnd: "2026-01-05",
    grain: "day",
    timeZone: "Asia/Dubai",
    ...overrides,
  };
}

export function point(
  periodStart: string,
  numerator: number,
  overrides: Partial<AnalysisSeriesPoint> = {},
): AnalysisSeriesPoint {
  return {
    normalizedMetricId: `metric-${periodStart}-${overrides.channelId ?? CHANNEL}`,
    channelId: CHANNEL,
    branchId: BRANCH,
    metricKey: "revenue.gross",
    grain: "day",
    periodStart,
    periodEnd: periodStart,
    periodTimezone: "Asia/Dubai",
    valueKind: "money",
    numerator,
    currency: "AED",
    qualityTier: "measured",
    projectionRunId: PROJECTION_RUN,
    dimensions: {},
    ...overrides,
  };
}

/** A provider's own total for an inclusive span, as the ledger records it. */
export function exactRangePoint(
  overrides: Partial<AnalysisExactRangePoint> = {},
): AnalysisExactRangePoint {
  return {
    exactRangeMetricObservationId: `exact-${overrides.metricKey ?? "revenue.gross"}-${CHANNEL}`,
    channelId: CHANNEL,
    // The window names a branch, so its evidence has to be that branch's. An
    // organization-wide total answering a branch question would attribute
    // every outlet's trade to one of them.
    branchId: BRANCH,
    metricKey: "revenue.gross",
    periodStart: "2026-01-01",
    periodEnd: "2026-01-05",
    periodTimezone: "Asia/Dubai",
    valueKind: "money",
    numerator: 91_000,
    currency: "AED",
    qualityState: "complete",
    completenessState: "complete",
    projectionRunId: PROJECTION_RUN,
    ...overrides,
  };
}

export function held(overrides: Partial<AnalysisHeldEvidence> = {}): AnalysisHeldEvidence {
  return {
    reconciliationId: "00000000-0000-4000-8000-000000000040",
    projectionTarget: "exact_range",
    channelId: CHANNEL,
    branchId: BRANCH,
    periodStart: "2026-01-01",
    periodEnd: "2026-01-05",
    candidateCount: 5,
    ...overrides,
  };
}

export function evidence(overrides: Partial<AnalysisEvidence> = {}): AnalysisEvidence {
  return {
    window: window(),
    points: [],
    exactRangePoints: [],
    incomparablePointCount: 0,
    projectionRuns: [{ projectionRunId: PROJECTION_RUN, absentRowCount: 0 }],
    heldEvidence: [],
    ...overrides,
  };
}
