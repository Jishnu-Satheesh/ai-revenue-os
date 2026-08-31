import { enumerateLocalPeriodStarts, localPeriodEndInWindow } from "@/domain/analysis/calendar";
import { selectComparablePoints } from "@/domain/analysis/evidence";
import type {
  AnalysisEvidence,
  AnalysisHeldEvidence,
  DetectorDeclaration,
  DetectorOutcome,
} from "@/domain/analysis/types";

/**
 * Evidence waiting on an owner or admin decision.
 *
 * When two governed imports cover the same days, the platform stores both and
 * runs neither into a rollup: it holds the newer one and records the collision
 * as a decision somebody has to make. That is the right behaviour and it has
 * one failure mode -- nobody is told. A held month sits invisibly beside a
 * daily series, every read quietly excludes it, and the operator wonders why
 * the numbers stopped moving.
 *
 * This detector names the reconciliation record, so the decision is findable.
 * It never reports the held figure itself: held evidence is not fact, and
 * quoting its value would be treating an undecided question as an answer.
 */

const METRIC_KEY = "revenue.gross";

function coversPeriod(held: AnalysisHeldEvidence, periodStart: string, periodEnd: string): boolean {
  return held.periodStart <= periodEnd && held.periodEnd >= periodStart;
}

export const reconciliationBlockedDetector: DetectorDeclaration = {
  key: "evidence.reconciliation_blocked",
  calculationVersion: 1,
  owner: "core",
  scope: "channel",
  // Evidence held for review is worth saying whatever the grain, and a held
  // span is exactly as unreportable as a held day.
  compatibleGrains: ["day", "week", "month", "span"],
  // A held exact-range total is exactly what this detector exists to surface,
  // and it is cited through the reconciliation record rather than as a figure.
  exactRangeEvidence: "cited",
  requiredMetricKeys: [],
  optionalMetricKeys: [METRIC_KEY],
  minimumQualityTier: "assumed",
  acceptedReconciliationStates: ["current"],
  evidenceContract: [
    "A declared window supplied by the caller.",
    "Unresolved reconciliation records whose held evidence overlaps that window.",
    "Current period-grain observations of revenue.gross, used only to tell whether the held record blocks a period nothing else covers.",
  ],
  severityRules: [
    "high when at least one held record covers a period in the window that carries no current evidence: the window stays incomplete until somebody decides.",
    "medium otherwise: the window is already covered and the held record is a competing figure for days that already have one.",
    "Both are case distinctions on the evidence. Neither is a tuned threshold.",
  ],
  monetaryImpact: {
    computable: false,
    reason:
      "The only figure available is the held one, and treating an undecided figure as an impact would be treating it as accepted evidence.",
  },
  limitations: [
    "Reports that a decision is outstanding, not which of the two figures is right.",
    "A held record is matched to the window by the dates it covers, so a record spanning the window edge is reported even though part of it lies outside.",
  ],
  needsDataConditions: [
    "None. The absence of held evidence is itself an answer, and it is reported as one.",
  ],

  run(evidence: AnalysisEvidence): readonly DetectorOutcome[] {
    const { window } = evidence;
    const held = evidence.heldEvidence.filter(
      (record) =>
        (window.channelId === null || record.channelId === window.channelId) &&
        (window.branchId === null || record.branchId === window.branchId) &&
        coversPeriod(record, window.windowStart, window.windowEnd),
    );

    if (held.length === 0) {
      return [
        {
          kind: "observation",
          code: "NO_EVIDENCE_HELD",
          channelId: window.channelId ?? undefined,
          branchId: window.branchId ?? undefined,
          periodStart: window.windowStart,
          periodEnd: window.windowEnd,
          measurement: { valueKind: "count", numerator: 0 },
          qualityState: "complete",
          limitations: [],
          evidence: [],
        },
      ];
    }

    // Which periods in the window nothing currently covers. A held record
    // sitting on top of one of those is the difference between "we are waiting
    // to know which figure is right" and "we are waiting to have a figure".
    const expected = enumerateLocalPeriodStarts(window.windowStart, window.windowEnd, window.grain);
    const { accepted } = selectComparablePoints(evidence, {
      metricKey: METRIC_KEY,
      minimumQualityTier: reconciliationBlockedDetector.minimumQualityTier,
    });
    const covered = new Set(accepted.map((point) => point.periodStart));
    const uncovered = expected.filter((start) => !covered.has(start));
    const blocksUncoveredPeriod = held.some((record) =>
      uncovered.some((start) => coversPeriod(record, start, localPeriodEndInWindow(start, window.grain, window.windowEnd))),
    );

    const starts = held.map((record) => record.periodStart).sort();
    const ends = held.map((record) => record.periodEnd).sort();
    const earliest = starts[0] < window.windowStart ? window.windowStart : starts[0];
    const latest =
      ends[ends.length - 1] > window.windowEnd ? window.windowEnd : ends[ends.length - 1];

    return [
      {
        kind: "finding",
        code: "EVIDENCE_HELD_FOR_DECISION",
        severity: blocksUncoveredPeriod ? "high" : "medium",
        priority: blocksUncoveredPeriod ? 10 : 30,
        channelId: window.channelId ?? undefined,
        branchId: window.branchId ?? undefined,
        periodStart: earliest,
        periodEnd: latest,
        measurement: { valueKind: "count", numerator: held.length },
        qualityState: "complete",
        limitations: [
          blocksUncoveredPeriod
            ? "At least one held record covers a period this window has no other evidence for, so the window stays incomplete until the decision is made."
            : "Every period a held record covers already carries current evidence, so the decision is about which figure is right rather than about a gap.",
          "The held figures themselves are not reported. Until a decision is recorded they are not accepted evidence.",
        ],
        evidence: held.map((record) => ({
          kind: "report_projection_reconciliation" as const,
          role: "held_evidence" as const,
          id: record.reconciliationId,
        })),
      },
    ];
  },
};
