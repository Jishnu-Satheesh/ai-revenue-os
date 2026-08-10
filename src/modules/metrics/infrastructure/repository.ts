import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { metricError } from "@/domain/metrics/errors";
import type { Database } from "@/lib/supabase/database.types";
import type {
  MetricDefinitionRecord,
  MetricObservationRecord,
  MetricSeriesPort,
} from "@/modules/metrics/application/ports";

type MetricsClient = SupabaseClient<Database>;

/** A window wide enough for any dashboard, narrow enough to bound a bad query. */
const MAX_OBSERVATIONS = 5_000;

export function createMetricSeriesRepository(supabase: MetricsClient): MetricSeriesPort {
  return {
    async loadDefinition(organizationId, metricKey) {
      // Shared vocabulary carries no organization; a custom key carries this
      // one. A key cannot be both, because registering a custom key that
      // shadows shared vocabulary is rejected at write time.
      const { data, error } = await supabase
        .from("metric_definitions")
        .select("id, key, value_kind, aggregation, percentile_p, is_active, organization_id")
        .eq("key", metricKey)
        .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
        .order("organization_id", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      if (error) throw metricError("METRIC_AGGREGATION_UNSUPPORTED", { key: metricKey });
      if (!data) return null;

      return toDefinition(data);
    },

    async loadObservations(query) {
      let request = supabase
        .from("normalized_metrics")
        .select(
          "period_start, period_timezone, value_numerator, value_denominator, currency, quality_tier, metric_definitions!inner(key)",
        )
        .eq("organization_id", query.organizationId)
        .eq("metric_definitions.key", query.metricKey)
        .eq("period_grain", query.grain)
        // "Current" has one definition and no second source of truth: a
        // restatement supersedes rather than updates.
        .is("superseded_by_id", null)
        .gte("period_start", query.rangeStart.toISOString())
        .lt("period_start", query.rangeEndExclusive.toISOString())
        .order("period_start", { ascending: true })
        .limit(MAX_OBSERVATIONS);

      // A null filter and an absent filter mean different things: the first
      // asks for organization-wide rows, the second asks for every branch.
      if (query.branchId !== undefined)
        request =
          query.branchId === null
            ? request.is("branch_id", null)
            : request.eq("branch_id", query.branchId);

      if (query.subjectKind !== undefined) request = request.eq("subject_kind", query.subjectKind);

      if (query.subjectRef !== undefined)
        request =
          query.subjectRef === null
            ? request.is("subject_ref", null)
            : request.eq("subject_ref", query.subjectRef);

      if (query.channel !== undefined)
        request =
          query.channel === null
            ? request.is("channel", null)
            : request.eq("channel", query.channel);

      const { data, error } = await request;
      if (error) throw metricError("METRIC_AGGREGATION_UNSUPPORTED", { key: query.metricKey });

      return (data ?? []).map(toObservation);
    },
  };
}

type DefinitionRow = {
  id: string;
  key: string;
  value_kind: string;
  aggregation: string;
  percentile_p: number | string | null;
  is_active: boolean;
};

function toDefinition(row: DefinitionRow): MetricDefinitionRecord {
  return {
    id: row.id,
    key: row.key,
    valueKind: row.value_kind as MetricDefinitionRecord["valueKind"],
    aggregation: row.aggregation as MetricDefinitionRecord["aggregation"],
    percentileP: toNumberOrNull(row.percentile_p),
    isActive: row.is_active,
  };
}

type ObservationRow = {
  period_start: string;
  period_timezone: string;
  value_numerator: number | string;
  value_denominator: number | string | null;
  currency: string | null;
  quality_tier: string;
};

function toObservation(row: ObservationRow): MetricObservationRecord {
  return {
    periodStart: new Date(row.period_start),
    periodTimezone: row.period_timezone,
    numerator: toNumber(row.value_numerator),
    denominator: toNumberOrNull(row.value_denominator),
    currency: row.currency,
    qualityTier: row.quality_tier as MetricObservationRecord["qualityTier"],
  };
}

/** Postgres `numeric` can arrive as a string, so never trust the wire type. */
function toNumber(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw metricError("METRIC_DENOMINATOR_INVALID");
  return parsed;
}

function toNumberOrNull(value: number | string | null): number | null {
  return value === null ? null : toNumber(value);
}
