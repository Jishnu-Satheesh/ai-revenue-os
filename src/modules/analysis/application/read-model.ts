import {
  buildVerdictView,
  costLineHeadline,
  findingHeadline,
  KIND_LABEL,
  needsDataSentence,
  SEVERITY_TONE,
  WORKSPACE_CHAPTERS,
  type VerdictCoverage,
  type VerdictView,
  type WorkspaceChapterId,
} from "@/domain/analysis/copy";
import { splitEarnedLostPotential } from "@/domain/analysis/money-split";
import type { AnalysisGrain, DetectorSeverity, FindingKind } from "@/domain/analysis/types";
import type {
  ChannelAnalysisRunRecord,
  ChannelFindingEvidenceRecord,
  ChannelFindingRecord,
  ChannelRecommendationDecisionRecord,
  ChannelRecommendationRecord,
} from "@/modules/analysis/application/ports";

/**
 * Shaping stored findings into the approved channel-workspace design.
 *
 * Pure, and deliberately incapable of producing a number of its own. Every
 * figure it carries came out of a detector already, arrived through a fenced
 * write path, and travels with the identifiers of the rows it was computed
 * from. Nothing here adds, divides, converts, or fills a gap.
 *
 * The one thing this file does decide is what an operator is told when there is
 * nothing to show, and it distinguishes three cases that look identical in an
 * empty frame: a detector that ran and needed data, a chapter whose detectors
 * are not written yet, and a channel nobody has analysed at all.
 */

export type WorkspaceValueView =
  /**
   * `base` is what the figure is measured against where the detector recorded
   * one -- the prior period for a movement. Null means no base was recorded,
   * which is not the same as a base of zero and must never be shown as one.
   */
  | { kind: "money"; minorUnits: number; currency: string; base: number | null }
  | { kind: "count"; value: number }
  | { kind: "ratio"; numerator: number; denominator: number; currency: string | null };

export type WorkspaceEvidenceView = {
  kind: ChannelFindingEvidenceRecord["evidenceKind"];
  role: ChannelFindingEvidenceRecord["evidenceRole"];
  referenceId: string;
  metric?: NonNullable<ChannelFindingEvidenceRecord["metric"]>;
};

export type WorkspaceFindingView = {
  id: string;
  detectorKey: string;
  /** The metric the detector bound, when it bound one -- names a funnel stage. */
  metricKey: string | null;
  detectorVersion: number;
  kind: FindingKind;
  kindLabel: string;
  code: string;
  headline: string;
  /** The `needs_data` sentence, or null when the detector answered. */
  detail: string | null;
  severity: DetectorSeverity | null;
  severityTone: "danger" | "warning" | "neutral" | null;
  priority: number | null;
  value: WorkspaceValueView | null;
  monetaryImpact: { minorUnits: number; currency: string } | null;
  periodStart: string | null;
  periodEnd: string | null;
  coverage: { expected: number; observed: number; absent: number } | null;
  qualityState: "complete" | "partial";
  limitations: readonly string[];
  calculationDigest: string;
  evidence: readonly WorkspaceEvidenceView[];
};

export type WorkspaceChapterState =
  | "reported"
  | "needs_data"
  | "deferred"
  /**
   * A run completed, and this chapter's detectors were not part of it.
   *
   * Distinct from `not_run`, which means no analysis has completed at all.
   * A channel reporting one figure for its whole window binds only the
   * detectors that can answer without periods, so the rest produce nothing --
   * and telling an operator "no analysis has completed" when one just did is a
   * false statement about their own data.
   */
  | "not_applicable"
  | "not_run";

export type WorkspaceChapterView = {
  id: WorkspaceChapterId;
  navLabel: string;
  heading: string;
  state: WorkspaceChapterState;
  /** Set only when `state` is `deferred`. */
  deferredReason: string | null;
  findings: readonly WorkspaceFindingView[];
};

export type SummaryTileView = {
  label: string;
  /** Null renders the design's em-dash. It is never a zero. */
  value: WorkspaceValueView | null;
  /** Why there is no figure. Always present when `value` is null. */
  unavailableReason: string | null;
  /** Which finding the evidence rail should open. */
  findingId: string | null;
  coverage: { expected: number; observed: number; absent: number } | null;
};

export type WorkspaceRunView = {
  id: string;
  windowStart: string;
  windowEnd: string;
  windowTimezone: string;
  periodGrain: AnalysisGrain;
  status: ChannelAnalysisRunRecord["status"];
  safeFailureCode: string | null;
  completedAt: string | null;
  registryVersion: number;
  detectorVersions: readonly { key: string; calculationVersion: number }[];
};

/**
 * The narrator's words for the displayed run, with their receipts.
 *
 * Nothing here is judged or ranked: what the model wrote is passed through
 * under its own admitted label, the findings it cited travel as ids so the
 * page can attach each item beside the evidence it rests on, and the human
 * aftermath -- the standing triage answer and this viewer's vote -- arrives
 * exactly as stored. A recommendation citing nothing displayed still appears,
 * because dropping it would hide words the run actually produced.
 */
export type WorkspaceRecommendationView = {
  id: string;
  label: "observation" | "recommendation" | "needs_data";
  headline: string;
  detail: string;
  supportedActions: readonly string[];
  limitations: readonly string[];
  citationFindingIds: readonly string[];
  decision: {
    decision: "acknowledged" | "dismissed" | "planned";
    reason: string | null;
    actorName: string;
    createdAt: string;
  } | null;
  myFeedback: boolean | null;
};

export type ChannelWorkspaceView = {
  /** The completed run these findings came from, or null if none has completed. */
  run: WorkspaceRunView | null;
  /** Every run, newest first, so a running or failed one is visible too. */
  runs: readonly WorkspaceRunView[];
  /** The band the page leads with, chosen from stored findings by `copy.ts`. */
  verdict: VerdictView;
  summaryTiles: readonly SummaryTileView[];
  chapters: readonly WorkspaceChapterView[];
  /** Findings whose detector belongs to no chapter, so nothing is ever dropped. */
  unplacedFindings: readonly WorkspaceFindingView[];
  /** The displayed run's narration and its triage state, newest first. */
  recommendations: readonly WorkspaceRecommendationView[];
};

/**
 * Findings whose home is the verdict band and never a chapter card. The
 * channel-scoped gross-revenue observation is the figure the band draws as
 * "potential", and the period movement is the prior-vs-current comparison the
 * approved draft deliberately drops. Both are placed so neither surfaces as an
 * unplaced "Also measured" row. The cross-channel share remains placed for
 * organization-scope readers, but is never substituted for this channel view.
 */
export const BAND_DETECTOR_KEYS = new Set([
  "revenue.channel_share",
  "revenue.period_movement",
  "revenue.window_gross",
]);

const MONEY_DEFERRED_REASON =
  "Contribution margin needs every variable cost for this channel. No approved report writes those inputs yet, so the figure would be a guess.";

function toRunView(run: ChannelAnalysisRunRecord): WorkspaceRunView {
  return {
    id: run.id,
    windowStart: run.windowStart,
    windowEnd: run.windowEnd,
    windowTimezone: run.windowTimezone,
    periodGrain: run.periodGrain,
    status: run.status,
    safeFailureCode: run.safeFailureCode,
    completedAt: run.completedAt,
    registryVersion: run.registryVersion,
    detectorVersions: run.detectorVersions,
  };
}

function toValue(finding: ChannelFindingRecord): WorkspaceValueView | null {
  if (finding.valueKind === null || finding.valueNumerator === null) return null;
  if (finding.valueKind === "money") {
    // A money finding always carries its currency; the database refuses one
    // that does not. The guard is here so a malformed row renders as absent
    // rather than as a figure in an unnamed currency.
    return finding.currency
      ? {
          kind: "money",
          minorUnits: finding.valueNumerator,
          currency: finding.currency,
          base: finding.valueDenominator,
        }
      : null;
  }
  if (finding.valueKind === "count") return { kind: "count", value: finding.valueNumerator };
  return finding.valueDenominator
    ? {
        kind: "ratio",
        numerator: finding.valueNumerator,
        denominator: finding.valueDenominator,
        currency: finding.currency,
      }
    : null;
}

function toFindingView(
  finding: ChannelFindingRecord,
  evidence: readonly ChannelFindingEvidenceRecord[],
): WorkspaceFindingView {
  return {
    id: finding.id,
    detectorKey: finding.detectorKey,
    metricKey: finding.metricKey,
    detectorVersion: finding.detectorVersion,
    kind: finding.kind,
    kindLabel: KIND_LABEL[finding.kind],
    code: finding.code,
    headline:
      finding.code === "COMPANY_COST_LINE_SHARE_OF_REVENUE" && finding.metricKey
        ? costLineHeadline(finding.metricKey)
        : findingHeadline(finding.code),
    detail: finding.needsDataReason ? needsDataSentence(finding.needsDataReason) : null,
    severity: finding.severity,
    severityTone: finding.severity ? SEVERITY_TONE[finding.severity] : null,
    priority: finding.priority,
    value: toValue(finding),
    monetaryImpact:
      finding.monetaryImpactMinorUnits !== null && finding.currency
        ? { minorUnits: finding.monetaryImpactMinorUnits, currency: finding.currency }
        : null,
    periodStart: finding.periodStart,
    periodEnd: finding.periodEnd,
    coverage:
      finding.expectedPeriodCount !== null && finding.observedPeriodCount !== null
        ? {
            expected: finding.expectedPeriodCount,
            observed: finding.observedPeriodCount,
            absent:
              finding.absentPeriodCount ??
              finding.expectedPeriodCount - finding.observedPeriodCount,
          }
        : null,
    qualityState: finding.qualityState,
    limitations: finding.limitations,
    calculationDigest: finding.calculationDigest,
    evidence: evidence
      .filter((row) => row.findingId === finding.id)
      .map((row) => ({
        kind: row.evidenceKind,
        role: row.evidenceRole,
        referenceId: row.referenceId,
        ...(row.metric ? { metric: row.metric } : {}),
      })),
  };
}

/**
 * The standing triage answer is simply the newest one: decisions are
 * append-only, so a later answer by anyone -- including a different teammate
 * -- supersedes what stood before. Ties keep the first stored answer, which
 * the repository hands over newest-first.
 */
function standingDecision(
  decisions: readonly ChannelRecommendationDecisionRecord[],
): ChannelRecommendationDecisionRecord | null {
  return (
    [...decisions].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null
  );
}

function toRecommendationView(
  recommendation: ChannelRecommendationRecord,
): WorkspaceRecommendationView {
  const decision = standingDecision(recommendation.decisions);
  return {
    id: recommendation.id,
    label: recommendation.label,
    headline: recommendation.headline,
    detail: recommendation.detail,
    supportedActions: recommendation.supportedActions,
    limitations: recommendation.limitations,
    citationFindingIds: recommendation.citationFindingIds,
    decision: decision
      ? {
          decision: decision.decision,
          reason: decision.reason,
          actorName: decision.actorName,
          createdAt: decision.createdAt,
        }
      : null,
    myFeedback: recommendation.myFeedback,
  };
}

/**
 * The workspace ordering, stated once per ADR 0035:
 *
 * - Findings with a declared computable monetary impact rank first, by amount
 *   descending. The impact is a property the detector declared and the write
 *   path fenced; this file only reads it.
 * - Findings without one rank by kind: `finding`, then `observation`, then
 *   `needs_data`.
 * - Then by severity, descending weight.
 * - Then by priority ascending, nulls last.
 * - Detector key ascending breaks any remaining tie.
 *
 * Every input is a stored field, so two readers over one run always see one
 * page, and a changed order means something changed in the evidence.
 */
const KIND_RANK: Readonly<Record<FindingKind, number>> = {
  finding: 0,
  observation: 1,
  needs_data: 2,
};

/** Descending weight: danger above warning above neutral above none (ADR 0035). */
const SEVERITY_RANK: Readonly<Record<DetectorSeverity | "none", number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

function byUrgency(left: WorkspaceFindingView, right: WorkspaceFindingView): number {
  const leftImpact = left.monetaryImpact?.minorUnits ?? null;
  const rightImpact = right.monetaryImpact?.minorUnits ?? null;
  // A declared amount outranks everything, including a higher-severity finding
  // that declared no method: the page opens with what each problem cost, and
  // only detectors that named a method have earned the top of it.
  if (leftImpact !== null && rightImpact !== null && leftImpact !== rightImpact) {
    return rightImpact - leftImpact;
  }
  if ((leftImpact !== null) !== (rightImpact !== null)) return leftImpact !== null ? -1 : 1;
  if (KIND_RANK[left.kind] !== KIND_RANK[right.kind])
    return KIND_RANK[left.kind] - KIND_RANK[right.kind];
  if (left.severity !== right.severity) {
    return SEVERITY_RANK[left.severity ?? "none"] - SEVERITY_RANK[right.severity ?? "none"];
  }
  if (left.priority !== right.priority) return (left.priority ?? 101) - (right.priority ?? 101);
  return left.detectorKey.localeCompare(right.detectorKey);
}

function summaryTiles(
  findings: readonly WorkspaceFindingView[],
  hasCompletedRun: boolean,
): SummaryTileView[] {
  // The one gross figure this channel view can state honestly: its own stored
  // revenue-window observation, which cites the governed rows it summed.
  const windowGross = findings.find((finding) => finding.code === "WINDOW_GROSS_REVENUE");
  const grossValue: WorkspaceValueView | null =
    windowGross?.value?.kind === "money"
      ? {
          kind: "money",
          minorUnits: windowGross.value.minorUnits,
          currency: windowGross.value.currency,
          base: null,
        }
      : null;

  return [
    {
      label: "Gross revenue",
      value: grossValue,
      unavailableReason: grossValue
        ? null
        : hasCompletedRun
          ? "This channel analysis has not produced a governed gross-revenue figure for the window it covered."
          : "No analysis has run for this channel yet.",
      findingId: grossValue ? (windowGross?.id ?? null) : null,
      coverage: grossValue ? (windowGross?.coverage ?? null) : null,
    },
    {
      label: "Contribution margin",
      value: null,
      unavailableReason: MONEY_DEFERRED_REASON,
      findingId: null,
      coverage: null,
    },
    {
      label: "Margin rate",
      value: null,
      unavailableReason: MONEY_DEFERRED_REASON,
      findingId: null,
      coverage: null,
    },
  ];
}

/**
 * The verdict band's inputs, read off stored summary findings and nothing else.
 *
 * Each input is present only when a detector actually reported it, so the band
 * can never speak about a figure this run did not store. No number is derived
 * here either: the gross figure is the channel's own stored observation, the movement's
 * direction is the code the detector chose, and coverage is the stored pair of
 * counts.
 *
 * The one deliberate, user-directed exception is the earned/lost/potential
 * split. `potential` is the channel's gross revenue (the window detector's stored
 * numerator), `lost` is the provider's own rejection loss (the cancellation
 * detector's declared monetary impact), and `earned` is potential minus lost.
 * It is a stated relationship between two already-cited figures rather than a
 * new measurement, so it is surfaced in the verdict band with the arithmetic
 * visible and labelled as a derived split.
 */
function verdictInputs(
  findings: readonly WorkspaceFindingView[],
): Parameters<typeof buildVerdictView>[0] {
  const windowGross = findings.find((finding) => finding.code === "WINDOW_GROSS_REVENUE");
  const grossMoney =
    windowGross?.value?.kind === "money"
      ? { minorUnits: windowGross.value.minorUnits, currency: windowGross.value.currency }
      : null;

  const movement = findings.find(
    (finding) =>
      finding.code === "REVENUE_PERIOD_MOVEMENT_UP" ||
      finding.code === "REVENUE_PERIOD_MOVEMENT_DOWN" ||
      finding.code === "REVENUE_PERIOD_MOVEMENT_FLAT",
  );
  const direction =
    movement?.code === "REVENUE_PERIOD_MOVEMENT_UP"
      ? ("up" as const)
      : movement?.code === "REVENUE_PERIOD_MOVEMENT_DOWN"
        ? ("down" as const)
        : movement?.code === "REVENUE_PERIOD_MOVEMENT_FLAT"
          ? ("flat" as const)
          : null;

  const coverageFinding = findings.find(
    (finding) =>
      finding.code === "PERIOD_COVERAGE_COMPLETE" || finding.code === "PERIOD_COVERAGE_INCOMPLETE",
  );
  let coverage: VerdictCoverage | null = null;
  if (
    coverageFinding?.coverage &&
    coverageFinding.value?.kind === "ratio" &&
    // A ratio whose denominator was never recorded states no fraction at all;
    // reading its numerator alone would invent the base it was measured over.
    coverageFinding.value.denominator > 0
  ) {
    coverage = {
      expectedPeriods: coverageFinding.coverage.expected,
      observedPeriods: coverageFinding.coverage.observed,
    };
  }

  const cancellation = findings.find((finding) => finding.code === "ORDER_CANCELLATION_LOSS");
  const lost = cancellation?.monetaryImpact
    ? {
        minorUnits: cancellation.monetaryImpact.minorUnits,
        currency: cancellation.monetaryImpact.currency,
      }
    : null;
  const earnedLostPotential = splitEarnedLostPotential({ potential: grossMoney, lost });

  return {
    grossMoney,
    movement: direction,
    coverage,
    earnedLostPotential,
  };
}

export function buildChannelWorkspaceView(input: {
  runs: readonly ChannelAnalysisRunRecord[];
  findings: readonly ChannelFindingRecord[];
  evidence: readonly ChannelFindingEvidenceRecord[];
  recommendations: readonly ChannelRecommendationRecord[];
}): ChannelWorkspaceView {
  const runViews = input.runs.map(toRunView);
  const completed = runViews.find((run) => run.status === "completed") ?? null;
  const findingViews = input.findings.map((finding) => toFindingView(finding, input.evidence));

  const placed = new Set<string>();
  const chapters = WORKSPACE_CHAPTERS.map((chapter): WorkspaceChapterView => {
    const deferred = chapter.detectorKeys.length === 0;
    const own = deferred
      ? []
      : findingViews
          .filter((finding) => chapter.detectorKeys.includes(finding.detectorKey))
          .sort(byUrgency);
    for (const finding of own) placed.add(finding.id);

    // Four states, because an empty frame cannot tell them apart and an
    // operator reads "empty" as "nothing wrong here".
    // A bound detector always answers -- with a finding, an observation, or a
    // named refusal -- so a chapter with nothing in it after a completed run is
    // a chapter whose detectors were never bound, not one that was skipped.
    const state: WorkspaceChapterState = deferred
      ? "deferred"
      : own.length === 0
        ? completed === null
          ? "not_run"
          : "not_applicable"
        : own.every((finding) => finding.kind === "needs_data")
          ? "needs_data"
          : "reported";

    return {
      id: chapter.id,
      navLabel: chapter.navLabel,
      heading: chapter.heading,
      state,
      deferredReason: deferred ? (chapter.deferredReason ?? null) : null,
      findings: own,
    };
  });

  // Findings the verdict band (or evidence section) renders are placed even
  // though they belong to no numbered chapter, so they are not duplicated as an
  // "Also measured" row.
  for (const finding of findingViews) {
    if (BAND_DETECTOR_KEYS.has(finding.detectorKey)) placed.add(finding.id);
  }

  return {
    run: completed,
    runs: runViews,
    verdict: buildVerdictView(verdictInputs(findingViews)),
    summaryTiles: summaryTiles(findingViews, completed !== null),
    chapters,
    // A detector registered after this file was written still reaches the page.
    // Dropping its findings silently would be the same failure as a blank frame.
    unplacedFindings: findingViews.filter((finding) => !placed.has(finding.id)).sort(byUrgency),
    recommendations: input.recommendations.map(toRecommendationView),
  };
}

/**
 * One stored narration lifted to organization scope with its evidence window
 * and its owning-module triage answer. The organization workspace groups by
 * label; it never copies the narration into another module's records.
 */
export type OrganizationRecommendationRecord = {
  id: string;
  channelId: string;
  branchId: string | null;
  label: "observation" | "recommendation" | "needs_data";
  headline: string;
  detail: string;
  /** Inclusive local business evidence dates from the completed run. */
  windowStart: string;
  windowEnd: string;
  /** When the narration was generated (UTC instant). */
  generatedAt: string;
  /** The latest owning-module triage answer, if any. */
  decision: {
    decision: "acknowledged" | "dismissed" | "planned";
    createdAt: string;
  } | null;
  pinned: boolean;
};

export type OrganizationRecommendationLaneRecord = OrganizationRecommendationRecord & {
  /** False once a human answer removes the row from its active lane. */
  actionable: boolean;
  /** True when an earlier window's unresolved row carries into this view. */
  carriedOver: boolean;
  /** Present only when carriedOver; e.g. "2 months old". */
  ageLabel: string | null;
};

export type OrganizationRecommendationLanes = {
  recommendations: OrganizationRecommendationLaneRecord[];
  insights: OrganizationRecommendationLaneRecord[];
  dataGaps: OrganizationRecommendationLaneRecord[];
};

const ORGANIZATION_MONTH = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

function organizationMonthIndex(month: string): number {
  const [year, part] = month.split("-");
  return Number(year) * 12 + Number(part);
}

/**
 * Split stored narrations into the workspace lanes for one canonical
 * activity month. Pure: grouping, carry-over ageing, and actionability only.
 * Counts, ordering, and cross-module composition stay with the caller.
 */
export function projectOrganizationRecommendationLane(
  records: readonly OrganizationRecommendationRecord[],
  activityMonth: string,
): OrganizationRecommendationLanes {
  if (!ORGANIZATION_MONTH.test(activityMonth)) {
    throw new Error(`Activity month must be canonical YYYY-MM, got ${activityMonth}.`);
  }
  const lanes: OrganizationRecommendationLanes = {
    recommendations: [],
    insights: [],
    dataGaps: [],
  };
  for (const record of records) {
    const monthsOld =
      organizationMonthIndex(activityMonth) -
      organizationMonthIndex(record.windowEnd.slice(0, 7));
    const carriedOver = monthsOld > 0;
    const laneRecord: OrganizationRecommendationLaneRecord = {
      ...record,
      actionable: record.decision === null || record.decision.decision === "acknowledged",
      carriedOver,
      ageLabel: carriedOver ? (monthsOld === 1 ? "1 month old" : `${monthsOld} months old`) : null,
    };
    if (record.label === "recommendation") lanes.recommendations.push(laneRecord);
    else if (record.label === "observation") lanes.insights.push(laneRecord);
    else lanes.dataGaps.push(laneRecord);
  }
  return lanes;
}
