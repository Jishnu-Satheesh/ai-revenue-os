import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { AnalysisGrain, DetectorSeverity, FindingKind } from "@/domain/analysis/types";
import { toCalendarDate } from "@/domain/metrics/periods";
import type { Database } from "@/lib/supabase/database.types";
import type {
  ChannelAnalysisReadPort,
  ChannelAnalysisRunRecord,
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

export function createAuthenticatedChannelAnalysisRepository(
  supabase: AnalysisClient,
): ChannelAnalysisReadPort {
  return {
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
        .select(
          "id, analysis_run_id, channel_id, branch_id, detector_key, detector_version, kind, code, severity, priority, metric_key, period_start, period_end, value_kind, value_numerator, value_denominator, currency, monetary_impact_minor_units, expected_period_count, observed_period_count, absent_period_count, quality_state, needs_data_reason, limitations, calculation_digest, created_at",
        )
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

      return (data ?? []).map(
        (row): ChannelFindingRecord => ({
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
        }),
      );
    },

    async loadEvidenceWindows({ organizationId, channelId, limit }) {
      // Packages first: the declared window lives here, and it is the window an
      // analysis must use. Deriving one from the evidence instead would move
      // the edges inward onto the first and last day that happen to carry a
      // figure, and a window cannot report a gap at its own edge.
      const { data: packages, error: packageError } = await supabase
        .from("integration_report_packages")
        .select(
          "id, channel_id, branch_id, declared_period_start, declared_period_end, period_timezone, original_filename, uploaded_at",
        )
        .eq("organization_id", organizationId)
        .eq("channel_id", channelId)
        .eq("status", "projected")
        .not("declared_period_start", "is", null)
        .not("declared_period_end", "is", null)
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
        .select("projection_run_id, normalized_metric_id")
        .eq("organization_id", organizationId)
        .in("projection_run_id", [...packageByRun.keys()])
        .limit(MAX_LINEAGE);
      if (lineageError) throw new ChannelAnalysisReadError(lineageError.code ?? "unknown");

      const runByMetricId = new Map<string, string>();
      for (const row of lineage ?? []) {
        if (row.normalized_metric_id)
          runByMetricId.set(row.normalized_metric_id, row.projection_run_id);
      }
      if (runByMetricId.size === 0) return [];

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

      return packageRows.flatMap((row): ChannelEvidenceWindow[] => {
        const byGrain = grainCounts.get(row.id);
        if (!byGrain || byGrain.size === 0) return [];
        const [grain, count] = [...byGrain.entries()].sort(
          (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
        )[0];
        // A grain the analysis registry cannot bind is not a window to offer.
        if (grain !== "day" && grain !== "week" && grain !== "month") return [];
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
  };
}
