import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isWindowCovered, mergeCoverageSegments } from "@/domain/analysis/window-selection";
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
  RecommendationViewerState,
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
/**
 * A picker an operator can read, not every package they ever uploaded.
 *
 * Exported rather than repeated at the call site that caps its own read, so
 * the page and the resolver cannot drift apart.
 */
export const MAX_EVIDENCE_WINDOWS = 24;
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
 * Every code the business-performance card reads for one window: the money
 * band, the funnel window sums (orders placed, menu views), the cancellation
 * share of orders, and cost-context presence. One row per code per run, except
 * the funnel detector, which writes one row per stage pair (three).
 */
const CARD_CODES = [
  "WINDOW_GROSS_REVENUE",
  "ORDER_CANCELLATION_LOSS",
  "FUNNEL_STAGE_CONVERSION",
  "ORDER_CANCELLATION_ATTRIBUTION_SHARE_OF_ORDERS",
  "CHANNEL_COST_LOAD_OF_REVENUE",
  "COMPANY_COST_STRUCTURE_OF_REVENUE",
] as const;
/**
 * The most finding rows one run can contribute to the card read: one per code
 * above, with the funnel detector's three stage pairs counted separately.
 */
const MAX_CARD_FINDINGS_PER_RUN = 10;
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

/**
 * The newest completed run per channel for exactly one declared window.
 *
 * Newest first, so the first run seen for a channel is the one that stands. A
 * channel re-analysed over the same window has two completed runs, and the
 * later answer is the current one. Shared by the money band and the card read
 * so the two can never resolve "the run for this window" differently.
 */
async function loadLatestRunIdsByChannel(
  supabase: AnalysisClient,
  input: {
    organizationId: string;
    windowStart: string;
    windowEnd: string;
    grain: AnalysisGrain;
  },
): Promise<Map<string, string>> {
  const { data: runs, error: runError } = await supabase
    .from("channel_analysis_runs")
    .select("id, channel_id, completed_at")
    .eq("organization_id", input.organizationId)
    .eq("window_start", input.windowStart)
    .eq("window_end", input.windowEnd)
    .eq("period_grain", input.grain)
    .eq("status", "completed")
    .not("channel_id", "is", null)
    .order("completed_at", { ascending: false })
    .limit(MAX_CHANNEL_BAND_RUNS);
  if (runError) throw new ChannelAnalysisReadError(runError.code ?? "unknown");

  const latestByChannel = new Map<string, string>();
  for (const row of runs ?? []) {
    const channelId = row.channel_id as string;
    if (!latestByChannel.has(channelId)) latestByChannel.set(channelId, row.id);
  }
  return latestByChannel;
}

/**
 * Open findings for a set of runs, restricted to an allowlist of codes.
 *
 * A superseded finding is the answer a later run replaced. Two figures for
 * one question on one page is worse than one figure -- the same reason
 * loadFindingsForRun filters to open findings. Batched because PostgREST folds
 * an `.in()` filter's values into the request line, and one filter naming
 * every run id can exceed a common gateway's request-line limit before RLS or
 * the database ever sees the query.
 */
async function loadOpenFindingsForRuns(
  supabase: AnalysisClient,
  input: {
    organizationId: string;
    runIds: readonly string[];
    codes: readonly string[];
    maxPerRun: number;
    boundErrorCode: string;
  },
): Promise<Map<string, ChannelFindingRecord[]>> {
  const byRun = new Map<string, ChannelFindingRecord[]>();
  for (let offset = 0; offset < input.runIds.length; offset += EVIDENCE_METRIC_BATCH_SIZE) {
    const batch = input.runIds.slice(offset, offset + EVIDENCE_METRIC_BATCH_SIZE);
    const { data, error: findingError } = await supabase
      .from("channel_findings")
      .select(CHANNEL_FINDING_COLUMNS)
      .eq("organization_id", input.organizationId)
      .in("analysis_run_id", [...batch])
      .in("code", [...input.codes])
      .eq("status", "open")
      .limit(batch.length * input.maxPerRun + 1);
    if (findingError) throw new ChannelAnalysisReadError(findingError.code ?? "unknown");
    if ((data ?? []).length > batch.length * input.maxPerRun)
      throw new ChannelAnalysisReadError(input.boundErrorCode);

    for (const row of data ?? []) {
      const mapped = toFindingRecord(row);
      const group = byRun.get(mapped.analysisRunId) ?? [];
      group.push(mapped);
      byRun.set(mapped.analysisRunId, group);
    }
  }
  return byRun;
}

/** The columns a run record is built from, named once so the list a single
 *  run is read with cannot drift from the list the page's list is read with. */
const CHANNEL_RUN_COLUMNS =
  "id, channel_id, branch_id, window_start, window_end, period_grain, window_timezone, registry_version, detector_versions, result_digest, status, finding_count, observation_count, needs_data_count, safe_failure_code, started_at, completed_at";

type ChannelAnalysisRunRow = Pick<
  Database["public"]["Tables"]["channel_analysis_runs"]["Row"],
  | "id"
  | "channel_id"
  | "branch_id"
  | "window_start"
  | "window_end"
  | "period_grain"
  | "window_timezone"
  | "registry_version"
  | "detector_versions"
  | "result_digest"
  | "status"
  | "finding_count"
  | "observation_count"
  | "needs_data_count"
  | "safe_failure_code"
  | "started_at"
  | "completed_at"
>;

/**
 * The per-viewer layer over a run's narration, read as one unit.
 *
 * Decisions and feedback travel together because they share a fate: neither
 * may enter the run cache, and both are merged back onto a cached payload by
 * the page. Reading them here, once, keeps the two callers that need them --
 * the full read below and the standalone viewer-state port -- from drifting
 * apart about what "a viewer's state" contains.
 */
async function readViewerState(
  supabase: AnalysisClient,
  input: {
    organizationId: string;
    recommendationIds: readonly string[];
    viewerId: string;
  },
): Promise<{
  decisionsById: Map<string, ChannelRecommendationDecisionRecord[]>;
  feedbackById: Map<string, boolean>;
}> {
  // Every triage answer ever recorded; which one stands is decided by the
  // view builder from `created_at`, not silently here. The actor's name
  // arrives in the row itself, snapshotted definer-side when the answer
  // was written, so no profiles read happens here -- a session cannot see
  // another member's profile row, and must not borrow authority to try.
  const { data: decisions, error: decisionError } = await supabase
    .from("channel_recommendation_decisions")
    .select(
      "id, recommendation_id, decision, dismissal_reason, snoozed_until, actor_id, actor_display_name, created_at",
    )
    .eq("organization_id", input.organizationId)
    .in("recommendation_id", [...input.recommendationIds])
    .order("created_at", { ascending: false })
    .limit(MAX_RECOMMENDATION_DECISIONS);
  if (decisionError) throw new ChannelAnalysisReadError(decisionError.code ?? "unknown");

  // One vote per actor per recommendation, and the only vote a page can
  // honestly show the reader is their own.
  const { data: feedback, error: feedbackError } = await supabase
    .from("channel_recommendation_feedback")
    .select("recommendation_id, helpful")
    .eq("organization_id", input.organizationId)
    .eq("actor_id", input.viewerId)
    .in("recommendation_id", [...input.recommendationIds]);
  if (feedbackError) throw new ChannelAnalysisReadError(feedbackError.code ?? "unknown");

  const decisionsById = new Map<string, ChannelRecommendationDecisionRecord[]>();
  for (const entry of decisions ?? []) {
    const own = decisionsById.get(entry.recommendation_id) ?? [];
    own.push({
      recommendationId: entry.recommendation_id,
      decision: entry.decision,
      reason: entry.dismissal_reason,
      snoozedUntil:
        entry.snoozed_until === null || entry.snoozed_until === undefined
          ? null
          : String(entry.snoozed_until),
      actorId: entry.actor_id,
      actorName: entry.actor_display_name,
      createdAt: entry.created_at,
    });
    decisionsById.set(entry.recommendation_id, own);
  }
  const feedbackById = new Map((feedback ?? []).map((row) => [row.recommendation_id, row.helpful]));

  return { decisionsById, feedbackById };
}

function toRunRecord(row: ChannelAnalysisRunRow): ChannelAnalysisRunRecord {
  return {
    id: row.id,
    channelId: row.channel_id,
    branchId: row.branch_id,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    periodGrain: row.period_grain as AnalysisGrain,
    windowTimezone: row.window_timezone,
    registryVersion: row.registry_version,
    detectorVersions: toDetectorVersions(row.detector_versions),
    resultDigest: row.result_digest,
    status: row.status,
    findingCount: row.finding_count,
    observationCount: row.observation_count,
    needsDataCount: row.needs_data_count,
    safeFailureCode: row.safe_failure_code,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export function createAuthenticatedChannelAnalysisRepository(
  supabase: AnalysisClient,
): ChannelAnalysisReadPort {
  const repository: ChannelAnalysisReadPort = {
    async loadRuns({ organizationId, channelId, limit }) {
      const { data, error } = await supabase
        .from("channel_analysis_runs")
        .select(CHANNEL_RUN_COLUMNS)
        .eq("organization_id", organizationId)
        .eq("channel_id", channelId)
        .order("started_at", { ascending: false })
        .limit(Math.min(limit, MAX_RUNS));

      if (error) throw new ChannelAnalysisReadError(error.code ?? "unknown");

      return (data ?? []).map(toRunRecord);
    },

    async loadRun({ organizationId, channelId, analysisRunId }) {
      // Named rather than found in `loadRuns`: that list is capped at what a
      // page shows, so a run past the cap would read as absent to anyone
      // acting on it. The channel filter travels here for the same reason it
      // travels there -- a run of another channel must read as absent, not as
      // a refusal that names which channel it belongs to.
      const { data, error } = await supabase
        .from("channel_analysis_runs")
        .select(CHANNEL_RUN_COLUMNS)
        .eq("organization_id", organizationId)
        .eq("channel_id", channelId)
        .eq("id", analysisRunId)
        .maybeSingle();

      if (error) throw new ChannelAnalysisReadError(error.code ?? "unknown");

      return data ? toRunRecord(data) : null;
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
      const latestByChannel = await loadLatestRunIdsByChannel(supabase, {
        organizationId,
        windowStart,
        windowEnd,
        grain,
      });
      if (latestByChannel.size === 0) return [];

      // Each detector writes at most one open finding per code per run, so
      // two band codes read means at most two rows per run id in the batch.
      const byRun = await loadOpenFindingsForRuns(supabase, {
        organizationId,
        runIds: [...latestByChannel.values()],
        codes: [...BAND_CODES],
        maxPerRun: BAND_CODES.length,
        boundErrorCode: "BAND_FINDINGS_NOT_BOUNDED",
      });

      return [...latestByChannel.entries()].map(
        ([channelId, analysisRunId]): ChannelBandRecord => ({
          channelId,
          analysisRunId,
          findings: byRun.get(analysisRunId) ?? [],
        }),
      );
    },

    async loadChannelCardFindingsForWindow({ organizationId, windowStart, windowEnd, grain }) {
      const latestByChannel = await loadLatestRunIdsByChannel(supabase, {
        organizationId,
        windowStart,
        windowEnd,
        grain,
      });
      if (latestByChannel.size === 0) return [];

      const byRun = await loadOpenFindingsForRuns(supabase, {
        organizationId,
        runIds: [...latestByChannel.values()],
        codes: [...CARD_CODES],
        maxPerRun: MAX_CARD_FINDINGS_PER_RUN,
        boundErrorCode: "CARD_FINDINGS_NOT_BOUNDED",
      });

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

    async loadCoverageSegments({ organizationId, channelId }) {
      const base = supabase
        .from("integration_report_packages")
        .select("declared_period_start, declared_period_end")
        .eq("organization_id", organizationId)
        .eq("status", "projected")
        .not("declared_period_start", "is", null)
        .not("declared_period_end", "is", null);
      const { data, error } = await (channelId === null ? base : base.eq("channel_id", channelId))
        .order("declared_period_start", { ascending: true })
        .limit(MAX_EVIDENCE_WINDOWS);
      if (error) throw new ChannelAnalysisReadError(error.code ?? "unknown");

      return mergeCoverageSegments(
        (data ?? []).flatMap((row) =>
          typeof row.declared_period_start === "string" &&
          typeof row.declared_period_end === "string"
            ? [{ windowStart: row.declared_period_start, windowEnd: row.declared_period_end }]
            : [],
        ),
      );
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

      // A null viewer asks for the shareable text alone: the run cache holds
      // this payload under the run id, where any viewer's decisions would
      // leak to every other operator who opens the same range. The page reads
      // the viewer's own layer separately and merges it back before display.
      const { decisionsById, feedbackById } =
        viewerId === null
          ? {
              decisionsById: new Map<string, ChannelRecommendationDecisionRecord[]>(),
              feedbackById: new Map<string, boolean>(),
            }
          : await readViewerState(supabase, { organizationId, recommendationIds, viewerId });

      const citationsByRecommendation = new Map<string, string[]>();
      for (const row of citations ?? []) {
        const own = citationsByRecommendation.get(row.recommendation_id) ?? [];
        own.push(row.finding_id);
        citationsByRecommendation.set(row.recommendation_id, own);
      }

      // A run can be narrated twice: the first narration plus one gap-fill
      // that cites only previously-uncited findings (Amendment C, ADR 0053).
      // The fence guarantees the two tellings cite disjoint findings, so both
      // show: hiding the first telling behind the second would un-advise
      // chapters the gap-fill never touched. Rows arrive newest-first, so the
      // newest telling is kept whole; an older-telling item survives only
      // when it cites something no newer telling cites — a newer telling
      // that re-cites a finding replaces the older words about it. Items
      // without citations carry no receipt and stay with their own telling.
      const newestByDigest = new Map<string, string>();
      for (const row of recommendationRows) {
        if (!newestByDigest.has(row.result_digest)) {
          newestByDigest.set(row.result_digest, row.created_at);
        }
      }
      const digestOrder = new Map(
        [...newestByDigest.entries()]
          .sort((left, right) => right[1].localeCompare(left[1]))
          .map(([digest], index) => [digest, index]),
      );
      // One pass, newest first: the keep decision for an older item must see
      // every newer telling's citations, so filtering and accumulating cannot
      // be split across two passes.
      const citedByNewer = new Set<string>();
      const displayed: typeof recommendationRows = [];
      for (const row of recommendationRows) {
        const citations = citationsByRecommendation.get(row.id) ?? [];
        if (digestOrder.get(row.result_digest) !== 0) {
          if (citations.length === 0) continue;
          if (!citations.some((findingId) => !citedByNewer.has(findingId))) continue;
        }
        displayed.push(row);
        for (const findingId of citations) citedByNewer.add(findingId);
      }

      return displayed.map(
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
          decisions: decisionsById.get(row.id) ?? [],
          myFeedback: feedbackById.get(row.id) ?? null,
          createdAt: row.created_at,
        }),
      );
    },

    async loadRecommendationViewerState({ organizationId, analysisRunId, viewerId }) {
      // The ids first, because the decisions table names no run: without them
      // this read cannot tell one run's answers from another's, and answering
      // with another run's triage state would be the same defect as showing
      // another window's figures.
      const { data: rows, error } = await supabase
        .from("channel_recommendations")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("analysis_run_id", analysisRunId)
        .limit(MAX_RECOMMENDATIONS);
      if (error) throw new ChannelAnalysisReadError(error.code ?? "unknown");

      const recommendationIds = (rows ?? []).map((row) => row.id);
      if (recommendationIds.length === 0) return [];

      const { decisionsById, feedbackById } = await readViewerState(supabase, {
        organizationId,
        recommendationIds,
        viewerId,
      });
      return recommendationIds.map(
        (recommendationId): RecommendationViewerState => ({
          recommendationId,
          decisions: decisionsById.get(recommendationId) ?? [],
          myFeedback: feedbackById.get(recommendationId) ?? null,
        }),
      );
    },

    async resolveWindowInput({ organizationId, channelId, from, to }) {
      const segments = await repository.loadCoverageSegments({ organizationId, channelId });
      // The first of the two independent checks. The worker repeats it under
      // its lease, so a range that became uncovered between this read and the
      // claim is still refused.
      if (!isWindowCovered(from, to, segments)) return null;
      const bounds = { windowStart: from, windowEnd: to };

      const { data: orgRows, error: orgError } = await supabase
        .from("organizations")
        .select("default_timezone")
        .eq("id", organizationId)
        .limit(1);
      if (orgError) throw new ChannelAnalysisReadError(orgError.code ?? "unknown");
      const timeZone = (orgRows ?? [])[0]?.default_timezone;
      if (typeof timeZone !== "string" || timeZone.length === 0) return null;

      // Unchanged from the monthly resolver: the grain the range's own packages
      // wrote, by current-row majority with ties breaking finer. Packages
      // outside the range still vote when nothing declares it.
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

    async loadRunForWindow({ organizationId, channelId, windowStart, windowEnd }) {
      // Exactly this window, via the same `(organization_id, channel_id,
      // window_start desc, created_at desc)` index `loadRuns` uses -- an
      // equality match on its leading columns, newest first if re-analysis
      // ever produced more than one run for the same declared range.
      const { data: run, error: runError } = await supabase
        .from("channel_analysis_runs")
        .select("id, status")
        .eq("organization_id", organizationId)
        .eq("channel_id", channelId)
        .eq("window_start", windowStart)
        .eq("window_end", windowEnd)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (runError) throw new ChannelAnalysisReadError(runError.code ?? "unknown");
      if (!run) return null;

      // The narrator is a second fenced worker that writes rows here only
      // after the run above is `completed` (ADR 0037), so a `completed` run
      // with zero rows is still waiting on it, not finished.
      const { count, error: countError } = await supabase
        .from("channel_recommendations")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("analysis_run_id", run.id);
      if (countError) throw new ChannelAnalysisReadError(countError.code ?? "unknown");

      return { id: run.id, status: run.status, recommendationCount: count ?? 0 };
    },
  };
  return repository;
}
