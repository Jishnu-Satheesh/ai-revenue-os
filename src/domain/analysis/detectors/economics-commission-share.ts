import { selectComparablePoints, singleCurrency, sumNumerators } from "@/domain/analysis/evidence";
import type {
  AnalysisEvidence,
  AnalysisSeriesPoint,
  DetectorDeclaration,
  DetectorNeedsData,
  DetectorOutcome,
} from "@/domain/analysis/types";

const COMMISSION = "cost.commission";
const REVENUE = "revenue.gross";

function refuse(evidence: AnalysisEvidence, reason: string): DetectorNeedsData {
  return {
    kind: "needs_data",
    code: "COMMISSION_SHARE_UNAVAILABLE",
    needsDataReason: reason,
    channelId: evidence.window.channelId ?? undefined,
    branchId: evidence.window.branchId ?? undefined,
    metricKey: COMMISSION,
    periodStart: evidence.window.windowStart,
    periodEnd: evidence.window.windowEnd,
    qualityState: "complete",
    limitations: [],
    evidence: [],
  };
}

/**
 * What the marketplace charged, against the revenue it charged on.
 *
 * The first detector that reads a cost. It states two reported figures and the
 * ratio between them, and nothing else: commission is a deduction a provider
 * applied, not a margin, and calling the remainder profit would skip food,
 * packaging, delivery and every other cost no approved report here carries.
 *
 * The arithmetic is only defined where both figures describe the same days.
 * Keeta is exactly why: its commission comes from the order export across two
 * months, and its gross revenue from a billing report covering one. Dividing
 * the first by the second would produce an effective rate roughly twice the
 * truth, from two figures that are each individually correct. So the ratio is
 * computed over the days carrying both, and the finding says how many days that
 * was -- a rate over half a window is a fact about half a window.
 */
export const economicsCommissionShareDetector: DetectorDeclaration = {
  key: "economics.commission_share",
  calculationVersion: 1,
  owner: "core",
  scope: "channel",
  compatibleGrains: ["day", "week", "month"],
  // A span states one commission figure and one revenue figure with no periods
  // to intersect, so the safeguard below cannot be applied to it. Until a
  // provider reports both as spans, refusing the shape is honest.
  exactRangeEvidence: "refused",
  requiredMetricKeys: [COMMISSION, REVENUE],
  optionalMetricKeys: [],
  minimumQualityTier: "derived",
  acceptedReconciliationStates: ["current"],
  evidenceContract: [
    "Current period-grain observations of cost.commission for the selected channel and branch in the window.",
    "Current period-grain observations of revenue.gross for the same channel, branch and periods.",
    "One shared currency across both figures.",
  ],
  severityRules: [
    "None. A commission rate is what the provider charges; no agreed threshold turns a reported rate into a problem of a given severity.",
  ],
  monetaryImpact: {
    computable: false,
    reason:
      "Commission is a deduction the provider applied, already reflected in what was paid. It is not a gain or loss this analysis can claim to have found.",
  },
  limitations: [
    "Covers only the days carrying both a commission and a revenue figure; days with one and not the other are excluded from both sides.",
    "Commission is one deduction, not the only one. What remains after it is not margin and not profit.",
    "The rate is what was charged over these days, not a contracted rate, and not a prediction of the next period's.",
  ],
  needsDataConditions: [
    "No current governed cost.commission evidence exists in the window.",
    "No current governed revenue.gross evidence exists in the window.",
    "No day carries both figures, so no rate is defined.",
    "The two figures carry different currencies, or no currency.",
    "Revenue over the shared days is zero, so a share of it is undefined.",
  ],

  run(evidence: AnalysisEvidence): readonly DetectorOutcome[] {
    const { window } = evidence;
    const commission = selectComparablePoints(evidence, {
      metricKey: COMMISSION,
      minimumQualityTier: economicsCommissionShareDetector.minimumQualityTier,
    });
    const revenue = selectComparablePoints(evidence, {
      metricKey: REVENUE,
      minimumQualityTier: economicsCommissionShareDetector.minimumQualityTier,
    });

    if (commission.accepted.length === 0) return [refuse(evidence, "COMMISSION_SERIES_ABSENT")];
    if (revenue.accepted.length === 0) return [refuse(evidence, "REVENUE_SERIES_ABSENT")];

    // Both sides restricted to the days they share. A figure on a day the other
    // side never reported is not comparable to anything.
    const revenueDays = new Set(revenue.accepted.map((point) => point.periodStart));
    const commissionDays = new Set(commission.accepted.map((point) => point.periodStart));
    const shared = (point: AnalysisSeriesPoint): boolean =>
      revenueDays.has(point.periodStart) && commissionDays.has(point.periodStart);
    const commissionShared = commission.accepted.filter(shared);
    const revenueShared = revenue.accepted.filter(shared);
    if (commissionShared.length === 0) return [refuse(evidence, "NO_SHARED_PERIOD")];

    const currency = singleCurrency([...commissionShared, ...revenueShared]);
    if (currency === "mixed") return [refuse(evidence, "MIXED_CURRENCY")];
    if (currency === null) return [refuse(evidence, "CURRENCY_UNAVAILABLE")];

    const commissionTotal = sumNumerators(commissionShared);
    const revenueTotal = sumNumerators(revenueShared);
    // A share of nothing is not zero, it is undefined.
    if (revenueTotal <= 0) return [refuse(evidence, "REVENUE_NOT_POSITIVE")];

    const sharedDayCount = new Set(commissionShared.map((point) => point.periodStart)).size;
    const windowDayCount = new Set([...commissionDays, ...revenueDays]).size;
    const limitations = [...economicsCommissionShareDetector.limitations];
    if (sharedDayCount < windowDayCount) {
      limitations.unshift(
        `Read over the ${sharedDayCount} day(s) carrying both figures, out of ${windowDayCount} day(s) carrying either. The rate describes those days and not the rest of the window.`,
      );
    }

    return [
      {
        kind: "observation",
        code: "COMMISSION_SHARE_OF_REVENUE",
        channelId: window.channelId ?? undefined,
        branchId: window.branchId ?? undefined,
        metricKey: COMMISSION,
        periodStart: window.windowStart,
        periodEnd: window.windowEnd,
        measurement: {
          valueKind: "ratio",
          numerator: commissionTotal,
          denominator: revenueTotal,
          currency,
        },
        expectedPeriodCount: windowDayCount,
        observedPeriodCount: sharedDayCount,
        qualityState: "complete",
        limitations,
        // The commission rows are what was charged; the revenue rows are what it
        // was charged on. Citing both is what lets a reader recompute the ratio
        // rather than take it on trust.
        evidence: [
          ...commissionShared.map((point) => ({
            kind: "normalized_metric" as const,
            role: "component" as const,
            id: point.normalizedMetricId,
          })),
          ...revenueShared.map((point) => ({
            kind: "normalized_metric" as const,
            role: "denominator" as const,
            id: point.normalizedMetricId,
          })),
        ],
      },
    ];
  },
};
