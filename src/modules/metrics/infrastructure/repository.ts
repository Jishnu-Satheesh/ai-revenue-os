import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { metricError } from "@/domain/metrics/errors";
import { toCalendarDate } from "@/domain/metrics/periods";
import type { MetricPeriodGrain } from "@/domain/metrics/types";
import type { Database } from "@/lib/supabase/database.types";
import type {
  GovernedMetricObservation,
  GovernedMetricWindowPort,
  MetricDefinitionRecord,
  MetricIngestionWindow,
  MetricIngestionWindowPort,
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
        // restatement supersedes rather than updates, and evidence held for an
        // owner's overlap decision is not settled fact yet.
        .is("superseded_by_id", null)
        .eq("reconciliation_state", "current")
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

/** How many observation rows a window query will read before it gives up. */
const MAX_WINDOW_ROWS = 20_000;

type WindowRow = {
  period_start: string;
  period_grain: string;
  period_timezone: string;
  branch_id: string | null;
};

const WINDOW_COLUMNS = "period_start, period_grain, period_timezone, branch_id";

/**
 * One run writing two grains, two zones or two branches does not describe one
 * window. Repricing them together would mix periods that are not comparable,
 * which is the same rule `readMetricSeries` enforces on reads.
 */
function toWindow(rows: readonly WindowRow[], reason: string): MetricIngestionWindow | null {
  if (rows.length === 0) return null;

  const grains = new Set(rows.map((row) => row.period_grain));
  const zones = new Set(rows.map((row) => row.period_timezone));
  const branches = new Set(rows.map((row) => row.branch_id));

  if (grains.size > 1 || zones.size > 1 || branches.size > 1)
    throw metricError("METRIC_TIMEZONE_MIXED", {
      reason,
      grains: [...grains].sort().join(","),
      zones: [...zones].sort().join(","),
      branches: branches.size,
    });

  return {
    grain: rows[0].period_grain as MetricPeriodGrain,
    branchId: rows[0].branch_id,
    timeZone: rows[0].period_timezone,
    rangeStart: new Date(rows[0].period_start),
    lastPeriodStart: new Date(rows[rows.length - 1].period_start),
    observationCount: rows.length,
  };
}

export function createMetricIngestionWindowRepository(
  supabase: MetricsClient,
): MetricIngestionWindowPort {
  return {
    async loadIngestionRunWindow({ organizationId, ingestionRunId }) {
      // Only the shape columns, and only current revisions. A restatement that
      // superseded a row does not widen the window the run originally wrote.
      const { data, error } = await supabase
        .from("normalized_metrics")
        .select(WINDOW_COLUMNS)
        .eq("organization_id", organizationId)
        .eq("source_ingestion_run_id", ingestionRunId)
        .is("superseded_by_id", null)
        .eq("reconciliation_state", "current")
        .order("period_start", { ascending: true })
        .limit(MAX_WINDOW_ROWS);

      if (error) throw metricError("METRIC_QUERY_FAILED", { code: error.code ?? "unknown" });

      return toWindow(data ?? [], "one ingestion run wrote more than one window shape");
    },

    async loadOrganizationWindow({ organizationId, metricKey }) {
      // Scoped to the revenue series rather than every metric. Revenue is the
      // spine of a period, so its span is the span worth repricing, and other
      // series bucketed differently would otherwise trip the shape check.
      const definition = await createMetricSeriesRepository(supabase).loadDefinition(
        organizationId,
        metricKey,
      );
      if (!definition) return null;

      const { data, error } = await supabase
        .from("normalized_metrics")
        .select(WINDOW_COLUMNS)
        .eq("organization_id", organizationId)
        .eq("metric_definition_id", definition.id)
        .is("superseded_by_id", null)
        .eq("reconciliation_state", "current")
        .order("period_start", { ascending: true })
        .limit(MAX_WINDOW_ROWS);

      if (error) throw metricError("METRIC_QUERY_FAILED", { code: error.code ?? "unknown" });

      return toWindow(
        data ?? [],
        "this organization holds more than one window shape for that metric",
      );
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

/** A year of daily periods across a handful of channels, with room to spare. */
const MAX_GOVERNED_WINDOW_ROWS = 10_000;
/**
 * `period_start` is an instant and the window is stated in calendar dates, so
 * the fetch is widened past the widest UTC offset in use and the exact local
 * dates are applied afterwards. Narrowing first would drop the first or last
 * period for any branch east or west of the window's own zone.
 */
const WINDOW_WIDENING_DAYS = 2;
const MS_PER_DAY = 86_400_000;

/**
 * Governed evidence for one window.
 *
 * `reconciliation_digest is not null` is what makes a row governed: it is
 * written only by the report projection path. A series some other collector
 * produced is not evidence about a governed import, and mixing the two would
 * let an unreviewed source answer a question about a reviewed one.
 */
export function createGovernedMetricWindowRepository(
  supabase: MetricsClient,
): GovernedMetricWindowPort {
  return {
    async loadGovernedWindow(query) {
      const series = createMetricSeriesRepository(supabase);
      const definitions = new Map<string, string>();
      for (const key of query.metricKeys) {
        const definition = await series.loadDefinition(query.organizationId, key);
        if (definition?.isActive) definitions.set(definition.id, definition.key);
      }
      if (definitions.size === 0) return [];

      const fetchStart = new Date(
        Date.parse(`${query.windowStart}T00:00:00Z`) - WINDOW_WIDENING_DAYS * MS_PER_DAY,
      );
      const fetchEnd = new Date(
        Date.parse(`${query.windowEnd}T00:00:00Z`) + (WINDOW_WIDENING_DAYS + 1) * MS_PER_DAY,
      );

      let request = supabase
        .from("normalized_metrics")
        .select(
          "id, channel_id, branch_id, metric_definition_id, period_grain, period_start, period_end, period_timezone, value_kind, value_numerator, currency, quality_tier, dimensions",
        )
        .eq("organization_id", query.organizationId)
        .in("metric_definition_id", [...definitions.keys()])
        .is("superseded_by_id", null)
        .eq("reconciliation_state", query.reconciliationState ?? "current")
        .not("reconciliation_digest", "is", null)
        .not("channel_id", "is", null)
        .gte("period_start", fetchStart.toISOString())
        .lt("period_start", fetchEnd.toISOString())
        .order("period_start", { ascending: true })
        .limit(MAX_GOVERNED_WINDOW_ROWS);

      if (query.channelId) request = request.eq("channel_id", query.channelId);
      if (query.branchId) request = request.eq("branch_id", query.branchId);

      const { data, error } = await request;
      if (error) throw metricError("METRIC_QUERY_FAILED", { code: error.code ?? "unknown" });

      // A truncated read is worse than no read: a detector told about fewer
      // periods than exist would report a gap nobody has.
      if ((data ?? []).length >= MAX_GOVERNED_WINDOW_ROWS)
        throw metricError("METRIC_QUERY_FAILED", {
          reason: "governed window exceeded its row budget",
        });

      return (data ?? [])
        .map((row) => {
          const timeZone = row.period_timezone;
          const periodStartDate = toCalendarDate(new Date(row.period_start), timeZone);
          // `period_end` is the exclusive next local midnight, so the last day
          // inside the period is the instant a millisecond before it.
          const periodEndDate = toCalendarDate(new Date(Date.parse(row.period_end) - 1), timeZone);
          return {
            id: row.id,
            channelId: row.channel_id as string,
            branchId: row.branch_id,
            metricKey: definitions.get(row.metric_definition_id) as string,
            grain: row.period_grain as MetricPeriodGrain,
            periodStartDate,
            periodEndDate,
            periodTimezone: timeZone,
            valueKind: row.value_kind as "money" | "count",
            numerator:
              row.value_kind === "money"
                ? toExactInteger(row.value_numerator)
                : toExactQuantity(row.value_numerator),
            currency: row.currency,
            qualityTier: row.quality_tier as GovernedMetricObservation["qualityTier"],
            dimensions: toDimensionRecord(row.dimensions),
          };
        })
        .filter(
          (observation) =>
            observation.periodStartDate >= query.windowStart &&
            observation.periodStartDate <= query.windowEnd,
        );
    },
  };
}

/**
 * Money is integer minor units and a count is whole. A value that has left the
 * safe integer range stopped being exact somewhere upstream, and a detector
 * would go on to subtract it from another one.
 */
function toExactInteger(value: number | string): number {
  const parsed = toNumber(value);
  if (!Number.isSafeInteger(parsed))
    throw metricError("METRIC_QUERY_FAILED", {
      reason: "governed observation is not an exact integer",
    });
  return parsed;
}

/**
 * A measured quantity may carry fractions -- the provider wrote `355.6` closed
 * minutes, and rounding it would fabricate time nobody lost (ADR 0036). What
 * is refused is anything a detector cannot sum and restate without drift:
 * non-finite values and magnitudes beyond the exact integer range.
 */
function toExactQuantity(value: number | string): number {
  const parsed = toNumber(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) >= Number.MAX_SAFE_INTEGER)
    throw metricError("METRIC_QUERY_FAILED", {
      reason: "governed observation is not an exact quantity",
    });
  return parsed;
}

/**
 * The categorical labels a categorical output wrote beside its figure
 * (ADR 0034). The column is bounded jsonb, but jsonb is still untyped from
 * this side, so anything that is not a flat string-valued object is dropped
 * rather than trusted: a dimension value a detector cannot read as a label is
 * not one it may group by.
 */
function toDimensionRecord(value: unknown): Readonly<Record<string, string>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const record: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") record[key] = entry;
  }
  return record;
}
