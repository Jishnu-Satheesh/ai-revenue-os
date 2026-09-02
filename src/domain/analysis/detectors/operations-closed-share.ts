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
 * How much of its scheduled time a channel reported itself closed, and why.
 *
 * The share is two series the provider measured in minutes -- closed against
 * scheduled -- carried as numerator and denominator exactly as summed, never
 * as a quotient that could not be re-aggregated over a wider window. The
 * minutes are quantities, so their sums keep whatever decimals the provider
 * wrote per day; rounding them here would fabricate time nobody lost (ADR 0036).
 *
 * The reasons ride beside whole-day counts as dimension values (ADR 0034), so
 * one observation is emitted per reason value found in the window. The labels
 * are the provider's own snapshot: none is treated specially, an unknown one is
 * reported like any other rather than absorbed into an "other", and no money is
 * stated for any of it -- the export prices no closed hour, and inventing a
 * conversion would put a modelled figure where a measurement belongs (ADR 0035).
 */

const CLOSED_MINUTES = "operations.closed_minutes";
const SCHEDULED_MINUTES = "operations.scheduled_minutes";
const CLOSED_DAYS = "operations.closed_days";
/** The one dimension key this detector groups by, per the declaring contract. */
const REASON_DIMENSION = "reason_code";

function refuse(evidence: AnalysisEvidence, absent: readonly string[]): DetectorNeedsData {
  return {
    kind: "needs_data",
    code: "OPERATIONS_CLOSED_SHARE_UNAVAILABLE",
    needsDataReason: "CLOSED_SHARE_SERIES_ABSENT",
    channelId: evidence.window.channelId ?? undefined,
    branchId: evidence.window.branchId ?? undefined,
    metricKey: CLOSED_MINUTES,
    periodStart: evidence.window.windowStart,
    periodEnd: evidence.window.windowEnd,
    qualityState: "complete",
    limitations: [
      `No figures were reported for ${absent.join(" or ")} in this window, so no share of scheduled time can be computed.`,
    ],
    evidence: [],
  };
}

export const operationsClosedShareDetector: DetectorDeclaration = {
  key: "operations.closed_share",
  calculationVersion: 1,
  owner: "core",
  scope: "channel",
  compatibleGrains: ["day", "week", "month"],
  // An arbitrary-span total of minutes has no place among bucketed periods;
  // half an availability answer built on one would look like a whole one.
  exactRangeEvidence: "refused",
  requiredMetricKeys: [CLOSED_MINUTES, SCHEDULED_MINUTES],
  optionalMetricKeys: [CLOSED_DAYS],
  minimumQualityTier: "derived",
  acceptedReconciliationStates: ["current"],
  evidenceContract: [
    "Current period-grain observations of operations.closed_minutes and operations.scheduled_minutes in the window.",
    "Optionally, current observations of operations.closed_days carrying a reason_code dimension value (ADR 0034).",
    "One channel, branch, grain, and recorded timezone across every contributing observation.",
  ],
  severityRules: [
    "None. A share of scheduled time spent closed is an authoritative observation, and no agreed threshold exists at which availability becomes a problem of a given severity.",
  ],
  monetaryImpact: {
    computable: false,
    reason:
      "The export states no money for a closed minute or a closed day. Pricing one needs a conversion rate and an average order value applied to hours nobody traded, which would fabricate a figure (ADR 0035).",
  },
  limitations: [
    "The provider counts each closed day once, by its own first-listed reason; the reasons are its labels, not a platform classification.",
    "The minute totals are summed exactly as the provider wrote them per day, including the decimals it rounded to.",
  ],
  needsDataConditions: [
    "No current evidence for operations.closed_minutes or operations.scheduled_minutes in the window.",
  ],

  run(evidence: AnalysisEvidence): readonly DetectorOutcome[] {
    const { window } = evidence;

    const closed = selectComparablePoints(evidence, {
      metricKey: CLOSED_MINUTES,
      minimumQualityTier: operationsClosedShareDetector.minimumQualityTier,
    });
    const scheduled = selectComparablePoints(evidence, {
      metricKey: SCHEDULED_MINUTES,
      minimumQualityTier: operationsClosedShareDetector.minimumQualityTier,
    });

    if (closed.accepted.length === 0 || scheduled.accepted.length === 0) {
      const absent = [
        ...(closed.accepted.length === 0 ? [CLOSED_MINUTES] : []),
        ...(scheduled.accepted.length === 0 ? [SCHEDULED_MINUTES] : []),
      ];
      return [refuse(evidence, absent)];
    }

    const expectedPeriodCount = enumerateLocalPeriodStarts(
      window.windowStart,
      window.windowEnd,
      window.grain,
    ).length;

    const setAsideCount = closed.setAsideCount + scheduled.setAsideCount;
    const closedMinutes = sumNumerators(closed.accepted);
    const scheduledMinutes = sumNumerators(scheduled.accepted);

    const shareLimitations = [
      "Both sides are the summed series themselves; the quotient is derived where it is shown, never stored.",
    ];
    if (setAsideCount > 0) {
      shareLimitations.push(
        "Some rows for these metrics were set aside as incomparable and took no part in either sum.",
      );
    }
    if (scheduledMinutes === 0) {
      shareLimitations.push(
        "The window recorded zero scheduled minutes, so no proportional share is defined and none is reported.",
      );
    }

    const outcomes: DetectorOutcome[] = [
      {
        kind: "observation",
        code: "OPERATIONS_CLOSED_SHARE",
        channelId: window.channelId ?? undefined,
        branchId: window.branchId ?? undefined,
        metricKey: CLOSED_MINUTES,
        periodStart: window.windowStart,
        periodEnd: window.windowEnd,
        measurement: {
          valueKind: "ratio",
          numerator: closedMinutes,
          denominator: scheduledMinutes,
        },
        expectedPeriodCount,
        observedPeriodCount: distinctPeriodStarts(closed.accepted).length,
        absentPeriodCount: expectedPeriodCount - distinctPeriodStarts(closed.accepted).length,
        qualityState: setAsideCount > 0 ? "partial" : "complete",
        limitations: shareLimitations,
        evidence: [
          ...closed.accepted.map((row) => ({
            kind: "normalized_metric" as const,
            role: "component" as const,
            id: row.normalizedMetricId,
          })),
          ...scheduled.accepted.map((row) => ({
            kind: "normalized_metric" as const,
            role: "denominator" as const,
            id: row.normalizedMetricId,
          })),
        ],
      },
    ];

    // One observation per reason value present, ordered by the label so the
    // same window always reads the same way. Grouping by a dimension value is
    // a read-time concern (ADR 0034); nothing here switches on which label it
    // is, and a label outside the approved vocabulary cannot occur -- the
    // import refused it.
    const days = selectComparablePoints(evidence, {
      metricKey: CLOSED_DAYS,
      minimumQualityTier: operationsClosedShareDetector.minimumQualityTier,
    });
    const byReason = new Map<string, AnalysisSeriesPoint[]>();
    for (const row of days.accepted) {
      const reason = row.dimensions[REASON_DIMENSION];
      // A closed-days row without the declared dimension carries no grouping
      // this detector may read, so its days stay out of every reason group.
      if (!reason) continue;
      const group = byReason.get(reason) ?? [];
      group.push(row);
      byReason.set(reason, group);
    }

    const daySetAsideCount = days.setAsideCount;
    for (const reason of [...byReason.keys()].sort()) {
      const rows = byReason.get(reason) ?? [];
      const citations: FindingEvidenceReference[] = rows.map((row) => ({
        kind: "normalized_metric" as const,
        role: "component" as const,
        id: row.normalizedMetricId,
      }));
      const limitations: string[] = [
        `Days the provider marked ${reason}. The labels are the provider's own vocabulary, counted as it wrote them.`,
      ];
      if (daySetAsideCount > 0) {
        limitations.push(
          "Some rows for this metric were set aside as incomparable and are not counted here.",
        );
      }
      outcomes.push({
        kind: "observation",
        code: "OPERATIONS_CLOSED_DAYS",
        channelId: window.channelId ?? undefined,
        branchId: window.branchId ?? undefined,
        metricKey: CLOSED_DAYS,
        periodStart: window.windowStart,
        periodEnd: window.windowEnd,
        measurement: { valueKind: "count", numerator: sumNumerators(rows) },
        expectedPeriodCount,
        observedPeriodCount: rows.length,
        qualityState: daySetAsideCount > 0 ? "partial" : "complete",
        limitations,
        evidence: citations,
      });
    }

    return outcomes;
  },
};

function distinctPeriodStarts(rows: readonly AnalysisSeriesPoint[]): string[] {
  return [...new Set(rows.map((row) => row.periodStart))];
}
