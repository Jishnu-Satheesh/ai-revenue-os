/**
 * What a detector is given and what it may return.
 *
 * Deliberately free of `server-only` and of any database type: a detector is
 * pure arithmetic over evidence someone else fetched, so the same rules hold
 * wherever a figure is derived. Everything that touches a table lives in the
 * module and workflow layers.
 *
 * See `specs/018-governed-channel-intelligence.md` section 11 and ADR 0031.
 */

import type { MetricPeriodGrain, MetricQualityTier } from "@/domain/metrics/types";

/** The grains a governed report projection can currently write. */
export type AnalysisGrain = Extract<MetricPeriodGrain, "day" | "week" | "month">;

/**
 * A run answers a question about one channel, or about how the channels compare
 * with each other. There is no third case, and a detector declares which one it
 * is rather than discovering it from whatever the run happened to bind.
 */
export type DetectorScope = "channel" | "organization";

export type DetectorSeverity = "critical" | "high" | "medium" | "low";

export type FindingKind = "observation" | "finding" | "needs_data";

/**
 * The window the caller asked about.
 *
 * Supplied, never inferred. A window derived from the evidence that happens to
 * exist can never report a gap at its own edges: three days of January would
 * look like a complete three-day window rather than a January with 28 days
 * missing.
 */
export type AnalysisWindow = {
  organizationId: string;
  /** Null for a run whose detectors compare channels against each other. */
  channelId: string | null;
  branchId: string | null;
  /** Inclusive local calendar dates in `timeZone`. */
  windowStart: string;
  windowEnd: string;
  grain: AnalysisGrain;
  timeZone: string;
};

/**
 * One current governed observation from the metrics ledger.
 *
 * Periods arrive as local calendar dates rather than instants. The projection
 * already resolved the branch zone when it wrote the row; re-deriving it here
 * would be a second opinion about a boundary that is already settled.
 */
export type AnalysisSeriesPoint = {
  /** The `normalized_metrics` row, so a finding can cite the figure it used. */
  normalizedMetricId: string;
  channelId: string;
  branchId: string | null;
  metricKey: string;
  grain: MetricPeriodGrain;
  /** Inclusive local dates in `periodTimezone`. */
  periodStart: string;
  periodEnd: string;
  periodTimezone: string;
  valueKind: "money" | "count";
  /**
   * Integer minor units for money; a whole count otherwise -- except where the
   * provider measured a quantity in fractions, such as minutes, which arrive
   * carrying exactly the decimals the provider wrote (ADR 0036). A detector
   * never rounds one of these; it sums them and reports what they add to.
   */
  numerator: number;
  currency: string | null;
  qualityTier: MetricQualityTier;
  /** The governed projection run that wrote this period. */
  projectionRunId: string | null;
  /**
   * The categorical labels the provider attached to this figure, per ADR 0034.
   * Empty for every ordinary observation. Grouping by a dimension value is a
   * read-time concern; nothing downstream may switch behaviour on a specific
   * label, which is a provider snapshot rather than a platform enum.
   */
  dimensions: Readonly<Record<string, string>>;
};

/**
 * What an import said about its own gaps.
 *
 * `absentRowCount` describes the package that produced the run, which may cover
 * more days than the analysis window does. It is reported as a property of the
 * import, never subtracted from the window's own count.
 */
export type AnalysisProjectionRun = {
  projectionRunId: string;
  absentRowCount: number | null;
};

/** Evidence sitting in a held state, named by the record that holds it. */
export type AnalysisHeldEvidence = {
  reconciliationId: string;
  projectionTarget: "exact_range" | "period_grain";
  channelId: string | null;
  branchId: string | null;
  /** Inclusive local dates the held evidence covers. */
  periodStart: string;
  periodEnd: string;
  candidateCount: number;
};

/**
 * One governed figure covering an inclusive span, rather than one per period.
 *
 * Noon and EatEasily do not report a row per day. They state a total for the
 * range their export covers, and that is a different kind of fact from a
 * series: it can answer "what did this window earn" and it can never answer
 * "which day was worst", because the days were never written down.
 *
 * Kept apart from `points` for exactly that reason. A total quietly appended to
 * a series would be counted again by every detector that sums periods, and a
 * trend drawn through a single span is a shape nobody reported.
 */
export type AnalysisExactRangePoint = {
  exactRangeMetricObservationId: string;
  channelId: string;
  branchId: string | null;
  metricKey: string;
  /** The inclusive local dates the provider's own total covers. */
  periodStart: string;
  periodEnd: string;
  periodTimezone: string;
  valueKind: "money" | "count";
  numerator: number;
  currency: string | null;
  qualityState: "complete" | "partial";
  completenessState: "complete" | "partial";
  projectionRunId: string | null;
};

export type AnalysisEvidence = {
  window: AnalysisWindow;
  points: readonly AnalysisSeriesPoint[];
  /**
   * Totals covering a whole declared span. Empty for every provider that
   * reports per period, which is most of them.
   */
  exactRangePoints: readonly AnalysisExactRangePoint[];
  /**
   * Rows the loader found but could not offer, because their grain or their
   * recorded zone does not match the window. Counted rather than dropped
   * silently: a detector reporting "complete" over evidence it never saw would
   * be wrong in the one way that matters.
   */
  incomparablePointCount: number;
  projectionRuns: readonly AnalysisProjectionRun[];
  heldEvidence: readonly AnalysisHeldEvidence[];
};

export type FindingEvidenceReference = {
  kind:
    | "normalized_metric"
    | "exact_range_metric_observation"
    | "report_projection_reconciliation"
    | "projection_run";
  role:
    | "subject_period"
    | "prior_period"
    | "component"
    | "denominator"
    | "held_evidence"
    | "gap_count";
  id: string;
};

/**
 * A quantity a detector computed.
 *
 * Every number in this slice is an integer: minor units for money, whole units
 * for a count, and a numerator and denominator for a ratio. A quotient is never
 * stored, because the mean of daily rates is not the period rate.
 */
export type DetectorMeasurement = {
  valueKind: "money" | "count" | "ratio";
  numerator: number;
  /** The base the value is measured against. Required for a ratio. */
  denominator?: number;
  currency?: string;
  /**
   * Signed integer minor units, present only where the detector's declaration
   * says impact is computable and states the method.
   */
  monetaryImpactMinorUnits?: number;
};

type DetectorOutcomeBase = {
  /** Stable, per detector. What the outcome is, not how it reads. */
  code: string;
  channelId?: string;
  branchId?: string;
  metricKey?: string;
  /** Inclusive local dates the outcome is about. */
  periodStart?: string;
  periodEnd?: string;
  expectedPeriodCount?: number;
  observedPeriodCount?: number;
  absentPeriodCount?: number;
  qualityState: "complete" | "partial";
  limitations: readonly string[];
  evidence: readonly FindingEvidenceReference[];
};

/** An authoritative fact. Carries no severity, because a fact is not a problem. */
export type DetectorObservation = DetectorOutcomeBase & {
  kind: "observation";
  measurement?: DetectorMeasurement;
};

/** A quantified problem. Severity and priority are functions of the evidence. */
export type DetectorFinding = DetectorOutcomeBase & {
  kind: "finding";
  severity: DetectorSeverity;
  /** 1 is most urgent. */
  priority: number;
  measurement?: DetectorMeasurement;
};

/**
 * The declared evidence contract was unsatisfied.
 *
 * Recorded rather than left silent. An operator who cannot see that a detector
 * had nothing to work with reads its absence as "nothing wrong here".
 */
export type DetectorNeedsData = DetectorOutcomeBase & {
  kind: "needs_data";
  needsDataReason: string;
};

export type DetectorOutcome = DetectorObservation | DetectorFinding | DetectorNeedsData;

/**
 * The declaration every detector makes, per `specs/018` section 11.1.
 *
 * The prose fields are not decoration. They are what a finding's limitations
 * and refusals are written from, and what an owner reads when deciding whether
 * a number is safe to act on.
 */
export type DetectorDeclaration = {
  key: string;
  calculationVersion: number;
  owner: "core" | { pack: string };
  scope: DetectorScope;
  compatibleGrains: readonly AnalysisGrain[];
  /** Whether exact-range totals may be cited, or are refused as incomparable. */
  exactRangeEvidence: "refused" | "cited";
  requiredMetricKeys: readonly string[];
  optionalMetricKeys: readonly string[];
  minimumQualityTier: MetricQualityTier;
  /** Held evidence is not fact, so this is `current` and nothing else. */
  acceptedReconciliationStates: readonly ["current"];
  evidenceContract: readonly string[];
  severityRules: readonly string[];
  monetaryImpact: { computable: false; reason: string } | { computable: true; method: string };
  limitations: readonly string[];
  needsDataConditions: readonly string[];
  /** Pure. Returns one outcome per subject; never fills a missing input. */
  run(evidence: AnalysisEvidence): readonly DetectorOutcome[];
};
