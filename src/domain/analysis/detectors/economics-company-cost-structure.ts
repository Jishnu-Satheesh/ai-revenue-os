import { selectComparablePoints, singleCurrency, sumNumerators } from "@/domain/analysis/evidence";
import type {
  AnalysisEvidence,
  AnalysisSeriesPoint,
  DetectorDeclaration,
  DetectorNeedsData,
  DetectorOutcome,
} from "@/domain/analysis/types";

const REVENUE = "revenue.company_gross";

/**
 * The costs a set of books states against the revenue they were incurred on.
 *
 * `cost.commission` here is the accounting entry for every marketplace at once,
 * not one channel's. It sits beside food and packaging because the statement
 * charges all three against the same revenue, and leaving it out would report a
 * margin the books never claimed.
 */
const COST_COMPONENTS = ["cost.food", "cost.packaging", "cost.commission"] as const;

const COMPONENT_LABEL: Readonly<Record<(typeof COST_COMPONENTS)[number], string>> = {
  "cost.food": "food",
  "cost.packaging": "packaging",
  "cost.commission": "marketplace commission",
};

function refuse(evidence: AnalysisEvidence, reason: string): DetectorNeedsData {
  return {
    kind: "needs_data",
    code: "COMPANY_COST_STRUCTURE_UNAVAILABLE",
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
 * What it costs the company to make what it sells.
 *
 * Every other detector here reads a marketplace's own export, and no
 * marketplace has ever told this platform what the food cost. `cost.food` and
 * `cost.packaging` exist because the client's accounting profit and loss states
 * them, and this is the detector that reads them.
 *
 * It is deliberately not `economics.channel_cost_load` with more metrics. That
 * one answers what a channel costs to sell through, per channel, from that
 * channel's own report. This answers what the company spent to trade, from the
 * company's books, and the two must not be confused: nothing in a set of books
 * says which marketplace an order's ingredients were bought for, so a kitchen's
 * cost can never be attributed to a channel here.
 *
 * The revenue it divides by is `revenue.company_gross` rather than
 * `revenue.gross`, and that is the same distinction stated in the metric. A
 * statement that books marketplace commission as a cost has, under accrual,
 * already counted those marketplaces' sales as income. Dividing a company cost
 * by one channel's revenue would compare a whole against a part.
 *
 * Two safeguards carried over from the channel detector, for the same reasons.
 * Revenue is the denominator, so the arithmetic happens only over the periods
 * revenue covers. And the finding names the cost lines it actually read: a
 * bookkeeper who posts a quarter's commission in one month leaves three months
 * reading as though nothing was charged, and a reader has to be able to see
 * which lines were behind the figure rather than trust one ratio.
 */
export const economicsCompanyCostStructureDetector: DetectorDeclaration = {
  key: "economics.company_cost_structure",
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
    "Current period-grain observations of revenue.company_gross for the selected channel and branch in the window.",
    "Current period-grain observations of any company cost metric for the same channel, branch and periods.",
    "One shared currency across revenue and every cost read.",
  ],
  severityRules: [
    "None. What a kitchen spends is what it spends; no agreed threshold turns a reported cost structure into a problem of a given severity.",
  ],
  monetaryImpact: {
    computable: false,
    reason:
      "These are costs the business already incurred and recorded. They are what was spent, not a gain or loss this analysis found.",
  },
  limitations: [
    "Read from the company's own books, not from any marketplace export. Nothing here can say which channel a cost was incurred for.",
    "Counts only the cost lines the statement writes and this contract binds. A cost recorded elsewhere in the books cannot appear here, so the figure is a floor.",
    "Covers only the periods carrying a revenue figure; costs recorded outside them are excluded from both sides.",
    "Revenue here is the whole company's, and already contains what the marketplaces sold. It is not any one channel's revenue and must not be read as one.",
  ],
  needsDataConditions: [
    "No current governed revenue.company_gross evidence exists in the window.",
    "No current governed evidence exists for any company cost metric.",
    "No period carries both a revenue figure and at least one cost figure.",
    "Revenue and the costs read carry different currencies, or no currency.",
    "Revenue over the shared periods is zero, so a share of it is undefined.",
  ],

  run(evidence: AnalysisEvidence): readonly DetectorOutcome[] {
    const { window } = evidence;
    const detector = economicsCompanyCostStructureDetector;
    const revenue = selectComparablePoints(evidence, {
      metricKey: REVENUE,
      minimumQualityTier: detector.minimumQualityTier,
    });
    if (revenue.accepted.length === 0) return [refuse(evidence, "REVENUE_SERIES_ABSENT")];

    // Revenue is the denominator, so it defines the periods the question is
    // answerable over. A cost outside them is not a share of anything.
    const revenuePeriods = new Set(revenue.accepted.map((point) => point.periodStart));
    const withinRevenue = (point: AnalysisSeriesPoint): boolean =>
      revenuePeriods.has(point.periodStart);

    const components: {
      metricKey: (typeof COST_COMPONENTS)[number];
      points: AnalysisSeriesPoint[];
    }[] = [];
    for (const metricKey of COST_COMPONENTS) {
      const selected = selectComparablePoints(evidence, {
        metricKey,
        minimumQualityTier: detector.minimumQualityTier,
      });
      const points = selected.accepted.filter(withinRevenue);
      if (points.length > 0) components.push({ metricKey, points });
    }
    if (components.length === 0) return [refuse(evidence, "COST_SERIES_ABSENT")];

    const costPoints = components.flatMap((component) => component.points);
    // Only the periods that actually carry a cost belong on the revenue side.
    // Dividing every cost by every period's revenue, including periods no cost
    // was recorded for, would understate the load and look careful doing it.
    const costPeriods = new Set(costPoints.map((point) => point.periodStart));
    const revenueShared = revenue.accepted.filter((point) => costPeriods.has(point.periodStart));
    if (revenueShared.length === 0) return [refuse(evidence, "NO_SHARED_PERIOD")];

    const currency = singleCurrency([...costPoints, ...revenueShared]);
    if (currency === "mixed") return [refuse(evidence, "MIXED_CURRENCY")];
    if (currency === null) return [refuse(evidence, "CURRENCY_UNAVAILABLE")];

    const revenueTotal = sumNumerators(revenueShared);
    // A share of nothing is not zero, it is undefined.
    if (revenueTotal <= 0) return [refuse(evidence, "REVENUE_NOT_POSITIVE")];

    const sharedPeriodCount = costPeriods.size;
    const windowPeriodCount = new Set([...revenuePeriods, ...costPeriods]).size;
    const limitations = [...detector.limitations];
    // Named, not counted. "Three cost lines" tells a reader nothing about
    // whether the one they are worried about is among them.
    limitations.unshift(
      `Read from ${components.length} cost line(s): ${components
        .map((component) => COMPONENT_LABEL[component.metricKey])
        .join(", ")}.`,
    );
    if (sharedPeriodCount < windowPeriodCount) {
      limitations.splice(
        1,
        0,
        `Read over the ${sharedPeriodCount} period(s) carrying both revenue and a cost, out of ${windowPeriodCount} carrying either.`,
      );
    }

    const denominator = revenueShared.map((point) => ({
      kind: "normalized_metric" as const,
      role: "denominator" as const,
      id: point.normalizedMetricId,
    }));

    const outcomes: DetectorOutcome[] = [
      {
        kind: "observation",
        code: "COMPANY_COST_STRUCTURE_OF_REVENUE",
        channelId: window.channelId ?? undefined,
        branchId: window.branchId ?? undefined,
        metricKey: REVENUE,
        periodStart: window.windowStart,
        periodEnd: window.windowEnd,
        measurement: {
          valueKind: "ratio",
          numerator: sumNumerators(costPoints),
          denominator: revenueTotal,
          currency,
        },
        expectedPeriodCount: windowPeriodCount,
        observedPeriodCount: sharedPeriodCount,
        qualityState: "complete",
        limitations,
        evidence: [
          ...costPoints.map((point) => ({
            kind: "normalized_metric" as const,
            role: "component" as const,
            id: point.normalizedMetricId,
          })),
          ...denominator,
        ],
      },
    ];

    // Each line on its own as well as the total. A reader deciding what to do
    // needs to know whether the cost sits in the kitchen or in the commission,
    // and a single combined ratio hides exactly that.
    for (const component of components) {
      outcomes.push({
        kind: "observation",
        code: "COMPANY_COST_LINE_SHARE_OF_REVENUE",
        channelId: window.channelId ?? undefined,
        branchId: window.branchId ?? undefined,
        metricKey: component.metricKey,
        periodStart: window.windowStart,
        periodEnd: window.windowEnd,
        measurement: {
          valueKind: "ratio",
          numerator: sumNumerators(component.points),
          denominator: revenueTotal,
          currency,
        },
        expectedPeriodCount: windowPeriodCount,
        observedPeriodCount: new Set(component.points.map((point) => point.periodStart)).size,
        qualityState: "complete",
        limitations,
        evidence: [
          ...component.points.map((point) => ({
            kind: "normalized_metric" as const,
            role: "component" as const,
            id: point.normalizedMetricId,
          })),
          ...denominator,
        ],
      });
    }

    return outcomes;
  },
};
