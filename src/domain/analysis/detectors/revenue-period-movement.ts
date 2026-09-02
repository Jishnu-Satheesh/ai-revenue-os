import { previousLocalPeriodStart } from "@/domain/analysis/calendar";
import { distinct, selectComparablePoints, singleCurrency } from "@/domain/analysis/evidence";
import type {
  AnalysisEvidence,
  DetectorDeclaration,
  DetectorOutcome,
  DetectorNeedsData,
} from "@/domain/analysis/types";

/**
 * Period-over-period movement in gross revenue, for one channel.
 *
 * The trend the daily series just unlocked, and the only detector in this slice
 * that computes a monetary impact. The impact is the movement itself, in
 * integer minor units -- not a forecast, not a recovery estimate, not a share
 * of anything. Nothing here models what the number would have been.
 *
 * Two periods are compared only when they are adjacent at the declared grain.
 * Nothing is resampled: a week is not four-sevenths of a month, and comparing
 * the two would produce a movement that describes the calendar rather than the
 * trade. If the period immediately before the latest one has no evidence, that
 * is `needs_data` -- reaching back to the last period that does have evidence
 * would silently treat the gap as a zero.
 */

const METRIC_KEY = "revenue.gross";

function refuse(
  evidence: AnalysisEvidence,
  reason: string,
  limitations: readonly string[] = [],
  qualityState: "complete" | "partial" = "complete",
): DetectorNeedsData {
  return {
    kind: "needs_data",
    code: "REVENUE_PERIOD_MOVEMENT_UNAVAILABLE",
    needsDataReason: reason,
    channelId: evidence.window.channelId ?? undefined,
    branchId: evidence.window.branchId ?? undefined,
    metricKey: METRIC_KEY,
    periodStart: evidence.window.windowStart,
    periodEnd: evidence.window.windowEnd,
    qualityState,
    limitations,
    evidence: [],
  };
}

export const revenuePeriodMovementDetector: DetectorDeclaration = {
  key: "revenue.period_movement",
  // 2: a refusal now names the rows it set aside and reports itself as partial,
  // instead of looking like a window with nothing in it.
  calculationVersion: 2,
  owner: "core",
  scope: "channel",
  compatibleGrains: ["day", "week", "month"],
  // An arbitrary-period total is never prorated into a series, per ADR 0029, so
  // it can take no part in a period-over-period comparison.
  exactRangeEvidence: "refused",
  requiredMetricKeys: [METRIC_KEY],
  optionalMetricKeys: [],
  // A movement derived from estimated figures is not a movement in trade.
  minimumQualityTier: "derived",
  acceptedReconciliationStates: ["current"],
  evidenceContract: [
    "Two current period-grain observations of revenue.gross at the declared grain, adjacent in the calendar.",
    "Both from the same channel, branch, currency, and recorded timezone.",
  ],
  severityRules: [
    "None. The direction and size of a movement are reported as an observation; no agreed threshold exists at which a fall becomes a problem of a given severity, and inventing one would put a number nobody chose in front of an operator.",
  ],
  monetaryImpact: {
    computable: true,
    method:
      "The movement itself: the latest period's gross revenue minus the immediately preceding period's, in integer minor units of the shared currency. Signed, and never extrapolated.",
  },
  limitations: [
    "Compares the two most recent adjacent periods only. It is not a trend over the whole window.",
    "A period that ended early or has not finished trading is compared as reported.",
  ],
  needsDataConditions: [
    "Fewer than two comparable periods in the window.",
    "The period immediately before the latest one carries no evidence.",
    "The window's evidence mixes grains, currencies, branches, channels, or recorded timezones.",
  ],

  run(evidence: AnalysisEvidence): readonly DetectorOutcome[] {
    const { window } = evidence;
    const { accepted, setAsideCount, setAside, setAsideGrains } = selectComparablePoints(evidence, {
      metricKey: METRIC_KEY,
      minimumQualityTier: revenuePeriodMovementDetector.minimumQualityTier,
    });

    if (accepted.length < 2) {
      // A refusal that does not mention the rows it set aside reads as "there is
      // nothing here". Coverage already says so; saying less here would leave
      // the two detectors describing the same evidence differently.
      const limitations: string[] = [];
      if (setAside.grain > 0) {
        limitations.push(
          `${setAside.grain} ${setAside.grain === 1 ? "figure" : "figures"} for this metric are recorded at ${setAsideGrains.join(" and ")} grain rather than ${window.grain}, and were not resampled into a comparison.`,
        );
      }
      if (setAsideCount > setAside.grain) {
        limitations.push(
          "Other rows for this metric were set aside as incomparable and took no part in the comparison.",
        );
      }
      return [
        refuse(
          evidence,
          "INSUFFICIENT_COMPARABLE_PERIODS",
          limitations,
          setAsideCount > 0 ? "partial" : "complete",
        ),
      ];
    }

    // Every one of these is a way two figures can look comparable and not be.
    if (
      distinct(accepted, (point) => point.channelId).length > 1 ||
      distinct(accepted, (point) => point.branchId).length > 1 ||
      distinct(accepted, (point) => point.periodTimezone).length > 1 ||
      distinct(accepted, (point) => point.grain).length > 1
    ) {
      return [refuse(evidence, "INCOMPARABLE_PERIODS")];
    }

    const currency = singleCurrency(accepted);
    if (currency === "mixed") return [refuse(evidence, "MIXED_CURRENCY")];
    if (currency === null) return [refuse(evidence, "CURRENCY_UNAVAILABLE")];

    // A span is one figure for the whole window, so it has no period before it
    // to move from. The registry does not bind this detector at that grain, and
    // saying so plainly is better than asserting the case away.
    if (window.grain === "span") {
      return [
        refuse(evidence, "PRIOR_PERIOD_ABSENT", [
          "This channel reports one figure for the whole window rather than a figure per period, so there is no earlier period to compare it against.",
        ]),
      ];
    }

    const ordered = [...accepted].sort((left, right) =>
      left.periodStart.localeCompare(right.periodStart),
    );
    const latest = ordered[ordered.length - 1];
    const priorStart = previousLocalPeriodStart(latest.periodStart, window.grain);
    const prior = ordered.find((point) => point.periodStart === priorStart);

    // The gap is the answer here. Comparing the latest period against the last
    // one that happens to have evidence would report a movement across days
    // nobody measured and call it period-over-period.
    if (!prior) {
      return [
        refuse(evidence, "PRIOR_PERIOD_ABSENT", [
          `The period beginning ${priorStart} carries no current evidence, so no period-over-period comparison is defined for ${latest.periodStart}.`,
        ]),
      ];
    }

    const movement = latest.numerator - prior.numerator;
    const limitations = [
      "The movement is the difference between two periods, not a projection of what the next one will be.",
    ];
    if (prior.numerator === 0) {
      limitations.push(
        "The preceding period recorded zero, so no proportional change is defined and none is reported.",
      );
    }
    if (setAsideCount > 0) {
      limitations.push(
        "Some rows for this metric were set aside as incomparable and took no part in the comparison.",
      );
    }

    return [
      {
        kind: "observation",
        code:
          movement > 0
            ? "REVENUE_PERIOD_MOVEMENT_UP"
            : movement < 0
              ? "REVENUE_PERIOD_MOVEMENT_DOWN"
              : "REVENUE_PERIOD_MOVEMENT_FLAT",
        channelId: latest.channelId,
        branchId: latest.branchId ?? undefined,
        metricKey: METRIC_KEY,
        periodStart: prior.periodStart,
        periodEnd: latest.periodEnd,
        measurement: {
          valueKind: "money",
          numerator: movement,
          // The base the movement is measured against, so a reader can size it
          // without the detector choosing a rounding for them.
          denominator: prior.numerator === 0 ? undefined : prior.numerator,
          currency,
          monetaryImpactMinorUnits: movement,
        },
        expectedPeriodCount: 2,
        observedPeriodCount: 2,
        absentPeriodCount: 0,
        qualityState: setAsideCount > 0 ? "partial" : "complete",
        limitations,
        evidence: [
          { kind: "normalized_metric", role: "subject_period", id: latest.normalizedMetricId },
          { kind: "normalized_metric", role: "prior_period", id: prior.normalizedMetricId },
        ],
      },
    ];
  },
};
