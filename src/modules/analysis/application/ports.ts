import type { AnalysisGrain, DetectorSeverity, FindingKind } from "@/domain/analysis/types";

/**
 * The read boundary for channel analysis.
 *
 * Findings are written only by a fenced worker and read only through here, so
 * the two rules that make a finding trustworthy -- that a superseded answer
 * never appears, and that a value always arrives with the evidence it cites --
 * are enforced once rather than per caller.
 */

export type ChannelAnalysisRunRecord = {
  id: string;
  channelId: string | null;
  branchId: string | null;
  /** Inclusive local dates in `windowTimezone`. */
  windowStart: string;
  windowEnd: string;
  periodGrain: AnalysisGrain;
  windowTimezone: string;
  registryVersion: number;
  detectorVersions: readonly { key: string; calculationVersion: number }[];
  status: "running" | "completed" | "failed";
  findingCount: number;
  observationCount: number;
  needsDataCount: number;
  safeFailureCode: string | null;
  startedAt: string;
  completedAt: string | null;
};

export type ChannelFindingRecord = {
  id: string;
  analysisRunId: string;
  channelId: string | null;
  branchId: string | null;
  detectorKey: string;
  detectorVersion: number;
  kind: FindingKind;
  code: string;
  severity: DetectorSeverity | null;
  priority: number | null;
  metricKey: string | null;
  /** Inclusive local dates. */
  periodStart: string | null;
  periodEnd: string | null;
  valueKind: "money" | "count" | "ratio" | null;
  /**
   * Integer minor units for money, a whole count otherwise -- except the two
   * parts of a ratio, which may carry exactly the decimals the provider
   * measured, such as closed minutes (ADR 0036). Never rounded in storage or
   * in read.
   */
  valueNumerator: number | null;
  valueDenominator: number | null;
  currency: string | null;
  monetaryImpactMinorUnits: number | null;
  expectedPeriodCount: number | null;
  observedPeriodCount: number | null;
  absentPeriodCount: number | null;
  qualityState: "complete" | "partial";
  needsDataReason: string | null;
  limitations: readonly string[];
  calculationDigest: string;
  createdAt: string;
};

export type ChannelFindingEvidenceRecord = {
  findingId: string;
  evidenceKind:
    | "normalized_metric"
    | "exact_range_metric_observation"
    | "report_projection_reconciliation"
    | "projection_run";
  evidenceRole:
    | "subject_period"
    | "prior_period"
    | "component"
    | "denominator"
    | "held_evidence"
    | "gap_count";
  referenceId: string;
};

/**
 * One stored triage answer to one recommendation.
 *
 * Every answer ever recorded travels, not just the current one: which human
 * answer is the standing one is a view decision, made by `createdAt`, so the
 * read boundary never silently discards history a later reader may need.
 */
export type ChannelRecommendationDecisionRecord = {
  recommendationId: string;
  decision: "acknowledged" | "dismissed" | "planned";
  /** Required by storage when dismissing; null for every other answer. */
  reason: string | null;
  actorId: string;
  /**
   * Snapshotted beside the answer by the database itself, resolved inside the
   * triage function's definer context at answer time. It does not follow later
   * profile renames, and reads "Unknown" when no profile row existed.
   */
  actorName: string;
  createdAt: string;
};

/**
 * The model-written narration over exactly one analysis run's findings, with
 * everything the workspace page needs to show it and its human aftermath:
 * what it cited, every triage answer, and the viewer's own feedback vote.
 *
 * Like findings, these rows are written only by a fenced worker and are read
 * only through here, so RLS -- not application code -- decides visibility.
 */
export type ChannelRecommendationRecord = {
  id: string;
  analysisRunId: string;
  channelId: string;
  branchId: string | null;
  label: "observation" | "recommendation" | "needs_data";
  headline: string;
  detail: string;
  supportedActions: readonly string[];
  limitations: readonly string[];
  /** Binds this item to the exact submission that produced it. */
  resultDigest: string;
  /** The stored findings this narration was built from, cited by id. */
  citationFindingIds: readonly string[];
  /** Newest first, so the latest answer is also the first stored one. */
  decisions: readonly ChannelRecommendationDecisionRecord[];
  /** The viewer's own helpfulness vote; null when they have not voted. */
  myFeedback: boolean | null;
  createdAt: string;
};

/**
 * A window an operator can actually ask about.
 *
 * The window is the one a governed package *declared*, not the span its
 * evidence happens to occupy. That distinction is the whole point: a package
 * declaring January whose provider left twenty days blank must still be
 * analysed as January, or the gap disappears at the window's own edges and
 * twenty missing days read as a complete twenty-day month.
 *
 * The grain is the one the projection actually wrote, so an offered window can
 * never ask a detector for a period length the evidence does not hold.
 */
export type ChannelEvidenceWindow = {
  packageId: string;
  channelId: string;
  branchId: string | null;
  /** Inclusive local dates in `timeZone`. */
  windowStart: string;
  windowEnd: string;
  timeZone: string;
  grain: AnalysisGrain;
  /** Current governed rows this package produced. Never zero; a package with none is not offered. */
  governedRowCount: number;
  /** What the operator uploaded, so they recognise the window as theirs. */
  sourceFilename: string | null;
};

export type ChannelAnalysisReadPort = {
  /** Most recent first. Includes running and failed runs, so the page can say so. */
  loadRuns(input: {
    organizationId: string;
    channelId: string;
    limit: number;
  }): Promise<ChannelAnalysisRunRecord[]>;

  /**
   * The open findings of exactly one run.
   *
   * Scoped to a run rather than to a channel on purpose. Findings from two runs
   * over different windows are two answers to the same question, and a page
   * showing both under one window's header states a figure it did not compute
   * for the window it names.
   */
  loadFindingsForRun(input: {
    organizationId: string;
    analysisRunId: string;
  }): Promise<ChannelFindingRecord[]>;

  loadEvidence(input: {
    organizationId: string;
    findingIds: readonly string[];
  }): Promise<ChannelFindingEvidenceRecord[]>;

  /**
   * The narration written over exactly one run's findings.
   *
   * Scoped to the run for the same reason `loadFindingsForRun` is: a page
   * about one window must not carry another run's words above its figures.
   * Citations are joined, every triage answer travels with a resolved display
   * name where RLS allows one, and the feedback row returned is the viewer's
   * own and nobody else's.
   */
  loadRecommendationsForRun(input: {
    organizationId: string;
    analysisRunId: string;
    /** The signed-in reader, whose own feedback vote is the only one read. */
    viewerId: string;
  }): Promise<ChannelRecommendationRecord[]>;

  /**
   * Every window this channel has governed evidence for, newest first.
   *
   * Derived from what the organization actually imported rather than counted
   * back from today: evidence arrives as uploaded reports covering past
   * periods, so a window measured from now reaches it only by coincidence.
   */
  loadEvidenceWindows(input: {
    organizationId: string;
    channelId: string;
    limit: number;
  }): Promise<ChannelEvidenceWindow[]>;
};
