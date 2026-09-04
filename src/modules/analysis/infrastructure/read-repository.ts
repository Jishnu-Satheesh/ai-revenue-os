import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveAnalysisMonth } from "@/domain/analysis/calendar";
import type { AnalysisGrain, DetectorSeverity, FindingKind } from "@/domain/analysis/types";
import { toCalendarDate } from "@/domain/metrics/periods";
import type { Database } from "@/lib/supabase/database.types";
import type {
  AnalysedWindowKey,
  ChannelAnalysisReadPort,
  ChannelAnalysisRunRecord,
  ChannelBandRecord,
  ChannelEvidenceWindow,
  ChannelFindingEvidenceRecord,
  ChannelFindingRecord,
  ChannelRecommendationDecisionRecord,
  ChannelRecommendationRecord,
} from "@/modules/analysis/application/ports";

/**
 * Reads channel analysis through the caller's own session.
 *
 * Never the service role. `specs/018` section 14 and the platform rule in
 * `AGENTS.md` both forbid bypassing RLS in a user-facing path, and there is
 * nothing here that needs it: findings carry a read policy for `report.read`,
 * so a member who may not see them gets an empty list rather than a refusal
 * assembled in application code.
 */

type AnalysisClient = SupabaseClient<Database>;

/** A page shows a handful of runs and the findings of the newest completed one. */
const MAX_RUNS = 10;
const MAX_FINDINGS = 500;
const MAX_EVIDENCE = 5_000;
/** UUID filters above this size exceed common gateway request-line limits. */
const EVIDENCE_METRIC_BATCH_SIZE = 200;
/** A picker an operator can read, not every package they ever uploaded. */
const MAX_EVIDENCE_WINDOWS = 24;
const MAX_LINEAGE = 10_000;
/**
 * The narrator files at most six recommendations per submission, but a run may
 * be narrated more than once (a re-submission writes new rows rather than
 * overwriting), so the cap is generous and the order newest-first.
 */
const MAX_RECOMMENDATIONS = 60;
const MAX_CITATIONS = 600;
const MAX_RECOMMENDATION_DECISIONS = 1_000;
/** The two codes the money band reads, and nothing else. */
const BAND_CODES = ["WINDOW_GROSS_REVENUE", "ORDER_CANCELLATION_LOSS"] as const;
/**
 * Completed runs for one declared window, across every channel in the
 * organization. Not one row per channel: re-running an analysis over the same
 * window does not delete the previous completed run, it adds another one, so
 * this count grows with re-analysis history, not with channel count alone.
 * 2,000 is chosen to comfortably outlast that: an organization would need
 * hundreds of channels each re-analysed many times over the very same window
 * before approaching it, which is far beyond any real portfolio here, while
 * still being a real, finite cap rather than an unbounded read.
 */
const MAX_CHANNEL_BAND_RUNS = 2_000;
/**
 * A picker an operator can open a window from, not every window an
 * organization has ever analysed. An organization with a very long analysis
 * history must not be able to make this query unbounded.
 */
const MAX_ANALYSED_WINDOW_ROWS = 500;

export class ChannelAnalysisReadError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ChannelAnalysisReadError";
  }
}

/**
 * Postgres `numeric` arrives as a string over the wire often enough that
 * trusting the type is a bug waiting for a large figure. A value that is not an
 * exact integer never reaches a tile: money is minor units and a count is
 * whole, so a fraction here means something upstream stopped being exact.
 */
function toExactInteger(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new ChannelAnalysisReadError("VALUE_NOT_EXACT");
  return parsed;
}

/**
 * The two parts of a stored ratio may carry exactly the decimals the provider
 * measured -- closed minutes arrive as `34216.93` -- and rounding them on read
 * would restate the finding the detector recorded (ADR 0036). What is still
 * refused is anything non-finite or beyond the exact integer range: a figure
 * this loose never reaches a tile.
 */
function toExactQuantity(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) >= Number.MAX_SAFE_INTEGER) {
    throw new ChannelAnalysisReadError("VALUE_NOT_EXACT");
  }
  return parsed;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function toDimensionRecord(value: unknown): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const dimensions: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string") dimensions[key] = entry;
  }
  return dimensions;
}

function toDetectorVersions(value: unknown): { key: string; calculationVersion: number }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as { key?: unknown; calculationVersion?: unknown };
    return typeof record.key === "string" && typeof record.calculationVersion === "number"
      ? [{ key: record.key, calculationVersion: record.calculationVersion }]
      : [];
  });
}

/** The finding columns both `loadFindingsForRun` and the money band read. */
const CHANNEL_FINDING_COLUMNS =
  "id, analysis_run_id, channel_id, branch_id, detector_key, detector_version, kind, code, severity, priority, metric_key, period_start, period_end, value_kind, value_numerator, value_denominator, currency, monetary_impact_minor_units, expected_period_count, observed_period_count, absent_period_count, quality_state, needs_data_reason, limitations, calculation_digest, created_at";

type ChannelFindingRow = {
  id: string;
  analysis_run_id: string;
  channel_id: string | null;
  branch_id: string | null;
  detector_key: string;
  detector_version: number;
  kind: string;
  code: string;
  severity: string | null;
  priority: number | null;
  metric_key: string | null;
  period_start: string | null;
  period_end: string | null;
  value_kind: "money" | "count" | "ratio" | null;
  value_numerator: number | string | null;
  value_denominator: number | string | null;
  currency: string | null;
  monetary_impact_minor_units: number | string | null;
  expected_period_count: number | null;
  observed_period_count: number | null;
  absent_period_count: number | null;
  quality_state: "complete" | "partial";
  needs_data_reason: string | null;
  limitations: unknown;
  calculation_digest: string;
  created_at: string;
};

/**
 * Maps one finding row identically wherever it is read, so a caller reading a
 * whole run's findings and a caller reading two codes for a money band never
 * disagree about what one stored row means.
 */
function toFindingRecord(row: ChannelFindingRow): ChannelFindingRecord {
  return {
    id: row.id,
    analysisRunId: row.analysis_run_id,
    channelId: row.channel_id,
    branchId: row.branch_id,
    detectorKey: row.detector_key,
    detectorVersion: row.detector_version,
    kind: row.kind as FindingKind,
    code: row.code,
    severity: row.severity as DetectorSeverity | null,
    priority: row.priority,
    metricKey: row.metric_key,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    valueKind: row.value_kind,
    valueNumerator: toExactQuantity(row.value_numerator),
    valueDenominator: toExactQuantity(row.value_denominator),
    currency: row.currency,
    monetaryImpactMinorUnits: toExactInteger(row.monetary_impact_minor_units),
    expectedPeriodCount: row.expected_period_count,
    observedPeriodCount: row.observed_period_count,
    absentPeriodCount: row.absent_period_count,
    qualityState: row.quality_state,
    needsDataReason: row.needs_data_reason,
    limitations: toStringArray(row.limitations),
    calculationDigest: row.calculation_digest,
    createdAt: row.created_at,
  };
}

export function createAuthenticatedChannelAnalysisRepository(
  supabase: AnalysisClient,
): ChannelAnalysisReadPort {
  const repository: ChannelAnalysisReadPort = {
    async loadRuns({ organizationId, channelId, limit }) {
      const { data, error } = await supabase
        .from("channel_analysis_runs")
        .select(
          "id, channel_id, branch_id, window_start, window_end, period_grain, window_timezone, registry_version, detector_versions, status, finding_count, observation_count, needs_data_count, safe_failure_code, started_at, completed_at",
        )
        .eq("organization_id", organizationId)
        .eq("channel_id", channelId)
        .order("started_at", { ascending: false })
        .limit(Math.min(limit, MAX_RUNS));

      if (error) throw new ChannelAnalysisReadError(error.code ?? "unknown");

      return (data ?? []).map(
        (row): ChannelAnalysisRunRecord => ({
          id: row.id,
          channelId: row.channel_id,
          branchId: row.branch_id,
          windowStart: row.window_start,
          windowEnd: row.window_end,
          periodGrain: row.period_grain as AnalysisGrain,
          windowTimezone: row.window_timezone,
          registryVersion: row.registry_version,
          detectorVersions: toDetectorVersions(row.detector_versions),
          status: row.status,
          findingCount: row.finding_count,
          observationCount: row.observation_count,
          needsDataCount: row.needs_data_count,
          safeFailureCode: row.safe_failure_code,
          startedAt: row.started_at,
          completedAt: row.completed_at,
        }),
      );
    },

    async loadFindingsForRun({ organizationId, analysisRunId }) {
      const { data, error } = await supabase
        .from("channel_findings")
        .select(CHANNEL_FINDING_COLUMNS)
        .eq("organization_id", organizationId)
        // One run, so every figure on the page was computed for the window the
        // page names. Reading by channel instead mixes windows: the header
        // states one, the headline figure comes from another.
        .eq("analysis_run_id", analysisRunId)
        // A superseded finding is the answer a later run replaced. Two figures
        // for one question on one page is worse than one figure.
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(MAX_FINDINGS);

      if (error) throw new ChannelAnalysisReadError(error.code ?? "unknown");

      return (data ?? []).map(toFindingRecord);
    },

    async loadEvidenceWindows({ organizationId, channelId, limit }) {
      // Packages first: the declared window lives here, and it is the window an
      // analysis must use. Deriving one from the evidence instead would move
      // the edges inward onto the first and last day that happen to carry a
      // figure, and a window cannot report a gap at its own edge.
      const packagesBase = supabase
        .from("integration_report_packages")
        .select(
          "id, channel_id, branch_id, declared_period_start, declared_period_end, period_timezone, original_filename, uploaded_at",
        )
        .eq("organization_id", organizationId)
        .eq("status", "projected")
        .not("declared_period_start", "is", null)
        .not("declared_period_end", "is", null);

      const { data: packages, error: packageError } = await (
        channelId === null ? packagesBase : packagesBase.eq("channel_id", channelId)
      )
        .order("declared_period_end", { ascending: false })
        .limit(Math.min(limit, MAX_EVIDENCE_WINDOWS));

      if (packageError) throw new ChannelAnalysisReadError(packageError.code ?? "unknown");
      const packageRows = packages ?? [];
      if (packageRows.length === 0) return [];

      // Which grain each package's projection actually wrote, and how many
      // current rows survive today. A package whose rows were all superseded or
      // held is not a window anything can be analysed over, so it is dropped
      // rather than offered as an empty choice.
      const { data: runs, error: runError } = await supabase
        .from("integration_report_projection_runs")
        .select("id, report_package_id")
        .eq("organization_id", organizationId)
        .in(
          "report_package_id",
          packageRows.map((row) => row.id),
        );
      if (runError) throw new ChannelAnalysisReadError(runError.code ?? "unknown");

      const packageByRun = new Map((runs ?? []).map((row) => [row.id, row.report_package_id]));
      if (packageByRun.size === 0) return [];

      const { data: lineage, error: lineageError } = await supabase
        .from("report_projection_lineage")
        .select("projection_run_id, normalized_metric_id, exact_range_metric_observation_id")
        .eq("organization_id", organizationId)
        .in("projection_run_id", [...packageByRun.keys()])
        .limit(MAX_LINEAGE);
      if (lineageError) throw new ChannelAnalysisReadError(lineageError.code ?? "unknown");

      // A projection writes one shape or the other, and lineage records which:
      // a period-grain row carries `normalized_metric_id`, an exact-range row
      // carries `exact_range_metric_observation_id`. Following only the first
      // left a provider that states one figure per export with no window at
      // all, so its evidence sat in the ledger unreadable by any run.
      const runByMetricId = new Map<string, string>();
      const runByObservationId = new Map<string, string>();
      for (const row of lineage ?? []) {
        if (row.normalized_metric_id)
          runByMetricId.set(row.normalized_metric_id, row.projection_run_id);
        if (row.exact_range_metric_observation_id)
          runByObservationId.set(row.exact_range_metric_observation_id, row.projection_run_id);
      }
      if (runByMetricId.size === 0 && runByObservationId.size === 0) return [];

      const metrics: { id: string; period_grain: string }[] = [];
      const metricIds = [...runByMetricId.keys()];
      for (let offset = 0; offset < metricIds.length; offset += EVIDENCE_METRIC_BATCH_SIZE) {
        const batch = metricIds.slice(offset, offset + EVIDENCE_METRIC_BATCH_SIZE);
        const { data, error: metricError } = await supabase
          .from("normalized_metrics")
          .select("id, period_grain")
          .eq("organization_id", organizationId)
          .in("id", batch)
          .eq("reconciliation_state", "current")
          .is("superseded_by_id", null)
          .limit(EVIDENCE_METRIC_BATCH_SIZE + 1);
        if (metricError) throw new ChannelAnalysisReadError(metricError.code ?? "unknown");
        if ((data ?? []).length > batch.length)
          throw new ChannelAnalysisReadError("EVIDENCE_DETAIL_NOT_BOUNDED");
        metrics.push(...(data ?? []));
      }

      // The same question for the exact-range ledger: which of this package's
      // span observations still stand. A superseded or held span is no more
      // analysable than a superseded day.
      const spans: { id: string }[] = [];
      const observationIds = [...runByObservationId.keys()];
      for (let offset = 0; offset < observationIds.length; offset += EVIDENCE_METRIC_BATCH_SIZE) {
        const batch = observationIds.slice(offset, offset + EVIDENCE_METRIC_BATCH_SIZE);
        const { data, error: spanError } = await supabase
          .from("exact_range_metric_observations")
          .select("id")
          .eq("organization_id", organizationId)
          .in("id", batch)
          .eq("reconciliation_state", "current")
          .is("superseded_by_id", null)
          .limit(EVIDENCE_METRIC_BATCH_SIZE + 1);
        if (spanError) throw new ChannelAnalysisReadError(spanError.code ?? "unknown");
        if ((data ?? []).length > batch.length)
          throw new ChannelAnalysisReadError("EVIDENCE_DETAIL_NOT_BOUNDED");
        spans.push(...(data ?? []));
      }

      // One package can only be offered at the grain its projection wrote. Two
      // grains from one package would be two windows an operator cannot tell
      // apart, so the grain with the most current rows is the one offered.
      const grainCounts = new Map<string, Map<string, number>>();
      for (const row of metrics) {
        const runId = runByMetricId.get(row.id);
        const packageId = runId ? packageByRun.get(runId) : undefined;
        if (!packageId) continue;
        const byGrain = grainCounts.get(packageId) ?? new Map<string, number>();
        byGrain.set(row.period_grain, (byGrain.get(row.period_grain) ?? 0) + 1);
        grainCounts.set(packageId, byGrain);
      }
      for (const row of spans) {
        const runId = runByObservationId.get(row.id);
        const packageId = runId ? packageByRun.get(runId) : undefined;
        if (!packageId) continue;
        const byGrain = grainCounts.get(packageId) ?? new Map<string, number>();
        byGrain.set("span", (byGrain.get("span") ?? 0) + 1);
        grainCounts.set(packageId, byGrain);
      }

      return packageRows.flatMap((row): ChannelEvidenceWindow[] => {
        const byGrain = grainCounts.get(row.id);
        if (!byGrain || byGrain.size === 0) return [];
        const [grain, count] = [...byGrain.entries()].sort(
          (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
        )[0];
        // A grain the analysis registry cannot bind is not a window to offer.
        if (grain !== "day" && grain !== "week" && grain !== "month" && grain !== "span") return [];
        return [
          {
            packageId: row.id,
            channelId: row.channel_id as string,
            branchId: row.branch_id,
            windowStart: row.declared_period_start as string,
            windowEnd: row.declared_period_end as string,
            timeZone: row.period_timezone,
            grain,
            governedRowCount: count,
            sourceFilename: row.original_filename,
          },
        ];
      });
    },

    async loadChannelBandsForWindow({ organizationId, windowStart, windowEnd, grain }) {
      const { data: runs, error: runError } = await supabase
        .from("channel_analysis_runs")
        .select("id, channel_id, completed_at")
        .eq("organization_id", organizationId)
        .eq("window_start", windowStart)
        .eq("window_end", windowEnd)
        .eq("period_grain", grain)
        .eq("status", "completed")
        .not("channel_id", "is", null)
        .order("completed_at", { ascending: false })
        .limit(MAX_CHANNEL_BAND_RUNS);
      if (runError) throw new ChannelAnalysisReadError(runError.code ?? "unknown");

      // Newest first, so the first run seen for a channel is the one that
      // stands. A channel re-analysed over the same window has two completed
      // runs, and the later answer is the current one.
      const latestByChannel = new Map<string, string>();
      for (const row of runs ?? []) {
        const channelId = row.channel_id as string;
        if (!latestByChannel.has(channelId)) latestByChannel.set(channelId, row.id);
      }
      if (latestByChannel.size === 0) return [];

      // Batched for the same reason loadEvidenceWindows batches its metric
      // reads: PostgREST folds an `.in()` filter's values into the request
      // line, and one filter naming every channel's run id can exceed a
      // common gateway's request-line limit before RLS or the database ever
      // sees the query.
      const runIds = [...latestByChannel.values()];
      const byRun = new Map<string, ChannelFindingRecord[]>();
      for (let offset = 0; offset < runIds.length; offset += EVIDENCE_METRIC_BATCH_SIZE) {
        const batch = runIds.slice(offset, offset + EVIDENCE_METRIC_BATCH_SIZE);
        const { data, error: findingError } = await supabase
          .from("channel_findings")
          .select(CHANNEL_FINDING_COLUMNS)
          .eq("organization_id", organizationId)
          .in("analysis_run_id", batch)
          .in("code", [...BAND_CODES])
          // A superseded finding is the answer a later run replaced. Two
          // figures for one question on one page is worse than one figure --
          // the same reason loadFindingsForRun filters to open findings, and
          // this band must never disagree with that page over the same run.
          .eq("status", "open")
          // Each detector writes at most one open finding per code per run,
          // so two band codes read means at most two rows per run id in the
          // batch.
          .limit(batch.length * BAND_CODES.length + 1);
        if (findingError) throw new ChannelAnalysisReadError(findingError.code ?? "unknown");
        if ((data ?? []).length > batch.length * BAND_CODES.length)
          throw new ChannelAnalysisReadError("BAND_FINDINGS_NOT_BOUNDED");

        for (const row of data ?? []) {
          const mapped = toFindingRecord(row);
          const group = byRun.get(mapped.analysisRunId) ?? [];
          group.push(mapped);
          byRun.set(mapped.analysisRunId, group);
        }
      }

      return [...latestByChannel.entries()].map(
        ([channelId, analysisRunId]): ChannelBandRecord => ({
          channelId,
          analysisRunId,
          findings: byRun.get(analysisRunId) ?? [],
        }),
      );
    },

    async loadAnalysedWindowKeys({ organizationId }) {
      const { data, error } = await supabase
        .from("channel_analysis_runs")
        .select("window_start, window_end, period_grain")
        .eq("organization_id", organizationId)
        .eq("status", "completed")
        .not("channel_id", "is", null)
        .order("window_end", { ascending: false })
        .limit(MAX_ANALYSED_WINDOW_ROWS);
      if (error) throw new ChannelAnalysisReadError(error.code ?? "unknown");

      const seen = new Set<string>();
      const keys: AnalysedWindowKey[] = [];
      for (const row of data ?? []) {
        const grain = row.period_grain;
        if (grain !== "day" && grain !== "week" && grain !== "month") continue;
        const key = `${row.window_start}|${row.window_end}|${grain}`;
        if (seen.has(key)) continue;
        seen.add(key);
        keys.push({ windowStart: row.window_start, windowEnd: row.window_end, grain });
      }
      return keys;
    },

    async loadAnalysisMonthTimeline({ organizationId, channelId }) {
      // The horizon comes from declared package dates, not from surviving
      // evidence rows: a package whose rows were all superseded still declares
      // the month, and a gap month must stay selectable. Two bounded rows.
      const earliestBase = supabase
        .from("integration_report_packages")
        .select("declared_period_start")
        .eq("organization_id", organizationId)
        .eq("status", "projected")
        .not("declared_period_start", "is", null);
      const latestBase = supabase
        .from("integration_report_packages")
        .select("declared_period_end")
        .eq("organization_id", organizationId)
        .eq("status", "projected")
        .not("declared_period_end", "is", null);
      const earliestScoped =
        channelId === null ? earliestBase : earliestBase.eq("channel_id", channelId);
      const latestScoped = channelId === null ? latestBase : latestBase.eq("channel_id", channelId);
      const { data: earliestRows, error: earliestError } = await earliestScoped
        .order("declared_period_start", { ascending: true })
        .limit(1);
      if (earliestError) throw new ChannelAnalysisReadError(earliestError.code ?? "unknown");
      const { data: latestRows, error: latestError } = await latestScoped
        .order("declared_period_end", { ascending: false })
        .limit(1);
      if (latestError) throw new ChannelAnalysisReadError(latestError.code ?? "unknown");

      const earliest = (earliestRows ?? [])[0]?.declared_period_start;
      const latest = (latestRows ?? [])[0]?.declared_period_end;
      if (typeof earliest !== "string" || typeof latest !== "string") return null;
      return { firstMonth: earliest.slice(0, 7), lastMonth: latest.slice(0, 7) };
    },

    async loadEvidence({ organizationId, findingIds }) {
      if (findingIds.length === 0) return [];

      const { data, error } = await supabase
        .from("channel_finding_evidence")
        .select(
          "finding_id, evidence_kind, evidence_role, normalized_metric_id, exact_range_metric_observation_id, reconciliation_id, projection_run_id",
        )
        .eq("organization_id", organizationId)
        .in("finding_id", [...findingIds])
        .limit(MAX_EVIDENCE);

      if (error) throw new ChannelAnalysisReadError(error.code ?? "unknown");

      const evidence = (data ?? []).flatMap((row): ChannelFindingEvidenceRecord[] => {
        // Exactly one of the four columns is set, guaranteed by a check
        // constraint. Resolving it here keeps the union out of the view layer.
        const referenceId =
          row.normalized_metric_id ??
          row.exact_range_metric_observation_id ??
          row.reconciliation_id ??
          row.projection_run_id;
        return referenceId
          ? [
              {
                findingId: row.finding_id,
                evidenceKind: row.evidence_kind,
                evidenceRole: row.evidence_role,
                referenceId,
              },
            ]
          : [];
      });

      const metricIds = [
        ...new Set(
          evidence
            .filter((row) => row.evidenceKind === "normalized_metric")
            .map((row) => row.referenceId),
        ),
      ];
      if (metricIds.length === 0) return evidence;

      const metricById = new Map<string, NonNullable<ChannelFindingEvidenceRecord["metric"]>>();
      for (let offset = 0; offset < metricIds.length; offset += EVIDENCE_METRIC_BATCH_SIZE) {
        const batch = metricIds.slice(offset, offset + EVIDENCE_METRIC_BATCH_SIZE);
        const { data: metrics, error: metricError } = await supabase
          .from("normalized_metrics")
          .select("id, period_start, period_end, period_timezone, value_numerator, dimensions")
          .eq("organization_id", organizationId)
          .in("id", batch)
          .limit(EVIDENCE_METRIC_BATCH_SIZE + 1);

        if (metricError) throw new ChannelAnalysisReadError(metricError.code ?? "unknown");
        if ((metrics ?? []).length > batch.length)
          throw new ChannelAnalysisReadError("EVIDENCE_DETAIL_NOT_BOUNDED");

        for (const metric of metrics ?? []) {
          const numerator = toExactQuantity(metric.value_numerator);
          if (numerator === null) throw new ChannelAnalysisReadError("VALUE_NOT_EXACT");
          metricById.set(metric.id, {
            periodStart: toCalendarDate(new Date(metric.period_start), metric.period_timezone),
            periodEnd: toCalendarDate(
              new Date(Date.parse(metric.period_end) - 1),
              metric.period_timezone,
            ),
            numerator,
            dimensions: toDimensionRecord(metric.dimensions),
          });
        }
      }

      return evidence.map((row) => {
        const metric =
          row.evidenceKind === "normalized_metric" ? metricById.get(row.referenceId) : undefined;
        return metric ? { ...row, metric } : row;
      });
    },

    async loadRecommendationsForRun({ organizationId, analysisRunId, viewerId }) {
      // Only the displayed run's narration, for the same reason findings are
      // read per run: words narrated over another window must not sit above
      // this window's figures. Newest first, so each submission's newest item
      // is also the first row carrying its result digest.
      const { data: rows, error } = await supabase
        .from("channel_recommendations")
        .select(
          "id, channel_id, branch_id, label, headline, detail, supported_actions, limitations, result_digest, created_at",
        )
        .eq("organization_id", organizationId)
        .eq("analysis_run_id", analysisRunId)
        .order("created_at", { ascending: false })
        .limit(MAX_RECOMMENDATIONS);

      if (error) throw new ChannelAnalysisReadError(error.code ?? "unknown");
      const recommendationRows = rows ?? [];
      if (recommendationRows.length === 0) return [];
      const recommendationIds = recommendationRows.map((row) => row.id);

      // What each item cited. A citation is a receipt, not a visibility rule:
      // it may name a finding this page does not display (a superseded one),
      // and the id still travels so nothing about the run is hidden.
      const { data: citations, error: citationError } = await supabase
        .from("channel_recommendation_citations")
        .select("recommendation_id, finding_id")
        .eq("organization_id", organizationId)
        .in("recommendation_id", [...recommendationIds])
        .limit(MAX_CITATIONS);
      if (citationError) throw new ChannelAnalysisReadError(citationError.code ?? "unknown");

      // Every triage answer ever recorded; which one stands is decided by the
      // view builder from `created_at`, not silently here. The actor's name
      // arrives in the row itself, snapshotted definer-side when the answer
      // was written, so no profiles read happens here -- a session cannot see
      // another member's profile row, and must not borrow authority to try.
      const { data: decisions, error: decisionError } = await supabase
        .from("channel_recommendation_decisions")
        .select(
          "id, recommendation_id, decision, dismissal_reason, actor_id, actor_display_name, created_at",
        )
        .eq("organization_id", organizationId)
        .in("recommendation_id", [...recommendationIds])
        .order("created_at", { ascending: false })
        .limit(MAX_RECOMMENDATION_DECISIONS);
      if (decisionError) throw new ChannelAnalysisReadError(decisionError.code ?? "unknown");

      const decisionRows = decisions ?? [];

      // One vote per actor per recommendation, and the only vote this page can
      // honestly show the reader is their own.
      const { data: feedback, error: feedbackError } = await supabase
        .from("channel_recommendation_feedback")
        .select("recommendation_id, helpful")
        .eq("organization_id", organizationId)
        .eq("actor_id", viewerId)
        .in("recommendation_id", [...recommendationIds]);
      if (feedbackError) throw new ChannelAnalysisReadError(feedbackError.code ?? "unknown");

      const citationsByRecommendation = new Map<string, string[]>();
      for (const row of citations ?? []) {
        const own = citationsByRecommendation.get(row.recommendation_id) ?? [];
        own.push(row.finding_id);
        citationsByRecommendation.set(row.recommendation_id, own);
      }
      const feedbackByRecommendation = new Map(
        (feedback ?? []).map((row) => [row.recommendation_id, row.helpful]),
      );

      // A run can be narrated more than once: a re-submission writes new rows
      // rather than overwriting, and two tellings of one run on one page would
      // read as two answers to one question. The rows arrive newest-first, so
      // the first row seen per digest is that submission's newest item -- and
      // the digest whose newest item is newest overall is the telling the page
      // shows. Ties keep the first-seen submission, deterministically.
      const newestByDigest = new Map<string, string>();
      for (const row of recommendationRows) {
        if (!newestByDigest.has(row.result_digest)) {
          newestByDigest.set(row.result_digest, row.created_at);
        }
      }
      const [displayedDigest] = [...newestByDigest.entries()].sort((left, right) =>
        right[1].localeCompare(left[1]),
      )[0];

      return recommendationRows
        .filter((row) => row.result_digest === displayedDigest)
        .map(
          (row): ChannelRecommendationRecord => ({
            id: row.id,
            analysisRunId: analysisRunId,
            channelId: row.channel_id,
            branchId: row.branch_id,
            label: row.label,
            headline: row.headline,
            detail: row.detail,
            supportedActions: toStringArray(row.supported_actions),
            limitations: toStringArray(row.limitations),
            resultDigest: row.result_digest,
            citationFindingIds: citationsByRecommendation.get(row.id) ?? [],
            decisions: decisionRows.flatMap((entry): ChannelRecommendationDecisionRecord[] =>
              entry.recommendation_id === row.id
                ? [
                    {
                      recommendationId: entry.recommendation_id,
                      decision: entry.decision,
                      reason: entry.dismissal_reason,
                      actorId: entry.actor_id,
                      actorName: entry.actor_display_name,
                      createdAt: entry.created_at,
                    },
                  ]
                : [],
            ),
            myFeedback: feedbackByRecommendation.get(row.id) ?? null,
            createdAt: row.created_at,
          }),
        );
    },

    async resolveMonthInput({ organizationId, channelId, month }) {
      const timeline = await repository.loadAnalysisMonthTimeline({
        organizationId,
        channelId,
      });
      if (timeline === null) return null;
      let bounds: { windowStart: string; windowEnd: string };
      try {
        bounds = resolveAnalysisMonth(month, timeline);
      } catch {
        // Outside the known timeline: a normal empty state for the caller,
        // not a row the database failed to return.
        return null;
      }

      const { data: orgRows, error: orgError } = await supabase
        .from("organizations")
        .select("default_timezone")
        .eq("id", organizationId)
        .limit(1);
      if (orgError) throw new ChannelAnalysisReadError(orgError.code ?? "unknown");
      const timeZone = (orgRows ?? [])[0]?.default_timezone;
      if (typeof timeZone !== "string" || timeZone.length === 0) return null;

      // The grain the month's own packages wrote, by current-row majority
      // with ties breaking finer. Packages outside the month still vote when
      // nothing declares it: an empty month inherits the channel's known
      // primary grain, and a channel with no packages at all resolves day
      // grain so the coverage detector can state that no evidence exists.
      const windows = await repository.loadEvidenceWindows({
        organizationId,
        channelId,
        limit: MAX_EVIDENCE_WINDOWS,
      });
      const overlapping = windows.filter(
        (candidate) =>
          candidate.windowStart <= bounds.windowEnd && candidate.windowEnd >= bounds.windowStart,
      );
      const pool = overlapping.length > 0 ? overlapping : windows;
      if (pool.length === 0) return { ...bounds, timeZone, grain: "day" };
      const fineness: readonly AnalysisGrain[] = ["day", "week", "month", "span"];
      const counts = new Map<AnalysisGrain, number>();
      for (const candidate of pool) {
        counts.set(
          candidate.grain,
          (counts.get(candidate.grain) ?? 0) + candidate.governedRowCount,
        );
      }
      const [grain] = [...counts.entries()].sort(
        (left, right) =>
          right[1] - left[1] || fineness.indexOf(left[0]) - fineness.indexOf(right[0]),
      )[0];
      return { ...bounds, timeZone, grain };
    },
  };
  return repository;
}
