import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { metricError } from "@/domain/metrics/errors";
import type { Database } from "@/lib/supabase/database.types";
import type {
  MetricDefinitionRecord,
  MetricObservationRecord,
  MetricObservationWrite,
  MetricProjectionStore,
  MetricSeriesPort,
  MetricTargetOption,
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

      // The code travels with the error. Without it a transient read failure
      // and a malformed query are the same opaque message, three layers below
      // the caller that has to decide whether retrying is worth anything.
      if (error)
        throw metricError("METRIC_QUERY_FAILED", { key: metricKey, code: error.code ?? "unknown" });
      if (!data) return null;

      return toDefinition(data);
    },

    async loadObservations(query) {
      // Filtered by resolved definition id, never by an embed. Two foreign keys
      // join these tables — the plain one and the composite
      // (metric_definition_id, value_kind) behind the declarative value checks
      // — so `metric_definitions!inner(key)` fails with PGRST201.
      let request = supabase
        .from("normalized_metrics")
        .select(
          "period_start, period_timezone, channel, value_numerator, value_denominator, currency, quality_tier",
        )
        .eq("organization_id", query.organizationId)
        .eq("metric_definition_id", query.metricDefinitionId)
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
      if (error)
        throw metricError("METRIC_QUERY_FAILED", {
          key: query.metricKey,
          code: error.code ?? "unknown",
        });

      return (data ?? []).map(toObservation);
    },
  };
}

/**
 * Metric keys an organization may map a CSV column onto: shared vocabulary plus
 * its own custom definitions. Read-only, so an authenticated client is enough.
 */
export async function listMetricTargets(
  supabase: MetricsClient,
  organizationId: string,
): Promise<MetricTargetOption[]> {
  const { data, error } = await supabase
    .from("metric_definitions")
    .select("key, label, value_kind, organization_id")
    .eq("is_active", true)
    .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
    .order("key", { ascending: true });

  if (error) throw metricError("METRIC_QUERY_FAILED");

  const byKey = new Map<string, MetricTargetOption>();
  for (const row of data ?? []) {
    // A custom definition outranks shared vocabulary for the same key.
    if (byKey.has(row.key) && row.organization_id === null) continue;
    const valueKind = row.value_kind as MetricTargetOption["valueKind"];
    byKey.set(row.key, {
      key: row.key,
      label: row.label,
      valueKind,
      importable: valueKind !== "ratio" && valueKind !== "rating",
    });
  }

  return [...byKey.values()].sort((left, right) => left.key.localeCompare(right.key));
}

const UNIQUE_VIOLATION = "23505";

/**
 * The write side of the projection.
 *
 * Requires a service-role client: `normalized_metrics` carries no authenticated
 * write grant, so the ingestion path is the only way in and the browser has no
 * route to a decision input.
 */
export function createMetricProjectionStore(supabase: MetricsClient): MetricProjectionStore {
  return {
    async loadProjectionContext({ organizationId, dataSourceId }) {
      const { data: source } = await supabase
        .from("integration_data_sources")
        .select("branch_id")
        .eq("organization_id", organizationId)
        .eq("id", dataSourceId)
        .maybeSingle();

      if (!source) return null;

      const { data: organization } = await supabase
        .from("organizations")
        .select("default_timezone, base_currency")
        .eq("id", organizationId)
        .maybeSingle();

      if (!organization) return null;

      // The branch timezone wins where there is one, because period boundaries
      // belong to the place the trade happened, not to the tenant's default.
      let timeZone = organization.default_timezone;
      if (source.branch_id) {
        const { data: branch } = await supabase
          .from("branches")
          .select("timezone")
          .eq("organization_id", organizationId)
          .eq("id", source.branch_id)
          .maybeSingle();
        if (branch?.timezone) timeZone = branch.timezone;
      }

      return {
        branchId: source.branch_id,
        timeZone,
        defaultCurrency: organization.base_currency,
      };
    },

    async loadDefinitionsByKey(organizationId, keys) {
      if (keys.length === 0) return new Map();

      const { data, error } = await supabase
        .from("metric_definitions")
        .select("id, key, value_kind, aggregation, percentile_p, is_active, organization_id")
        .in("key", [...keys])
        .eq("is_active", true)
        .or(`organization_id.is.null,organization_id.eq.${organizationId}`);

      if (error) throw metricError("METRIC_QUERY_FAILED");

      const byKey = new Map<string, MetricDefinitionRecord>();
      for (const row of data ?? []) {
        // A custom definition outranks shared vocabulary for the same key.
        const existing = byKey.get(row.key);
        if (existing && row.organization_id === null) continue;
        byKey.set(row.key, toDefinition(row));
      }

      return byKey;
    },

    async writeObservations(observations) {
      if (observations.length === 0) return { written: 0, duplicates: 0 };

      const rows = observations.map(toInsertRow);
      const { error } = await supabase.from("normalized_metrics").insert(rows);
      if (!error) return { written: rows.length, duplicates: 0 };
      if (error.code !== UNIQUE_VIOLATION) throw metricError("METRIC_QUERY_FAILED");

      // The batch collided with a period that already holds a current revision.
      // Postgres aborts the whole statement, so the rest are retried
      // individually to find out which ones were actually duplicates rather
      // than discarding a batch for one clash.
      let written = 0;
      let duplicates = 0;

      for (const row of rows) {
        const { error: rowError } = await supabase.from("normalized_metrics").insert(row);
        if (!rowError) {
          written += 1;
          continue;
        }
        if (rowError.code === UNIQUE_VIOLATION) {
          duplicates += 1;
          continue;
        }
        throw metricError("METRIC_QUERY_FAILED");
      }

      return { written, duplicates };
    },
  };
}

function toInsertRow(observation: MetricObservationWrite) {
  return {
    organization_id: observation.organizationId,
    branch_id: observation.branchId,
    metric_definition_id: observation.metricDefinitionId,
    value_kind: observation.valueKind,
    period_grain: observation.periodGrain,
    period_start: observation.periodStart.toISOString(),
    period_end: observation.periodEnd.toISOString(),
    period_timezone: observation.periodTimezone,
    value_numerator: observation.numerator,
    value_denominator: observation.denominator,
    currency: observation.currency,
    channel: observation.channel,
    quality_tier: observation.qualityTier,
    source_ingestion_run_id: observation.sourceIngestionRunId,
    observed_at: observation.observedAt.toISOString(),
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
  channel: string | null;
  value_numerator: number | string;
  value_denominator: number | string | null;
  currency: string | null;
  quality_tier: string;
};

function toObservation(row: ObservationRow): MetricObservationRecord {
  return {
    periodStart: new Date(row.period_start),
    periodTimezone: row.period_timezone,
    channel: row.channel,
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
