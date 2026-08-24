import { enumerateLocalPeriodStarts } from "@/domain/analysis/calendar";
import {
  distinct,
  selectComparablePoints,
  singleCurrency,
  sumNumerators,
} from "@/domain/analysis/evidence";
import type {
  AnalysisEvidence,
  AnalysisSeriesPoint,
  DetectorDeclaration,
  DetectorNeedsData,
  DetectorOutcome,
} from "@/domain/analysis/types";

/**
 * Each channel's share of gross revenue over a window.
 *
 * Two currencies are refused, never converted. Converting needs a rate, a rate
 * needs a date and a published source, and the platform has neither -- so a
 * share computed across currencies would be a number the operator could not
 * trace to anything. `needs_data` is the honest answer and it says which
 * currencies collided.
 *
 * Shares are computed over the periods each channel actually reported. A
 * channel that exported three days of a month is a smaller share than its trade
 * warrants, and the finding carries both period counts so that is visible
 * rather than buried.
 */

const METRIC_KEY = "revenue.gross";

function refuse(evidence: AnalysisEvidence, reason: string): DetectorNeedsData {
  return {
    kind: "needs_data",
    code: "CHANNEL_REVENUE_SHARE_UNAVAILABLE",
    needsDataReason: reason,
    branchId: evidence.window.branchId ?? undefined,
    metricKey: METRIC_KEY,
    periodStart: evidence.window.windowStart,
    periodEnd: evidence.window.windowEnd,
    qualityState: "complete",
    limitations: [],
    evidence: [],
  };
}

export const revenueChannelShareDetector: DetectorDeclaration = {
  key: "revenue.channel_share",
  calculationVersion: 1,
  owner: "core",
  scope: "organization",
  compatibleGrains: ["day", "week", "month"],
  // Comparing a channel's daily series against another channel's arbitrary
  // month total would put two different shapes in one denominator.
  exactRangeEvidence: "refused",
  requiredMetricKeys: [METRIC_KEY],
  optionalMetricKeys: [],
  minimumQualityTier: "derived",
  acceptedReconciliationStates: ["current"],
  evidenceContract: [
    "Current period-grain observations of revenue.gross for two or more channels in the window.",
    "One shared currency and one shared recorded timezone across every contributing observation.",
  ],
  severityRules: [
    "None. A share is an authoritative observation; no agreed threshold exists at which a channel's share becomes a problem, and concentration is a business judgement rather than a defect.",
  ],
  monetaryImpact: {
    computable: false,
    reason:
      "A share describes how revenue is distributed, not revenue that was gained or lost. There is nothing to price.",
  },
  limitations: [
    "Computed over the periods each channel reported, so a channel with fewer reported periods contributes less than its trade may warrant.",
    "The denominator is the sum of every channel's component citations in this same run.",
  ],
  needsDataConditions: [
    "No current governed evidence for the metric in the window.",
    "Fewer than two channels reported in the window.",
    "The contributing observations carry more than one currency or more than one recorded timezone.",
    "The window's total is zero, which leaves no share defined.",
  ],

  run(evidence: AnalysisEvidence): readonly DetectorOutcome[] {
    const { window } = evidence;
    const { accepted, setAsideCount } = selectComparablePoints(evidence, {
      metricKey: METRIC_KEY,
      minimumQualityTier: revenueChannelShareDetector.minimumQualityTier,
    });

    if (accepted.length === 0) return [refuse(evidence, "NO_GOVERNED_EVIDENCE_IN_WINDOW")];

    const currency = singleCurrency(accepted);
    if (currency === "mixed") return [refuse(evidence, "MIXED_CURRENCY")];
    if (currency === null) return [refuse(evidence, "CURRENCY_UNAVAILABLE")];
    if (distinct(accepted, (point) => point.periodTimezone).length > 1) {
      return [refuse(evidence, "MIXED_TIMEZONE")];
    }

    const channelIds = distinct(accepted, (point) => point.channelId).sort();
    // One channel has a share of one, which tells an operator nothing they did
    // not already know and invites them to read it as a market position.
    if (channelIds.length < 2) return [refuse(evidence, "SINGLE_CHANNEL_IN_WINDOW")];

    const total = sumNumerators(accepted);
    if (total === 0) return [refuse(evidence, "WINDOW_TOTAL_IS_ZERO")];

    const expectedPeriodCount = enumerateLocalPeriodStarts(
      window.windowStart,
      window.windowEnd,
      window.grain,
    ).length;

    const limitations = [
      "Computed over the periods each channel reported; a channel with fewer reported periods contributes less than its trade may warrant.",
      "The denominator is the sum of every channel's component citations in this run.",
    ];
    if (setAsideCount > 0) {
      limitations.push(
        "Some rows for this metric were set aside as incomparable and are not in the total.",
      );
    }

    return channelIds.map((channelId): DetectorOutcome => {
      const channelPoints: AnalysisSeriesPoint[] = accepted.filter(
        (point) => point.channelId === channelId,
      );
      return {
        kind: "observation",
        code: "CHANNEL_REVENUE_SHARE",
        channelId,
        branchId: window.branchId ?? undefined,
        metricKey: METRIC_KEY,
        periodStart: window.windowStart,
        periodEnd: window.windowEnd,
        // Numerator and denominator, never the quotient. A share stored as a
        // decimal cannot be recombined over a wider window or a second branch.
        measurement: {
          valueKind: "ratio",
          numerator: sumNumerators(channelPoints),
          denominator: total,
          currency,
        },
        expectedPeriodCount,
        observedPeriodCount: distinct(channelPoints, (point) => point.periodStart).length,
        absentPeriodCount:
          expectedPeriodCount - distinct(channelPoints, (point) => point.periodStart).length,
        qualityState: setAsideCount > 0 ? "partial" : "complete",
        limitations,
        evidence: channelPoints.map((point) => ({
          kind: "normalized_metric" as const,
          role: "component" as const,
          id: point.normalizedMetricId,
        })),
      };
    });
  },
};
