import { selectComparablePoints, singleCurrency, sumNumerators } from "@/domain/analysis/evidence";
import type {
  AnalysisEvidence,
  AnalysisSeriesPoint,
  DetectorDeclaration,
  DetectorNeedsData,
  DetectorOutcome,
  FindingEvidenceReference,
} from "@/domain/analysis/types";

/**
 * Avoidable cancellations over a window, with the provider's own price on
 * rejections.
 *
 * This is the second detector in the registry whose monetary impact is
 * computable, and the reason is narrow: the export prints a revenue-loss-from-
 * rejections figure the provider measured itself. Declaring that figure is
 * reporting a measurement; deriving a cost for cancellations nobody priced
 * would be modelling one. The two figures therefore travel side by side and
 * never merge -- the count says how often orders fell apart, the money says
 * what the provider itself recorded losing to rejected items, and neither is
 * extrapolated onto the other. See ADR 0035.
 */

const AVOIDABLE_CANCELLATIONS = "order.avoidable_cancellation_count";
const REJECTION_LOSS = "revenue.rejection_loss";
/** Why the rejectable orders were lost, as the provider labels them (ADR 0034). */
const CANCELLATION_REASON = "order.avoidable_cancellation_reason";
/** The one dimension key the cancellation-reason grouping reads, per the contract. */
const REASON_DIMENSION = "reason_code";

function refuse(
  evidence: AnalysisEvidence,
  reason: string,
  limitations: readonly string[] = [],
): DetectorNeedsData {
  return {
    kind: "needs_data",
    code: "ORDER_CANCELLATION_LOSS_UNAVAILABLE",
    needsDataReason: reason,
    channelId: evidence.window.channelId ?? undefined,
    branchId: evidence.window.branchId ?? undefined,
    metricKey: AVOIDABLE_CANCELLATIONS,
    periodStart: evidence.window.windowStart,
    periodEnd: evidence.window.windowEnd,
    qualityState: "complete",
    limitations,
    evidence: [],
  };
}

export const ordersCancellationLossDetector: DetectorDeclaration = {
  key: "orders.cancellation_loss",
  calculationVersion: 1,
  owner: "core",
  scope: "channel",
  compatibleGrains: ["day", "week", "month"],
  exactRangeEvidence: "refused",
  requiredMetricKeys: [AVOIDABLE_CANCELLATIONS, REJECTION_LOSS],
  optionalMetricKeys: [CANCELLATION_REASON],
  minimumQualityTier: "derived",
  acceptedReconciliationStates: ["current"],
  evidenceContract: [
    "Current period-grain observations of order.avoidable_cancellation_count in the window.",
    "Current period-grain observations of revenue.rejection_loss in the window, in one shared currency.",
    "Optionally, current observations of order.avoidable_cancellation_reason carrying a reason_code dimension value (ADR 0034).",
  ],
  severityRules: [
    "None. How many avoidable cancellations occurred, and what the provider recorded losing to rejections, are facts; no agreed threshold turns either into a problem of a given severity.",
  ],
  monetaryImpact: {
    computable: true,
    method:
      "The provider's own reported revenue loss from rejected items (revenue.rejection_loss), summed in integer minor units over the periods that reported it. It is a measurement the provider printed, never a model of what cancellations or rejections might have cost.",
  },
  limitations: [
    "The rejection loss covers exactly what the provider says it covers. It is not extended to cancelled orders it does not mention, and the avoidance count is not converted into money.",
    "Both figures describe the provider's own account of the window; neither is reconciled against the platform's order ledger.",
  ],
  needsDataConditions: [
    "No current evidence for order.avoidable_cancellation_count in the window.",
    "No current evidence for revenue.rejection_loss in the window.",
    "The rejection-loss observations carry more than one currency, or none.",
  ],

  run(evidence: AnalysisEvidence): readonly DetectorOutcome[] {
    const { window } = evidence;

    const cancellations = selectComparablePoints(evidence, {
      metricKey: AVOIDABLE_CANCELLATIONS,
      minimumQualityTier: ordersCancellationLossDetector.minimumQualityTier,
    });
    const losses = selectComparablePoints(evidence, {
      metricKey: REJECTION_LOSS,
      minimumQualityTier: ordersCancellationLossDetector.minimumQualityTier,
    });

    if (cancellations.accepted.length === 0 || losses.accepted.length === 0) {
      // Both halves of the observation are required. Reporting the count
      // without its declared monetary impact would silently demote this
      // finding out of the cost-led ordering the workspace ranks by.
      const absent = [
        ...(cancellations.accepted.length === 0 ? [AVOIDABLE_CANCELLATIONS] : []),
        ...(losses.accepted.length === 0 ? [REJECTION_LOSS] : []),
      ];
      return [
        refuse(evidence, "CANCELLATION_LOSS_SERIES_ABSENT", [
          `No figures were reported for ${absent.join(" or ")} in this window.`,
        ]),
      ];
    }

    const currency = singleCurrency(losses.accepted);
    if (currency === "mixed") return [refuse(evidence, "MIXED_CURRENCY")];
    if (currency === null) return [refuse(evidence, "CURRENCY_UNAVAILABLE")];

    const setAsideCount = cancellations.setAsideCount + losses.setAsideCount;
    const limitations = [
      "The rejection loss is the provider's own figure for revenue lost to rejected items; it prices no cancellation the provider did not price itself.",
    ];
    if (setAsideCount > 0) {
      limitations.push(
        "Some rows for these metrics were set aside as incomparable and took no part in either sum.",
      );
    }

    const avoidableCount = sumNumerators(cancellations.accepted);
    const rejectionLossMinorUnits = sumNumerators(losses.accepted);

    const outcomes: DetectorOutcome[] = [
      {
        kind: "observation",
        code: "ORDER_CANCELLATION_LOSS",
        channelId: window.channelId ?? undefined,
        branchId: window.branchId ?? undefined,
        metricKey: AVOIDABLE_CANCELLATIONS,
        periodStart: window.windowStart,
        periodEnd: window.windowEnd,
        // The count is the subject; the impact rides beside it under the
        // declaration that names the method. The currency belongs to the
        // impact, which is the only money here.
        measurement: {
          valueKind: "count",
          numerator: avoidableCount,
          currency,
          monetaryImpactMinorUnits: rejectionLossMinorUnits,
        },
        qualityState: setAsideCount > 0 ? "partial" : "complete",
        limitations,
        evidence: [
          ...cancellations.accepted.map((row) => ({
            kind: "normalized_metric" as const,
            role: "component" as const,
            id: row.normalizedMetricId,
          })),
          ...losses.accepted.map((row) => ({
            kind: "normalized_metric" as const,
            role: "component" as const,
            id: row.normalizedMetricId,
          })),
        ],
      },
    ];

    // One observation per cancel-reason label present, so an operator reads
    // "every avoidable cancellation this window was ITEM_UNAVAILABLE" as
    // counted evidence rather than as prose. Grouping by a dimension value is a
    // read-time concern (ADR 0034); nothing here switches on which label it is,
    // and a label outside the approved vocabulary cannot occur -- the import
    // refused it.
    const reasons = selectComparablePoints(evidence, {
      metricKey: CANCELLATION_REASON,
      minimumQualityTier: ordersCancellationLossDetector.minimumQualityTier,
    });
    const byReason = new Map<string, AnalysisSeriesPoint[]>();
    for (const row of reasons.accepted) {
      const reason = row.dimensions[REASON_DIMENSION];
      // A reason row without the declared dimension carries no grouping this
      // detector may read, so its days stay out of every reason group.
      if (!reason) continue;
      const group = byReason.get(reason) ?? [];
      group.push(row);
      byReason.set(reason, group);
    }

    const reasonSetAsideCount = reasons.setAsideCount;
    for (const reason of [...byReason.keys()].sort()) {
      const rows = byReason.get(reason) ?? [];
      const citations: FindingEvidenceReference[] = rows.map((row) => ({
        kind: "normalized_metric" as const,
        role: "component" as const,
        id: row.normalizedMetricId,
      }));
      const reasonLimitations: string[] = [
        `Days the provider marked ${reason}. The labels are the provider's own vocabulary, counted as it wrote them.`,
      ];
      if (reasonSetAsideCount > 0) {
        reasonLimitations.push(
          "Some rows for this metric were set aside as incomparable and are not counted here.",
        );
      }
      outcomes.push({
        kind: "observation",
        code: "ORDER_CANCELLATION_REASON",
        channelId: window.channelId ?? undefined,
        branchId: window.branchId ?? undefined,
        metricKey: CANCELLATION_REASON,
        periodStart: window.windowStart,
        periodEnd: window.windowEnd,
        measurement: { valueKind: "count", numerator: sumNumerators(rows) },
        qualityState: reasonSetAsideCount > 0 ? "partial" : "complete",
        limitations: reasonLimitations,
        evidence: citations,
      });
    }

    return outcomes;
  },
};
