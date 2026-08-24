import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { addLocalDays } from "@/domain/analysis/calendar";
import type {
  AnalysisHeldEvidence,
  AnalysisProjectionRun,
  AnalysisSeriesPoint,
  AnalysisWindow,
} from "@/domain/analysis/types";
import type { Database } from "@/lib/supabase/database.types";
import type {
  GovernedMetricObservation,
  GovernedMetricWindowPort,
} from "@/modules/metrics/application/ports";
import type { ChannelAnalysisEvidenceLoad } from "@/workflows/analysis/run-channel-analysis";

/**
 * Everything a detector is allowed to see, gathered under the worker's lease.
 *
 * Three separate questions, kept separate on purpose:
 *
 *  - what current governed evidence exists in the window;
 *  - which import wrote each period, and what that import said about its own
 *    blanks;
 *  - what is being held back from every rollup while an owner decides.
 *
 * The third never becomes the first. Held evidence is named through the
 * reconciliation record that holds it, so a detector can report that a decision
 * is outstanding without quoting a figure nobody has accepted.
 */

type AnalysisClient = SupabaseClient<Database>;

/** Bounds every read. A run that would exceed one is a failure, not a shorter answer. */
const MAX_LINEAGE_ROWS = 10_000;
const MAX_HELD_ROWS = 2_000;
const MAX_RECONCILIATION_ROWS = 5_000;

/**
 * How far back a held period may start and still overlap the window. A held
 * monthly total covering the second half of January starts on the first, which
 * is outside a window that opens on the fifteenth.
 */
const HELD_LOOKBACK_DAYS = 31;

export class ChannelAnalysisEvidenceError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "ChannelAnalysisEvidenceError";
  }
}

function assertNotTruncated(rows: readonly unknown[], limit: number, what: string): void {
  if (rows.length >= limit)
    throw new ChannelAnalysisEvidenceError(`${what} exceeded its row budget`);
}

function overlapsWindow(window: AnalysisWindow, start: string, end: string): boolean {
  return start <= window.windowEnd && end >= window.windowStart;
}

export function createChannelAnalysisEvidenceRepository(
  supabase: AnalysisClient,
  metrics: GovernedMetricWindowPort,
): {
  load(input: {
    window: AnalysisWindow;
    metricKeys: readonly string[];
  }): Promise<ChannelAnalysisEvidenceLoad>;
} {
  return {
    async load({ window, metricKeys }) {
      const current = await metrics.loadGovernedWindow({
        organizationId: window.organizationId,
        metricKeys,
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
        timeZone: window.timeZone,
        channelId: window.channelId,
        branchId: window.branchId,
      });

      const lineage = await loadLineage(supabase, window.organizationId, current);
      const projectionRuns = await loadProjectionRuns(supabase, window.organizationId, lineage);

      const points: AnalysisSeriesPoint[] = current.map((observation) => ({
        normalizedMetricId: observation.id,
        channelId: observation.channelId,
        branchId: observation.branchId,
        metricKey: observation.metricKey,
        grain: observation.grain,
        periodStart: observation.periodStartDate,
        periodEnd: observation.periodEndDate,
        periodTimezone: observation.periodTimezone,
        valueKind: observation.valueKind,
        numerator: observation.numerator,
        currency: observation.currency,
        qualityTier: observation.qualityTier,
        projectionRunId: lineage.get(observation.id) ?? null,
        // The provider's own labels ride beside the figure they describe, so a
        // detector can group by them without a second read (ADR 0034).
        dimensions: observation.dimensions,
      }));

      return {
        points,
        // The loader hands over exactly the rows it found in the window; a row
        // that cannot be compared is set aside by the detector, which is the
        // only place that knows what comparability means for its own question.
        incomparablePointCount: 0,
        projectionRuns,
        heldEvidence: await loadHeldEvidence(supabase, metrics, window, metricKeys),
      };
    },
  };
}

/** Which governed projection run wrote each period. */
async function loadLineage(
  supabase: AnalysisClient,
  organizationId: string,
  observations: readonly GovernedMetricObservation[],
): Promise<Map<string, string>> {
  const byMetricId = new Map<string, string>();
  if (observations.length === 0) return byMetricId;

  const { data, error } = await supabase
    .from("report_projection_lineage")
    .select("normalized_metric_id, projection_run_id")
    .eq("organization_id", organizationId)
    .in(
      "normalized_metric_id",
      observations.map((observation) => observation.id),
    )
    .limit(MAX_LINEAGE_ROWS);

  if (error) throw new ChannelAnalysisEvidenceError(error.code ?? "lineage read failed");
  assertNotTruncated(data ?? [], MAX_LINEAGE_ROWS, "projection lineage");

  for (const row of data ?? []) {
    if (row.normalized_metric_id) byMetricId.set(row.normalized_metric_id, row.projection_run_id);
  }
  return byMetricId;
}

/** What each contributing import recorded about its own blank rows. */
async function loadProjectionRuns(
  supabase: AnalysisClient,
  organizationId: string,
  lineage: Map<string, string>,
): Promise<AnalysisProjectionRun[]> {
  const runIds = [...new Set(lineage.values())];
  if (runIds.length === 0) return [];

  const { data, error } = await supabase
    .from("integration_report_projection_runs")
    .select("id, absent_row_count")
    .eq("organization_id", organizationId)
    .in("id", runIds);

  if (error) throw new ChannelAnalysisEvidenceError(error.code ?? "projection run read failed");

  return (data ?? []).map((row) => ({
    projectionRunId: row.id,
    absentRowCount: row.absent_row_count,
  }));
}

type HeldLedgerRow = {
  ledger: "period_grain" | "exact_range";
  id: string;
  channelId: string | null;
  branchId: string | null;
  periodStart: string;
  periodEnd: string;
};

/**
 * Evidence held for a decision, named by the record that holds it.
 *
 * One held figure produces one reconciliation row per prior it collided with --
 * a month laid over thirty-one days files thirty-one decisions -- so the rows
 * are grouped back to the figure they are about. An operator resolving that one
 * decision sets aside every day it covered, and reporting thirty-one waiting
 * decisions would misdescribe one waiting question as thirty-one.
 */
async function loadHeldEvidence(
  supabase: AnalysisClient,
  metrics: GovernedMetricWindowPort,
  window: AnalysisWindow,
  metricKeys: readonly string[],
): Promise<AnalysisHeldEvidence[]> {
  const heldSeries = (
    await metrics.loadGovernedWindow({
      organizationId: window.organizationId,
      metricKeys,
      // A held period may begin before the window and still cover part of it.
      windowStart: addLocalDays(window.windowStart, -HELD_LOOKBACK_DAYS),
      windowEnd: window.windowEnd,
      timeZone: window.timeZone,
      channelId: window.channelId,
      branchId: window.branchId,
      reconciliationState: "blocked_overlap",
    })
  ).filter((observation) =>
    overlapsWindow(window, observation.periodStartDate, observation.periodEndDate),
  );

  let exactRangeRequest = supabase
    .from("exact_range_metric_observations")
    .select("id, channel_id, branch_id, period_start, period_end")
    .eq("organization_id", window.organizationId)
    .eq("reconciliation_state", "blocked_overlap")
    .lte("period_start", window.windowEnd)
    .gte("period_end", window.windowStart)
    .limit(MAX_HELD_ROWS);
  if (window.channelId) exactRangeRequest = exactRangeRequest.eq("channel_id", window.channelId);
  if (window.branchId) exactRangeRequest = exactRangeRequest.eq("branch_id", window.branchId);

  const { data: exactRange, error: exactRangeError } = await exactRangeRequest;
  if (exactRangeError)
    throw new ChannelAnalysisEvidenceError(exactRangeError.code ?? "held exact range read failed");
  assertNotTruncated(exactRange ?? [], MAX_HELD_ROWS, "held exact range evidence");

  const held: HeldLedgerRow[] = [
    ...heldSeries.map((observation) => ({
      ledger: "period_grain" as const,
      id: observation.id,
      channelId: observation.channelId,
      branchId: observation.branchId,
      periodStart: observation.periodStartDate,
      periodEnd: observation.periodEndDate,
    })),
    ...(exactRange ?? []).map((row) => ({
      ledger: "exact_range" as const,
      id: row.id,
      channelId: row.channel_id,
      branchId: row.branch_id,
      periodStart: row.period_start,
      periodEnd: row.period_end,
    })),
  ];
  if (held.length === 0) return [];

  const reconciliations = await loadReconciliations(supabase, window.organizationId, held);
  const resolved = await loadResolvedReconciliationIds(
    supabase,
    window.organizationId,
    reconciliations.map((row) => row.id),
  );

  const outstanding = new Map<string, { ids: string[]; candidateCount: number }>();
  for (const row of reconciliations) {
    if (resolved.has(row.id)) continue;
    const key = row.heldLedgerId;
    const entry = outstanding.get(key) ?? { ids: [], candidateCount: 0 };
    entry.ids.push(row.id);
    entry.candidateCount += 1;
    outstanding.set(key, entry);
  }

  return held
    .filter((row) => outstanding.has(row.id))
    .map((row) => {
      const entry = outstanding.get(row.id) as { ids: string[]; candidateCount: number };
      return {
        // The record an operator acts on. The resolution sets aside every prior
        // the held figure collided with, so one of them is the whole decision.
        reconciliationId: [...entry.ids].sort()[0],
        projectionTarget: row.ledger,
        channelId: row.channelId,
        branchId: row.branchId,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        candidateCount: entry.candidateCount,
      };
    });
}

type ReconciliationRow = { id: string; heldLedgerId: string };

async function loadReconciliations(
  supabase: AnalysisClient,
  organizationId: string,
  held: readonly HeldLedgerRow[],
): Promise<ReconciliationRow[]> {
  const rows: ReconciliationRow[] = [];

  // Two reads rather than one `or`, because both ledgers reference this table
  // twice -- once as the prior and once as the result -- and a filter written
  // across both columns at once reads as though either side would do.
  for (const [column, ledger] of [
    ["result_normalized_metric_id", "period_grain"],
    ["result_observation_id", "exact_range"],
  ] as const) {
    const ids = held.filter((row) => row.ledger === ledger).map((row) => row.id);
    if (ids.length === 0) continue;

    const { data, error } = await supabase
      .from("report_projection_reconciliations")
      .select(`id, ${column}`)
      .eq("organization_id", organizationId)
      .eq("classification", "ambiguous_overlap")
      .in(column, ids)
      .limit(MAX_RECONCILIATION_ROWS);

    if (error) throw new ChannelAnalysisEvidenceError(error.code ?? "reconciliation read failed");
    assertNotTruncated(data ?? [], MAX_RECONCILIATION_ROWS, "reconciliation records");

    for (const row of (data ?? []) as Array<Record<string, string | null>>) {
      const heldLedgerId = row[column];
      if (typeof row.id === "string" && typeof heldLedgerId === "string") {
        rows.push({ id: row.id, heldLedgerId });
      }
    }
  }

  return rows;
}

async function loadResolvedReconciliationIds(
  supabase: AnalysisClient,
  organizationId: string,
  reconciliationIds: readonly string[],
): Promise<Set<string>> {
  if (reconciliationIds.length === 0) return new Set();

  const { data, error } = await supabase
    .from("report_projection_reconciliation_resolutions")
    .select("reconciliation_id")
    .eq("organization_id", organizationId)
    .in("reconciliation_id", [...reconciliationIds]);

  if (error) throw new ChannelAnalysisEvidenceError(error.code ?? "resolution read failed");
  return new Set((data ?? []).map((row) => row.reconciliation_id));
}
