import type {
  MetricAggregation,
  MetricPeriodGrain,
  MetricQualityTier,
  MetricValueKind,
} from "@/domain/metrics/types";

/**
 * The read boundary for normalized metrics.
 *
 * `specs/015-metric-registry-and-normalized-metrics.md` section 7 requires every
 * consumer to read through one port, so revision resolution, gap policy and
 * declared aggregation are enforced once rather than reimplemented per caller.
 * Nothing outside this module may query `normalized_metrics` directly.
 */

export type MetricDefinitionRecord = {
  id: string;
  key: string;
  valueKind: MetricValueKind;
  aggregation: MetricAggregation;
  percentileP: number | null;
  isActive: boolean;
};

export type MetricObservationRecord = {
  periodStart: Date;
  periodTimezone: string;
  /** The channel this period covers, or null for an unchannelled series. */
  channel: string | null;
  numerator: number;
  denominator: number | null;
  currency: string | null;
  qualityTier: MetricQualityTier;
};

/**
 * A metric key offered as a CSV mapping target.
 *
 * `importable` is false for ratio and rating kinds: they need a numerator and a
 * denominator, a single CSV column can only supply a quotient, and the
 * projection refuses one. Surfacing that in the picker is better than letting an
 * operator choose a rate and discover at import time that every row rejected.
 */
export type MetricTargetOption = {
  key: string;
  label: string;
  valueKind: MetricValueKind;
  importable: boolean;
};

export type MetricSeriesQuery = {
  organizationId: string;
  metricKey: string;
  grain: MetricPeriodGrain;
  rangeStart: Date;
  rangeEndExclusive: Date;
  /**
   * The zone the caller expects the series to be bucketed in, normally the
   * branch timezone. Required rather than inferred, because an empty series has
   * no observation to infer it from and gap detection still needs boundaries.
   */
  timeZone: string;
  branchId?: string | null;
  subjectKind?: string;
  subjectRef?: string | null;
  channel?: string | null;
};

/**
 * Observations are fetched by resolved definition id rather than by key.
 *
 * The obvious alternative — embedding `metric_definitions` and filtering on the
 * joined key — cannot work: two foreign keys link these tables, the plain one
 * and the composite `(metric_definition_id, value_kind)` that makes the ratio
 * and currency checks declarative, and PostgREST refuses an ambiguous embed
 * with PGRST201. The caller has already resolved the definition, so passing its
 * id costs nothing and removes a join.
 */
export type MetricObservationQuery = MetricSeriesQuery & { metricDefinitionId: string };

export type MetricSeriesPort = {
  loadDefinition(organizationId: string, metricKey: string): Promise<MetricDefinitionRecord | null>;

  /**
   * Current revisions only, ordered by period. A restated observation is
   * superseded rather than updated, so "current" is `superseded_by_id is null`.
   */
  loadObservations(query: MetricObservationQuery): Promise<MetricObservationRecord[]>;
};

/**
 * The span one ingestion run wrote, and the shape it wrote it in.
 *
 * A recompute needs to know which periods an import actually touched. Asking
 * the observations is exact and needs no plumbing through the ingestion
 * workflow, which counts rows and never learns what dates they carried. It is
 * also correct for a partial import, where some rows rejected and the window is
 * narrower than the file.
 */
export type MetricIngestionWindow = {
  grain: MetricPeriodGrain;
  branchId: string | null;
  timeZone: string;
  /** The first period the run wrote. */
  rangeStart: Date;
  /** The last period the run wrote; the caller extends it to that period's end. */
  lastPeriodStart: Date;
  observationCount: number;
};

export type MetricIngestionWindowPort = {
  /**
   * Null when the run wrote nothing, which is an ordinary outcome for an import
   * whose rows all rejected. Throws when one run wrote more than one grain or
   * more than one timezone, because those do not describe a single window and
   * repricing them together would mix incomparable periods.
   */
  loadIngestionRunWindow(input: {
    organizationId: string;
    ingestionRunId: string;
  }): Promise<MetricIngestionWindow | null>;

  /**
   * Everything the organization has, for the case where the inputs changed
   * rather than the data: a corrected commission rate reprices every period it
   * was in force for, and which periods those are is not knowable from any one
   * ingestion run.
   */
  loadOrganizationWindow(input: {
    organizationId: string;
    metricKey: string;
  }): Promise<MetricIngestionWindow | null>;
};

/**
 * Everything a CSV row needs that the row itself cannot carry. Grain, timezone
 * and currency are properties of the branch and the import, not of the file.
 */
export type MetricProjectionContext = {
  branchId: string | null;
  timeZone: string;
  defaultCurrency: string | null;
};

export type MetricObservationWrite = {
  organizationId: string;
  branchId: string | null;
  metricDefinitionId: string;
  valueKind: MetricValueKind;
  periodGrain: MetricPeriodGrain;
  periodStart: Date;
  periodEnd: Date;
  periodTimezone: string;
  numerator: number;
  denominator: number | null;
  currency: string | null;
  channel: string | null;
  qualityTier: MetricQualityTier;
  sourceIngestionRunId: string | null;
  observedAt: Date;
};

export type MetricProjectionStore = {
  /** Resolves the branch timezone and the organization's currency for an import. */
  loadProjectionContext(input: {
    organizationId: string;
    dataSourceId: string;
  }): Promise<MetricProjectionContext | null>;

  loadDefinitionsByKey(
    organizationId: string,
    keys: readonly string[],
  ): Promise<Map<string, MetricDefinitionRecord>>;

  /**
   * Inserts observations, reporting rather than overwriting a period that
   * already holds a current revision. A re-uploaded file is a restatement, and
   * a restatement is a governed act rather than a side effect of re-importing.
   */
  writeObservations(
    observations: readonly MetricObservationWrite[],
  ): Promise<{ written: number; duplicates: number }>;
};
