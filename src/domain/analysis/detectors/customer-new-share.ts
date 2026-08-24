import { enumerateLocalPeriodStarts } from "@/domain/analysis/calendar";
import { selectComparablePoints, sumNumerators } from "@/domain/analysis/evidence";
import type {
  AnalysisEvidence,
  AnalysisSeriesPoint,
  DetectorDeclaration,
  DetectorNeedsData,
  DetectorOutcome,
} from "@/domain/analysis/types";

/**
 * The provider's own split of orders between new and returning customers.
 *
 * The repeat share is one figure the export reports directly in two parts: how
 * many orders came from first-time customers and how many came back. Both are
 * summed over the window, and both travel with the share as numerator and
 * denominator, so a reader can restate it over any wider window without a
 * stored quotient getting in the way.
 *
 * No money is stated for any of it. A returning customer is worth exactly what
 * an export says -- here, nothing -- and pricing retention would need a
 * baseline and a method this platform has not declared (ADR 0035).
 */

const NEW_ORDERS = "customer.new_order_count";
const RETURNING_ORDERS = "customer.returning_order_count";

function refuse(evidence: AnalysisEvidence, absent: readonly string[]): DetectorNeedsData {
  return {
    kind: "needs_data",
    code: "CUSTOMER_NEW_SHARE_UNAVAILABLE",
    needsDataReason: "CUSTOMER_MIX_SERIES_ABSENT",
    channelId: evidence.window.channelId ?? undefined,
    branchId: evidence.window.branchId ?? undefined,
    metricKey: NEW_ORDERS,
    periodStart: evidence.window.windowStart,
    periodEnd: evidence.window.windowEnd,
    qualityState: "complete",
    limitations: [
      `No figures were reported for ${absent.join(" or ")} in this window, so no customer mix can be computed.`,
    ],
    evidence: [],
  };
}

export const customerNewShareDetector: DetectorDeclaration = {
  key: "customer.new_share",
  calculationVersion: 1,
  owner: "core",
  scope: "channel",
  compatibleGrains: ["day", "week", "month"],
  // An arbitrary-span total cannot be told apart from the days inside it, so
  // it can take no part in a period-bucketed share.
  exactRangeEvidence: "refused",
  requiredMetricKeys: [NEW_ORDERS, RETURNING_ORDERS],
  optionalMetricKeys: [],
  minimumQualityTier: "derived",
  acceptedReconciliationStates: ["current"],
  evidenceContract: [
    "Current period-grain observations of customer.new_order_count and customer.returning_order_count in the window.",
    "One channel, branch, grain, and recorded timezone across every contributing observation.",
  ],
  severityRules: [
    "None. The mix of new and returning orders is an authoritative observation; no agreed threshold exists at which a repeat share becomes a problem of a given severity.",
  ],
  monetaryImpact: {
    computable: false,
    reason:
      "The export prices neither a new nor a returning order. Valuing retention needs a declared baseline and attribution method, which does not exist yet (ADR 0035).",
  },
  limitations: [
    "Both counts are the provider's own account of its own customers; they are not reconciled against the platform's order ledger.",
  ],
  needsDataConditions: [
    "No current evidence for either series in the window.",
    "Every reported order count in the window is zero, which leaves no share defined.",
  ],

  run(evidence: AnalysisEvidence): readonly DetectorOutcome[] {
    const { window } = evidence;

    const fresh = selectComparablePoints(evidence, {
      metricKey: NEW_ORDERS,
      minimumQualityTier: customerNewShareDetector.minimumQualityTier,
    });
    const returning = selectComparablePoints(evidence, {
      metricKey: RETURNING_ORDERS,
      minimumQualityTier: customerNewShareDetector.minimumQualityTier,
    });

    if (fresh.accepted.length === 0 || returning.accepted.length === 0) {
      const absent = [
        ...(fresh.accepted.length === 0 ? [NEW_ORDERS] : []),
        ...(returning.accepted.length === 0 ? [RETURNING_ORDERS] : []),
      ];
      return [refuse(evidence, absent)];
    }

    const newCount = sumNumerators(fresh.accepted);
    const returningCount = sumNumerators(returning.accepted);
    const total = newCount + returningCount;

    // A window that reported only zeros has a share of nothing. Reporting
    // zero percent would read as "nobody came back" over what is really
    // "nobody ordered".
    if (total === 0) {
      return [
        {
          kind: "needs_data",
          code: "CUSTOMER_NEW_SHARE_UNAVAILABLE",
          needsDataReason: "CUSTOMER_ORDER_TOTAL_IS_ZERO",
          channelId: window.channelId ?? undefined,
          branchId: window.branchId ?? undefined,
          metricKey: NEW_ORDERS,
          periodStart: window.windowStart,
          periodEnd: window.windowEnd,
          qualityState: "complete",
          limitations: [],
          evidence: [],
        },
      ];
    }

    const expectedPeriodCount = enumerateLocalPeriodStarts(
      window.windowStart,
      window.windowEnd,
      window.grain,
    ).length;
    const setAsideCount = fresh.setAsideCount + returning.setAsideCount;

    const limitations = [
      "Numerator and denominator are the summed series themselves; the quotient is derived where it is shown, never stored.",
    ];
    if (setAsideCount > 0) {
      limitations.push(
        "Some rows for these metrics were set aside as incomparable and took no part in either sum.",
      );
    }

    return [
      {
        kind: "observation",
        code: "CUSTOMER_REPEAT_SHARE",
        channelId: window.channelId ?? undefined,
        branchId: window.branchId ?? undefined,
        metricKey: RETURNING_ORDERS,
        periodStart: window.windowStart,
        periodEnd: window.windowEnd,
        measurement: {
          valueKind: "ratio",
          numerator: returningCount,
          denominator: total,
        },
        expectedPeriodCount,
        observedPeriodCount: distinctPeriodStarts(returning.accepted).length,
        absentPeriodCount: expectedPeriodCount - distinctPeriodStarts(returning.accepted).length,
        qualityState: setAsideCount > 0 ? "partial" : "complete",
        limitations,
        evidence: [
          ...fresh.accepted.map((row) => ({
            kind: "normalized_metric" as const,
            role: "component" as const,
            id: row.normalizedMetricId,
          })),
          ...returning.accepted.map((row) => ({
            kind: "normalized_metric" as const,
            role: "component" as const,
            id: row.normalizedMetricId,
          })),
        ],
      },
    ];
  },
};

function distinctPeriodStarts(rows: readonly AnalysisSeriesPoint[]): string[] {
  return [...new Set(rows.map((row) => row.periodStart))];
}
