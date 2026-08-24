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
