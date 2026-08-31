import { enumerateLocalPeriodStarts, localPeriodEndInWindow } from "@/domain/analysis/calendar";
import { selectComparablePoints } from "@/domain/analysis/evidence";
import type {
  AnalysisEvidence,
  DetectorDeclaration,
  DetectorOutcome,
  FindingEvidenceReference,
} from "@/domain/analysis/types";

/**
 * Which periods in a window carry current governed evidence, and which do not.
 *
 * This is the honest opening move. Before an operator is shown a number derived
 * from their evidence, they are told what their evidence can and cannot
 * support: eleven of thirty days missing is not a detail, it is the difference
 * between a trend and a coincidence.
 *
 * An absent period is reported as absent. It is never interpolated, never
 * carried forward, and never read as a zero -- a closed Monday and a Monday
 * nobody exported look identical in a spreadsheet and mean opposite things.
 */

const METRIC_KEY = "revenue.gross";

export const periodCoverageDetector: DetectorDeclaration = {
  key: "evidence.period_coverage",
  // 2: a window with no comparable evidence now distinguishes evidence that is
  // absent from evidence recorded at another grain, which are different facts.
  calculationVersion: 2,
  owner: "core",
  scope: "channel",
  compatibleGrains: ["day", "week", "month"],
  // A total covering a span cannot say which days inside it carried trade, so
  // it can neither fill a gap nor prove one.
  exactRangeEvidence: "refused",
  requiredMetricKeys: [METRIC_KEY],
  optionalMetricKeys: [],
  // Coverage is a question about presence, not about trust, so the weakest tier
  // still counts as evidence that a period was reported on.
  minimumQualityTier: "assumed",
  acceptedReconciliationStates: ["current"],
  evidenceContract: [
    "A declared window, grain, and timezone supplied by the caller.",
    "Current period-grain observations of revenue.gross bucketed in the window's own timezone.",
    "The absent-row count recorded by each governed projection run that wrote those periods.",
  ],
  severityRules: [
    "None. Coverage is an authoritative observation, and no agreed threshold exists at which a share of missing periods becomes a problem of a given size.",
  ],
  monetaryImpact: {
    computable: false,
    reason:
      "A missing period has no value, and assigning one would invent the trade it is missing.",
  },
  limitations: [
    "A period is counted as covered when any current observation starts in it, not when the whole period was traded.",
    "The provider-reported blank count describes the imports that fed this window, which may cover more days than the window does.",
  ],
  needsDataConditions: [
    "The window contains no whole period at the declared grain.",
    "No current governed observation of the required metric falls in the window.",
    "Observations fall in the window but are recorded at another grain, which is reported as such rather than as an absence.",
  ],

  run(evidence: AnalysisEvidence): readonly DetectorOutcome[] {
    const { window } = evidence;
    const expected = enumerateLocalPeriodStarts(window.windowStart, window.windowEnd, window.grain);

    // A month grain over a fortnight contains no whole month. Reporting "0 of 0
    // periods covered" would be arithmetic rather than an answer.
    if (expected.length === 0) {
      return [
        {
          kind: "needs_data",
          code: "PERIOD_COVERAGE_UNAVAILABLE",
          needsDataReason: "WINDOW_CONTAINS_NO_PERIOD",
          channelId: window.channelId ?? undefined,
          branchId: window.branchId ?? undefined,
          metricKey: METRIC_KEY,
          qualityState: "complete",
          limitations: [],
          evidence: [],
        },
      ];
    }

    const { accepted, setAsideCount, setAside, setAsideGrains } = selectComparablePoints(evidence, {
      metricKey: METRIC_KEY,
      minimumQualityTier: periodCoverageDetector.minimumQualityTier,
    });

    if (accepted.length === 0) {
      // Evidence sitting in the window at another grain is not missing
      // evidence. Saying "no approved report has written these days" over days
      // the operator did import reads as data loss, and sends them to chase a
      // provider for a file the platform already holds.
      const grainMismatch = setAside.grain > 0;
      return [
        {
          kind: "needs_data",
          code: "PERIOD_COVERAGE_UNAVAILABLE",
          needsDataReason: grainMismatch
            ? "EVIDENCE_AT_DIFFERENT_GRAIN"
            : "NO_GOVERNED_EVIDENCE_IN_WINDOW",
          channelId: window.channelId ?? undefined,
          branchId: window.branchId ?? undefined,
          metricKey: METRIC_KEY,
          periodStart: window.windowStart,
          periodEnd: window.windowEnd,
          expectedPeriodCount: expected.length,
          observedPeriodCount: 0,
          absentPeriodCount: expected.length,
          qualityState: setAsideCount > 0 ? "partial" : "complete",
          limitations: grainMismatch
            ? [
                `This window was analysed at ${window.grain} grain. ${setAside.grain} ${setAside.grain === 1 ? "figure" : "figures"} for this metric are recorded at ${setAsideGrains.join(" and ")} grain and were not resampled, because a ${setAsideGrains.join(" or ")} is not a fraction of a ${window.grain}.`,
                "Analysing this window at the grain the evidence was written at would report on it.",
              ]
            : setAsideCount > 0
              ? [
                  "Rows were found for this metric but set aside as incomparable: a different recorded timezone, a different branch or channel, or a quality tier below what this detector accepts.",
                ]
              : [],
          evidence: [],
        },
      ];
    }

    const covered = new Set(accepted.map((point) => point.periodStart));
    const observed = expected.filter((start) => covered.has(start));
    const absent = expected.filter((start) => !covered.has(start));

    const citedRunIds = new Set(
      accepted.map((point) => point.projectionRunId).filter((id): id is string => id !== null),
    );
    const contributingRuns = evidence.projectionRuns.filter((run) =>
      citedRunIds.has(run.projectionRunId),
    );
    const reportedBlankCount = contributingRuns.reduce(
      (total, run) => total + (run.absentRowCount ?? 0),
      0,
    );

    const references: FindingEvidenceReference[] = [
      ...accepted.map((point) => ({
        kind: "normalized_metric" as const,
        role: "component" as const,
        id: point.normalizedMetricId,
      })),
      ...contributingRuns.map((run) => ({
        kind: "projection_run" as const,
        role: "gap_count" as const,
        id: run.projectionRunId,
      })),
    ];

    const limitations = [
      "A period is counted as covered when a current observation starts in it, not when every day inside it was traded.",
    ];
    if (reportedBlankCount > 0) {
      limitations.push(
        `The imports feeding this window recorded ${reportedBlankCount} blank row-and-output pairs of their own, over the days those packages declared rather than over this window.`,
      );
    }
    if (setAsideCount > 0) {
      limitations.push(
        "Some rows for this metric were set aside as incomparable and are not counted as coverage.",
      );
    }

    return [
      {
        kind: "observation",
        code: absent.length === 0 ? "PERIOD_COVERAGE_COMPLETE" : "PERIOD_COVERAGE_INCOMPLETE",
        channelId: window.channelId ?? undefined,
        branchId: window.branchId ?? undefined,
        metricKey: METRIC_KEY,
        periodStart: expected[0],
        // Every enumerated period lies wholly inside the window, so the last
        // one's own end is already within it and needs no clamping.
        periodEnd: localPeriodEndInWindow(expected[expected.length - 1], window.grain, window.windowEnd),
        // Both parts of the fraction, never the quotient: a share stored as a
        // decimal cannot be re-aggregated over a wider window.
        measurement: {
          valueKind: "ratio",
          numerator: observed.length,
          denominator: expected.length,
        },
        expectedPeriodCount: expected.length,
        observedPeriodCount: observed.length,
        absentPeriodCount: absent.length,
        qualityState: setAsideCount > 0 ? "partial" : "complete",
        limitations,
        evidence: references,
      },
    ];
  },
};
