import { enumerateLocalPeriodStarts } from "@/domain/analysis/calendar";
import { selectComparablePoints, sumNumerators } from "@/domain/analysis/evidence";
import type {
  AnalysisEvidence,
  AnalysisSeriesPoint,
  DetectorDeclaration,
  DetectorNeedsData,
  DetectorOutcome,
  FindingEvidenceReference,
} from "@/domain/analysis/types";

/**
 * Conversion between the funnel stages the provider reports, for one channel.
 *
 * Every ratio here is two summed series the ledger already holds, divided
 * nowhere: the numerator and denominator travel together, so a share stored as
 * a decimal can never be re-aggregated over a wider window. The stages are the
 * provider's own vocabulary -- impressions, menu views, add-to-cart, placed
 * orders -- and nothing between them is interpolated. A stage the export does
 * not report leaves its pair without an answer, which is stated rather than
 * skipped, because a missing step that reads as a complete funnel is worse
 * than no funnel.
 */

const IMPRESSIONS = "listing.impressions";
const MENU_VIEWS = "listing.menu_views";
const CART_ADDITIONS = "listing.cart_additions";
const PLACED_ORDERS = "listing.placed_orders";

/** The consecutive pairs in funnel order, then the whole span in one figure. */
const STAGE_PAIRS: readonly { code: string; numeratorKey: string; denominatorKey: string }[] = [
  { code: "FUNNEL_STAGE_CONVERSION", numeratorKey: MENU_VIEWS, denominatorKey: IMPRESSIONS },
  { code: "FUNNEL_STAGE_CONVERSION", numeratorKey: CART_ADDITIONS, denominatorKey: MENU_VIEWS },
  { code: "FUNNEL_STAGE_CONVERSION", numeratorKey: PLACED_ORDERS, denominatorKey: CART_ADDITIONS },
];

function refuse(
  evidence: AnalysisEvidence,
  metricKey: string | undefined,
  reason: string,
  limitations: readonly string[],
): DetectorNeedsData {
  return {
    kind: "needs_data",
    code: "FUNNEL_STAGE_CONVERSION_UNAVAILABLE",
    needsDataReason: reason,
    channelId: evidence.window.channelId ?? undefined,
    branchId: evidence.window.branchId ?? undefined,
    ...(metricKey ? { metricKey } : {}),
    periodStart: evidence.window.windowStart,
    periodEnd: evidence.window.windowEnd,
    qualityState: "complete",
    limitations,
    evidence: [],
  };
}

export const funnelStageConversionDetector: DetectorDeclaration = {
  key: "funnel.stage_conversion",
  calculationVersion: 1,
  owner: "core",
  scope: "channel",
  compatibleGrains: ["day", "week", "month"],
  // A total covering an arbitrary span has no place in a series of periods,
  // and half a funnel built on one would look like a whole one.
  exactRangeEvidence: "refused",
  requiredMetricKeys: [IMPRESSIONS, MENU_VIEWS, CART_ADDITIONS, PLACED_ORDERS],
  optionalMetricKeys: [],
  minimumQualityTier: "derived",
  acceptedReconciliationStates: ["current"],
  evidenceContract: [
    "Current period-grain observations of the listing funnel metrics, bucketed in the window's own timezone.",
    "One channel, branch, grain, and recorded timezone across every contributing observation.",
  ],
  severityRules: [
    "None. A conversion rate is an authoritative observation, and no agreed threshold exists at which a stage's conversion becomes a problem of a given severity.",
  ],
  monetaryImpact: {
    computable: false,
    reason:
      "Pricing a lost conversion needs a value per missed order and a belief about what the missing steps would have done. Neither is measured, so no money is stated.",
  },
  limitations: [
    "Each stage is summed over the periods it reported; where two stages reported different sets of periods, their pair describes those sets rather than one window.",
    "The stages are the provider's own counts of its own events; they are not audited against the platform's order ledger.",
  ],
  needsDataConditions: [
    "No current evidence for listing.impressions in the window, which leaves even the end-to-end span undefined.",
    "Either series of a stage pair carries no current evidence in the window.",
  ],

  run(evidence: AnalysisEvidence): readonly DetectorOutcome[] {
    const { window } = evidence;

    const selected = new Map<string, ReturnType<typeof selectComparablePoints>>();
    for (const key of funnelStageConversionDetector.requiredMetricKeys) {
      selected.set(
        key,
        selectComparablePoints(evidence, {
          metricKey: key,
          minimumQualityTier: funnelStageConversionDetector.minimumQualityTier,
        }),
      );
    }

    const impressions = selected.get(IMPRESSIONS)?.accepted ?? [];
    if (impressions.length === 0) {
      // Without the top of the funnel nothing can be converted against it --
      // not the stage pairs below it, and not the impression-to-order span.
      // Reporting each pair separately would dress one absence up as several.
      const missing = funnelStageConversionDetector.requiredMetricKeys.filter(
        (key) => (selected.get(key)?.accepted.length ?? 0) === 0 && key !== IMPRESSIONS,
      );
      return [
        refuse(
          evidence,
          IMPRESSIONS,
          "IMPRESSION_SERIES_ABSENT",
          missing.length > 0
            ? [
                `No figures were reported for ${[IMPRESSIONS, ...missing].join(", ")} in this window.`,
              ]
            : [`No figures were reported for ${IMPRESSIONS} in this window.`],
        ),
      ];
    }

    const expectedPeriodCount = enumerateLocalPeriodStarts(
      window.windowStart,
      window.windowEnd,
      window.grain,
    ).length;

    const outcomes: DetectorOutcome[] = [];
    for (const pair of STAGE_PAIRS) {
      outcomes.push(...stagePairOutcome(pair, selected, window, expectedPeriodCount));
    }

    // The whole span shares the shape of a stage pair, but it answers a
    // different question -- what an impression is ultimately worth in orders
    // -- so it carries its own code rather than masquerading as a step.
    outcomes.push(
      ...stagePairOutcome(
        {
          code: "FUNNEL_STAGE_CONVERSION_END_TO_END",
          numeratorKey: PLACED_ORDERS,
          denominatorKey: IMPRESSIONS,
        },
        selected,
        window,
        expectedPeriodCount,
      ),
    );

    return outcomes;
  },
};

/**
 * One outcome for one pair of summed series: an observation when both sides
 * have evidence, a named refusal when either does not. Nothing is filled in.
 */
function stagePairOutcome(
  pair: { code: string; numeratorKey: string; denominatorKey: string },
  selected: Map<string, ReturnType<typeof selectComparablePoints>>,
  window: AnalysisEvidence["window"],
  expectedPeriodCount: number,
): readonly DetectorOutcome[] {
  const numeratorSelection = selected.get(pair.numeratorKey);
  const denominatorSelection = selected.get(pair.denominatorKey);
  if (!numeratorSelection || !denominatorSelection) return [];

  const numeratorPoints = numeratorSelection.accepted;
  const denominatorPoints = denominatorSelection.accepted;

  if (numeratorPoints.length === 0 || denominatorPoints.length === 0) {
    const absent = [pair.numeratorKey, pair.denominatorKey].filter(
      (key) => (selected.get(key)?.accepted.length ?? 0) === 0,
    );
    return [
      {
        kind: "needs_data",
        code: "FUNNEL_STAGE_CONVERSION_UNAVAILABLE",
        needsDataReason: "STAGE_SERIES_ABSENT",
        channelId: window.channelId ?? undefined,
        branchId: window.branchId ?? undefined,
        metricKey: pair.numeratorKey,
        periodStart: window.windowStart,
        periodEnd: window.windowEnd,
        qualityState: "complete",
        limitations: [
          `No figures were reported for ${absent.join(" or ")} in this window, so this pair cannot be converted.`,
        ],
        evidence: [],
      },
    ];
  }

  const setAsideCount = numeratorSelection.setAsideCount + denominatorSelection.setAsideCount;
  const observedPeriods = distinctPeriodStarts(numeratorPoints);
  const denominatorPeriods = distinctPeriodStarts(denominatorPoints);

  const limitations = [
    "Numerators and denominators are the summed series themselves; the quotient is derived where it is shown, never stored.",
  ];
  if (
    observedPeriods.some((period) => !denominatorPeriods.includes(period)) ||
    denominatorPeriods.some((period) => !observedPeriods.includes(period))
  ) {
    limitations.push(
      "The two stages were reported over different sets of periods; each side is summed over its own.",
    );
  }
  if (setAsideCount > 0) {
    limitations.push(
      "Some rows for these metrics were set aside as incomparable and took no part in either sum.",
    );
  }

  const evidence: FindingEvidenceReference[] = [
    ...numeratorPoints.map((row) => ({
      kind: "normalized_metric" as const,
      role: "component" as const,
      id: row.normalizedMetricId,
    })),
    ...denominatorPoints.map((row) => ({
      kind: "normalized_metric" as const,
      role: "denominator" as const,
      id: row.normalizedMetricId,
    })),
  ];

  return [
    {
      kind: "observation",
      code: pair.code,
      channelId: window.channelId ?? undefined,
      branchId: window.branchId ?? undefined,
      metricKey: pair.numeratorKey,
      periodStart: window.windowStart,
      periodEnd: window.windowEnd,
      measurement: {
        valueKind: "ratio",
        numerator: sumNumerators(numeratorPoints),
        denominator: sumNumerators(denominatorPoints),
      },
      expectedPeriodCount,
      observedPeriodCount: observedPeriods.length,
      absentPeriodCount: expectedPeriodCount - observedPeriods.length,
      qualityState: setAsideCount > 0 ? "partial" : "complete",
      limitations,
      evidence,
    },
  ];
}

function distinctPeriodStarts(points: readonly AnalysisSeriesPoint[]): string[] {
  return [...new Set(points.map((row) => row.periodStart))];
}
