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
  numerator: number;
  denominator: number | null;
  currency: string | null;
  qualityTier: MetricQualityTier;
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

export type MetricSeriesPort = {
  loadDefinition(organizationId: string, metricKey: string): Promise<MetricDefinitionRecord | null>;

  /**
   * Current revisions only, ordered by period. A restated observation is
   * superseded rather than updated, so "current" is `superseded_by_id is null`.
   */
  loadObservations(query: MetricSeriesQuery): Promise<MetricObservationRecord[]>;
};
