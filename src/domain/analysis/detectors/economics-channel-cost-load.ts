import { selectComparablePoints, singleCurrency, sumNumerators } from "@/domain/analysis/evidence";
import type {
  AnalysisEvidence,
  AnalysisSeriesPoint,
  DetectorDeclaration,
  DetectorNeedsData,
  DetectorOutcome,
} from "@/domain/analysis/types";

const REVENUE = "revenue.gross";

/**
 * Every deduction a marketplace makes that the merchant bears.
 *
 * `promotion.provider_subsidy` is deliberately absent: that is the marketplace's
 * own money, and adding it here would charge the restaurant for a discount
 * somebody else funded.
 */
const COST_COMPONENTS = [
  "cost.commission",
  "cost.payment_processing",
  "cost.equipment_fee",
  "promotion.funding",
] as const;

const COMPONENT_LABEL: Readonly<Record<(typeof COST_COMPONENTS)[number], string>> = {
  "cost.commission": "commission",
  "cost.payment_processing": "payment processing",
  "cost.equipment_fee": "equipment fees",
  "promotion.funding": "promotions the restaurant funded",
};

function refuse(evidence: AnalysisEvidence, reason: string): DetectorNeedsData {
  return {
    kind: "needs_data",
    code: "CHANNEL_COST_LOAD_UNAVAILABLE",
    needsDataReason: reason,
    channelId: evidence.window.channelId ?? undefined,
    branchId: evidence.window.branchId ?? undefined,
    metricKey: REVENUE,
    periodStart: evidence.window.windowStart,
    periodEnd: evidence.window.windowEnd,
    qualityState: "complete",
    limitations: [],
    evidence: [],
  };
}

/**
 * What the channel costs to sell through, counting every deduction, not the
 * largest one.
 *
 * `economics.commission_share` answers a narrower question correctly, and that
 * is the danger. Reconciled against a real marketplace statement of account,
 * commission was about half of what the channel actually charged. Both figures
 * are true. An operator told only the narrower one will price, discount and
 * decide against a cost roughly half the real one -- a mistake made of two
 * correct figures, which is the kind this platform exists to prevent.
 *
 * So this reads every merchant-borne deduction that any approved report writes
 * and sums them against the revenue they were charged on.
 *
 * Two safeguards, both about honesty of coverage:
 *
 * Revenue is the denominator, so the arithmetic happens only over the periods
 * revenue covers. A cost on a day with no revenue figure is not a share of
 * anything, and Keeta is exactly why -- its commission runs two months and its
 * billing report covers one.
 *
 * The finding names the cost lines it actually read. It cannot know what a
 * provider charged and never reported, so it does not imply completeness it
 * cannot check. A reader who sees "commission" alone in that list knows the
 * figure is a floor rather than a total, which is the one thing the narrower
 * detector could never say about itself.
 */
export const economicsChannelCostLoadDetector: DetectorDeclaration = {
  key: "economics.channel_cost_load",
  calculationVersion: 1,
  owner: "core",
  scope: "channel",
  compatibleGrains: ["day", "week", "month"],
  // A span states one figure a side with no periods to intersect, so the
  // coverage safeguard below cannot be applied to it.
  exactRangeEvidence: "refused",
  requiredMetricKeys: [REVENUE],
  optionalMetricKeys: [...COST_COMPONENTS],
  minimumQualityTier: "derived",
  acceptedReconciliationStates: ["current"],
  evidenceContract: [
    "Current period-grain observations of revenue.gross for the selected channel and branch in the window.",
    "Current period-grain observations of any merchant-borne cost metric for the same channel, branch and periods.",
    "One shared currency across revenue and every cost read.",
  ],
  severityRules: [
    "None. What a marketplace charges is what it charges; no agreed threshold turns a reported cost load into a problem of a given severity.",
  ],
  monetaryImpact: {
    computable: false,
    reason:
      "These deductions were already applied to what the provider paid. They are a cost that was borne, not a gain or loss this analysis found.",
  },
  limitations: [
    "Counts only the cost lines an approved report writes. A charge the provider never reported cannot appear here, so the figure is a floor.",
    "Covers only the periods carrying a revenue figure; costs charged outside them are excluded from both sides.",
    // Narrowed to the channel on 2026-09-01. The company's own profit and loss
    // states food and packaging monthly, and the platform reads it now -- but
    // at company scope, not per channel, so nothing here can attribute a
    // kitchen's cost to the marketplace an order came through. The sentence has
    // to say which of those it means.
    "A cost load is not a margin. No approved report states this channel's food, packaging, labour or rent, so what remains after these deductions is not profit.",
  ],
  needsDataConditions: [
    "No current governed revenue.gross evidence exists in the window.",
    "No current governed evidence exists for any merchant-borne cost metric.",
    "No period carries both a revenue figure and at least one cost figure.",
    "Revenue and the costs read carry different currencies, or no currency.",
    "Revenue over the shared periods is zero, so a share of it is undefined.",
  ],

  run(evidence: AnalysisEvidence): readonly DetectorOutcome[] {
    const { window } = evidence;
    const revenue = selectComparablePoints(evidence, {
      metricKey: REVENUE,
      minimumQualityTier: economicsChannelCostLoadDetector.minimumQualityTier,
    });
    if (revenue.accepted.length === 0) return [refuse(evidence, "REVENUE_SERIES_ABSENT")];

    // Revenue is the denominator, so it defines the periods the question is
    // answerable over. A cost outside them is not a share of anything.
    const revenuePeriods = new Set(revenue.accepted.map((point) => point.periodStart));
    const withinRevenue = (point: AnalysisSeriesPoint): boolean =>
      revenuePeriods.has(point.periodStart);

    const components: { metricKey: string; points: AnalysisSeriesPoint[] }[] = [];
    for (const metricKey of COST_COMPONENTS) {
      const selected = selectComparablePoints(evidence, {
        metricKey,
        minimumQualityTier: economicsChannelCostLoadDetector.minimumQualityTier,
      });
      const points = selected.accepted.filter(withinRevenue);
      if (points.length > 0) components.push({ metricKey, points });
    }
    if (components.length === 0) return [refuse(evidence, "COST_SERIES_ABSENT")];

    const costPoints = components.flatMap((component) => component.points);
    // Only the periods that actually carry a cost belong on the revenue side.
    // Dividing every cost by every day's revenue, including days no cost was
    // reported for, would understate the load and look careful doing it.
    const costPeriods = new Set(costPoints.map((point) => point.periodStart));
    const revenueShared = revenue.accepted.filter((point) => costPeriods.has(point.periodStart));
    if (revenueShared.length === 0) return [refuse(evidence, "NO_SHARED_PERIOD")];

    const currency = singleCurrency([...costPoints, ...revenueShared]);
    if (currency === "mixed") return [refuse(evidence, "MIXED_CURRENCY")];
    if (currency === null) return [refuse(evidence, "CURRENCY_UNAVAILABLE")];

    const costTotal = sumNumerators(costPoints);
    const revenueTotal = sumNumerators(revenueShared);
    // A share of nothing is not zero, it is undefined.
    if (revenueTotal <= 0) return [refuse(evidence, "REVENUE_NOT_POSITIVE")];

    const sharedPeriodCount = costPeriods.size;
    const windowPeriodCount = new Set([...revenuePeriods, ...costPeriods]).size;
    const limitations = [...economicsChannelCostLoadDetector.limitations];
    // Named, not counted. "Four cost lines" tells a reader nothing about
    // whether the one they are worried about is among them.
    limitations.unshift(
      `Read from ${components.length} cost line(s): ${components
        .map(
          (component) => COMPONENT_LABEL[component.metricKey as (typeof COST_COMPONENTS)[number]],
        )
        .join(", ")}.`,
    );
    if (sharedPeriodCount < windowPeriodCount) {
      limitations.splice(
        1,
        0,
        `Read over the ${sharedPeriodCount} period(s) carrying both revenue and a cost, out of ${windowPeriodCount} carrying either.`,
      );
    }

    return [
      {
        kind: "observation",
        code: "CHANNEL_COST_LOAD_OF_REVENUE",
        channelId: window.channelId ?? undefined,
        branchId: window.branchId ?? undefined,
        metricKey: REVENUE,
        periodStart: window.windowStart,
        periodEnd: window.windowEnd,
        measurement: {
          valueKind: "ratio",
          numerator: costTotal,
          denominator: revenueTotal,
          currency,
        },
        expectedPeriodCount: windowPeriodCount,
        observedPeriodCount: sharedPeriodCount,
        qualityState: "complete",
        limitations,
        // Every deduction on one side and the revenue it was charged on the
        // other, so a reader can add the components up themselves rather than
        // trust a single ratio.
        evidence: [
          ...costPoints.map((point) => ({
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
