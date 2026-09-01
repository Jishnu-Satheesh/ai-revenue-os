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
 * Who cancelled the order, as the marketplace itself recorded it.
 *
 * The platform has counted this channel's cancellations for weeks with no fault
 * attached to any of them, because the column naming the party is written in
 * sentences and the projection language could not read them. It can now, so the
 * question "whose cancellations are these" has an answer built from the
 * provider's own labels rather than from an assumption.
 *
 * It states counts and the proportions between them, and stops there. Nothing
 * here switches on which party a label names -- the vocabulary belongs to the
 * provider and arrives through an approved label map (ADR 0034), so a core
 * detector that recognised "merchant" would be reading one marketplace's words
 * as if they were the platform's own.
 *
 * What it counts is orders the provider attributed to a party. That is not the
 * channel's cancelled-order count and is not expected to equal it: a partially
 * refunded order carries an attribution while the provider still counts it as
 * fulfilled. Saying so is the difference between a figure a reader can trust
 * and one that quietly disagrees with the count beside it.
 */

const ATTRIBUTION = "order.cancellation_attribution_count";
const TOTAL_ORDERS = "order.total_count";
/** The one dimension key the party grouping reads, per the contract. */
const PARTY_DIMENSION = "cancelled_by";

function refuse(
  evidence: AnalysisEvidence,
  reason: string,
  limitations: readonly string[] = [],
): DetectorNeedsData {
  return {
    kind: "needs_data",
    code: "ORDER_CANCELLATION_ATTRIBUTION_UNAVAILABLE",
    needsDataReason: reason,
    channelId: evidence.window.channelId ?? undefined,
    branchId: evidence.window.branchId ?? undefined,
    metricKey: ATTRIBUTION,
    periodStart: evidence.window.windowStart,
    periodEnd: evidence.window.windowEnd,
    qualityState: "complete",
    limitations,
    evidence: [],
  };
}

function cite(rows: readonly AnalysisSeriesPoint[]): FindingEvidenceReference[] {
  return rows.map((row) => ({
    kind: "normalized_metric" as const,
    role: "component" as const,
    id: row.normalizedMetricId,
  }));
}

export const ordersCancellationAttributionDetector: DetectorDeclaration = {
  key: "orders.cancellation_attribution",
  calculationVersion: 1,
  owner: "core",
  scope: "channel",
  compatibleGrains: ["day", "week", "month"],
  // A span states one total with no periods to intersect, so the shared-day
  // safeguard the share depends on cannot be applied to it.
  exactRangeEvidence: "refused",
  requiredMetricKeys: [ATTRIBUTION],
  optionalMetricKeys: [TOTAL_ORDERS],
  minimumQualityTier: "derived",
  acceptedReconciliationStates: ["current"],
  evidenceContract: [
    "Current period-grain observations of order.cancellation_attribution_count in the window, each carrying a cancelled_by dimension value (ADR 0034).",
    "Optionally, current period-grain observations of order.total_count for the same channel, branch and periods, which the share of orders is measured against.",
  ],
  severityRules: [
    "None. Who cancelled an order is a fact the provider recorded; no agreed threshold turns a given party's share into a problem of a given severity.",
  ],
  monetaryImpact: {
    computable: false,
    reason:
      "This provider prices no cancellation. Multiplying a cancelled order by an average basket would be a model presented as a measurement, and the order values that were lost are not in any approved report.",
  },
  limitations: [
    "Counts orders the provider attributed to a party. A partially refunded order carries an attribution while the provider still counts it as fulfilled, so this figure is not the channel's cancelled-order count and is not expected to equal it.",
    "The party names are the provider's own vocabulary, translated by the approved label map and counted as written. Nothing here judges whether the provider attributed correctly.",
  ],
  needsDataConditions: [
    "No current governed order.cancellation_attribution_count evidence exists in the window.",
    "No attribution row carries the declared cancelled_by dimension, so there is no party to report.",
  ],

  run(evidence: AnalysisEvidence): readonly DetectorOutcome[] {
    const { window } = evidence;

    const attributions = selectComparablePoints(evidence, {
      metricKey: ATTRIBUTION,
      minimumQualityTier: ordersCancellationAttributionDetector.minimumQualityTier,
    });
    if (attributions.accepted.length === 0) {
      return [refuse(evidence, "CANCELLATION_ATTRIBUTION_SERIES_ABSENT")];
    }

    // A row without the declared dimension carries no grouping this detector
    // may read, so it takes no part in any party's count.
    const dimensioned = attributions.accepted.filter((row) => !!row.dimensions[PARTY_DIMENSION]);
    if (dimensioned.length === 0) {
      return [refuse(evidence, "CANCELLATION_ATTRIBUTION_UNDIMENSIONED")];
    }

    const setAside = attributions.setAsideCount + (attributions.accepted.length - dimensioned.length);
    const baseLimitations = [...ordersCancellationAttributionDetector.limitations];
    if (setAside > 0) {
      baseLimitations.push(
        "Some rows for this metric were set aside as incomparable or carried no party, and are not counted here.",
      );
    }

    const attributedTotal = sumNumerators(dimensioned);
    const outcomes: DetectorOutcome[] = [
      {
        kind: "observation",
        code: "ORDER_CANCELLATION_ATTRIBUTION_TOTAL",
        channelId: window.channelId ?? undefined,
        branchId: window.branchId ?? undefined,
        metricKey: ATTRIBUTION,
        periodStart: window.windowStart,
        periodEnd: window.windowEnd,
        measurement: { valueKind: "count", numerator: attributedTotal },
        qualityState: setAside > 0 ? "partial" : "complete",
        limitations: baseLimitations,
        evidence: cite(dimensioned),
      },
    ];

    // Against the orders the channel took, where an approved report says how
    // many that was. Restricted to the days carrying both, for the reason
    // `economics.commission_share` gives: a count over two months divided by an
    // order total over one is a rate roughly twice the truth, from two figures
    // that are each individually correct.
    const orders = selectComparablePoints(evidence, {
      metricKey: TOTAL_ORDERS,
      minimumQualityTier: ordersCancellationAttributionDetector.minimumQualityTier,
    });
    if (orders.accepted.length > 0) {
      const orderDays = new Set(orders.accepted.map((point) => point.periodStart));
      const attributionDays = new Set(dimensioned.map((point) => point.periodStart));
      const attributionsShared = dimensioned.filter((point) => orderDays.has(point.periodStart));
      const ordersShared = orders.accepted.filter((point) => attributionDays.has(point.periodStart));
      const ordersTotal = sumNumerators(ordersShared);
      // A share of no orders is undefined, not zero.
      if (attributionsShared.length > 0 && ordersTotal > 0) {
        const sharedDayCount = new Set(attributionsShared.map((point) => point.periodStart)).size;
        const eitherDayCount = new Set([...orderDays, ...attributionDays]).size;
        const shareLimitations = [...baseLimitations];
        if (sharedDayCount < eitherDayCount) {
          shareLimitations.unshift(
            `Read over the ${sharedDayCount} day(s) carrying both an attribution and an order count, out of ${eitherDayCount} day(s) carrying either. The share describes those days and not the rest of the window.`,
          );
        }
        outcomes.push({
          kind: "observation",
          code: "ORDER_CANCELLATION_ATTRIBUTION_SHARE_OF_ORDERS",
          channelId: window.channelId ?? undefined,
          branchId: window.branchId ?? undefined,
          metricKey: ATTRIBUTION,
          periodStart: window.windowStart,
          periodEnd: window.windowEnd,
          measurement: {
            valueKind: "ratio",
            numerator: sumNumerators(attributionsShared),
            denominator: ordersTotal,
          },
          qualityState: setAside > 0 ? "partial" : "complete",
          limitations: shareLimitations,
          evidence: [...cite(attributionsShared), ...cite(ordersShared)],
        });
      }
    }

    // One observation per party present, largest first, so the party carrying
    // most of the window's cancellations is the one a reader meets first.
    const byParty = new Map<string, AnalysisSeriesPoint[]>();
    for (const row of dimensioned) {
      const party = row.dimensions[PARTY_DIMENSION] as string;
      const group = byParty.get(party) ?? [];
      group.push(row);
      byParty.set(party, group);
    }
    const ranked = [...byParty.entries()]
      .map(([party, rows]) => ({ party, rows, total: sumNumerators(rows) }))
      .sort((left, right) => right.total - left.total || left.party.localeCompare(right.party));

    for (const { party, rows, total } of ranked) {
      outcomes.push({
        kind: "observation",
        code: "ORDER_CANCELLATION_ATTRIBUTION_PARTY",
        channelId: window.channelId ?? undefined,
        branchId: window.branchId ?? undefined,
        metricKey: ATTRIBUTION,
        periodStart: window.windowStart,
        periodEnd: window.windowEnd,
        measurement: { valueKind: "ratio", numerator: total, denominator: attributedTotal },
        qualityState: setAside > 0 ? "partial" : "complete",
        limitations: [
          `Orders the provider attributed to ${party}, out of every order it attributed to any party in this window.`,
          ...baseLimitations,
        ],
        evidence: cite(rows),
      });
    }

    return outcomes;
  },
};
