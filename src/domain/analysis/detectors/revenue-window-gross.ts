import { enumerateLocalPeriodStarts } from "@/domain/analysis/calendar";
import { selectComparablePoints, singleCurrency, sumNumerators } from "@/domain/analysis/evidence";
import type {
  AnalysisEvidence,
  DetectorDeclaration,
  DetectorNeedsData,
  DetectorOutcome,
} from "@/domain/analysis/types";

const METRIC_KEY = "revenue.gross";

function refuse(evidence: AnalysisEvidence, reason: string): DetectorNeedsData {
  return {
    kind: "needs_data",
    code: "WINDOW_GROSS_REVENUE_UNAVAILABLE",
    needsDataReason: reason,
    channelId: evidence.window.channelId ?? undefined,
    branchId: evidence.window.branchId ?? undefined,
    metricKey: METRIC_KEY,
    periodStart: evidence.window.windowStart,
    periodEnd: evidence.window.windowEnd,
    qualityState: "complete",
    limitations: [],
    evidence: [],
  };
}

/**
 * The channel's reported gross revenue over one analysed window.
 *
 * This is deliberately not a share or an estimate. It is the sum of the
 * channel-scoped `revenue.gross` rows that the worker already admitted as
 * current and comparable, with the observed period count retained so missing
 * days cannot be mistaken for zero-revenue days.
 */
export const revenueWindowGrossDetector: DetectorDeclaration = {
  key: "revenue.window_gross",
  // 2: a provider that reports one total for its whole export, rather than a
  // row per day, can answer this question too.
  calculationVersion: 2,
  owner: "core",
  scope: "channel",
  compatibleGrains: ["day", "week", "month"],
  exactRangeEvidence: "cited",
  requiredMetricKeys: [METRIC_KEY],
  optionalMetricKeys: [],
  minimumQualityTier: "derived",
  acceptedReconciliationStates: ["current"],
  evidenceContract: [
    "Current period-grain observations of revenue.gross for the selected channel and branch in the window.",
    "One shared currency across every contributing observation.",
  ],
  severityRules: [
    "None. Reported gross revenue is an observation, and no agreed threshold turns it into a problem of a given severity.",
  ],
  monetaryImpact: {
    computable: false,
    reason:
      "Gross revenue is a reported amount, not a gain-or-loss calculation. It carries no monetary impact claim.",
  },
  limitations: [
    "Sums only periods carrying current comparable governed revenue evidence; missing periods are not treated as zero.",
    "Gross revenue is not payout, margin, or realized profit.",
  ],
  needsDataConditions: [
    "No current governed revenue.gross evidence exists in the window.",
    "The contributing observations carry more than one currency, or no currency.",
  ],

  run(evidence: AnalysisEvidence): readonly DetectorOutcome[] {
    const { window } = evidence;
    const { accepted, setAsideCount } = selectComparablePoints(evidence, {
      metricKey: METRIC_KEY,
      minimumQualityTier: revenueWindowGrossDetector.minimumQualityTier,
    });

    // A provider's own total for its whole export. Noon and EatEasily report
    // one figure for a range and never a row per day, so refusing the shape
    // leaves a channel with real cited revenue showing nothing at all.
    const spans = evidence.exactRangePoints.filter(
      (span) =>
        span.metricKey === METRIC_KEY &&
        span.channelId === window.channelId &&
        (window.branchId ? span.branchId === window.branchId : true),
    );

    if (spans.length > 0) {
      // Two shapes answering one question. Adding them double-counts, and
      // picking one silently discards governed evidence.
      if (accepted.length > 0) return [refuse(evidence, "EXACT_RANGE_AND_SERIES_BOTH_PRESENT")];
      if (spans.length > 1) return [refuse(evidence, "EXACT_RANGE_NOT_SINGULAR")];
      const span = spans[0] as (typeof spans)[number];
      // The dates have to be the window, exactly. Trimming a January-to-
      // February figure down to January is proration: nobody reported it and
      // nobody approved it.
      if (span.periodStart !== window.windowStart || span.periodEnd !== window.windowEnd) {
        return [refuse(evidence, "EXACT_RANGE_WINDOW_MISMATCH")];
      }
      if (span.currency === null) return [refuse(evidence, "CURRENCY_UNAVAILABLE")];
      return [
        {
          kind: "observation",
          code: "WINDOW_GROSS_REVENUE",
          channelId: window.channelId ?? undefined,
          branchId: window.branchId ?? undefined,
          metricKey: METRIC_KEY,
          periodStart: window.windowStart,
          periodEnd: window.windowEnd,
          measurement: { valueKind: "money", numerator: span.numerator, currency: span.currency },
          // No period counts. The export never broke the span into periods, so
          // "1 of 5 days observed" would be a fact it does not carry.
          qualityState: span.qualityState,
          limitations: [
            "Reported for the uploaded period as one total; no daily trend is available.",
            "Gross revenue is not payout, margin, or realized profit.",
          ],
          evidence: [
            {
              kind: "exact_range_metric_observation",
              role: "component",
              id: span.exactRangeMetricObservationId,
            },
          ],
        },
      ];
    }

    if (accepted.length === 0) return [refuse(evidence, "NO_GOVERNED_EVIDENCE_IN_WINDOW")];

    const currency = singleCurrency(accepted);
    if (currency === "mixed") return [refuse(evidence, "MIXED_CURRENCY")];
    if (currency === null) return [refuse(evidence, "CURRENCY_UNAVAILABLE")];

    const expectedPeriodCount = enumerateLocalPeriodStarts(
      window.windowStart,
      window.windowEnd,
      window.grain,
    ).length;
    const observedPeriodCount = new Set(accepted.map((point) => point.periodStart)).size;
    const limitations = [
      "Sums only periods carrying current comparable governed revenue evidence; missing periods are not treated as zero.",
      "Gross revenue is not payout, margin, or realized profit.",
    ];
    if (setAsideCount > 0) {
      limitations.push(
        "Some revenue rows were set aside as incomparable and are not in this reported total.",
      );
    }

    return [
      {
        kind: "observation",
        code: "WINDOW_GROSS_REVENUE",
        channelId: window.channelId ?? undefined,
        branchId: window.branchId ?? undefined,
        metricKey: METRIC_KEY,
        periodStart: window.windowStart,
        periodEnd: window.windowEnd,
        measurement: {
          valueKind: "money",
          numerator: sumNumerators(accepted),
          currency,
        },
        expectedPeriodCount,
        observedPeriodCount,
        absentPeriodCount: expectedPeriodCount - observedPeriodCount,
        qualityState: setAsideCount > 0 ? "partial" : "complete",
        limitations,
        evidence: accepted.map((point) => ({
          kind: "normalized_metric" as const,
          role: "component" as const,
          id: point.normalizedMetricId,
        })),
      },
    ];
  },
};
