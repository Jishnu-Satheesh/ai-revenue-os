import { describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAuthenticatedChannelAnalysisRepository } from "@/modules/analysis/infrastructure/read-repository";
import type { Database } from "@/lib/supabase/database.types";

vi.mock("server-only", () => ({}));

/**
 * The repository's own contract, exercised through a stubbed PostgREST client:
 * which tables a page load actually asks for, what it does when one run was
 * narrated more than once, and where a triage answer's name comes from.
 */

type QueryResult = { data: unknown; error: null };

function stubClient(
  results: Record<string, QueryResult>,
  options: { forbiddenTables?: string[] } = {},
) {
  const asked: string[] = [];
  const build = (table: string) => {
    asked.push(table);
    if (options.forbiddenTables?.includes(table)) {
      throw new Error(`unexpected query of ${table}`);
    }
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      limit: () => builder,
      then: (
        onFulfilled: (value: QueryResult) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) =>
        Promise.resolve(results[table] ?? { data: [], error: null }).then(onFulfilled, onRejected),
    };
    return builder;
  };
  return {
    supabase: { from: build } as unknown as SupabaseClient<Database>,
    asked,
  };
}

function recommendationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-1",
    channel_id: "channel-1",
    branch_id: "branch-1",
    label: "recommendation",
    headline: "Close the uncovered days first",
    detail: "Seventeen days carry no governed evidence.",
    supported_actions: [],
    limitations: [],
    result_digest: "d".repeat(64),
    created_at: "2026-02-01T00:05:00Z",
    ...overrides,
  };
}

function decisionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "decision-1",
    recommendation_id: "rec-1",
    decision: "dismissed",
    dismissal_reason: "Already handled.",
    actor_id: "actor-2",
    // Written by the database at answer time, resolved inside the definer.
    actor_display_name: "Omar",
    created_at: "2026-02-03T11:30:00Z",
    ...overrides,
  };
}

describe("loadRecommendationsForRun", () => {
  it("keeps only the newest telling when a run was narrated more than once", async () => {
    // Rows arrive newest-first, exactly as the real read orders them: two
    // submissions over one run -- an earlier telling (group A) and a later
    // replacement (group B) -- interleaved so grouping cannot lean on position.
    const { supabase } = stubClient({
      channel_recommendations: {
        data: [
          recommendationRow({
            id: "rec-b1",
            result_digest: "b".repeat(64),
            created_at: "2026-02-02T10:00:00Z",
          }),
          recommendationRow({
            id: "rec-b0",
            result_digest: "b".repeat(64),
            created_at: "2026-02-02T09:00:00Z",
          }),
          recommendationRow({
            id: "rec-a2",
            result_digest: "a".repeat(64),
            headline: "The earlier telling",
            created_at: "2026-02-01T09:00:00Z",
          }),
          recommendationRow({
            id: "rec-a1",
            result_digest: "a".repeat(64),
            created_at: "2026-02-01T08:00:00Z",
          }),
        ],
        error: null,
      },
    });

    const loaded = await createAuthenticatedChannelAnalysisRepository(
      supabase,
    ).loadRecommendationsForRun({
      organizationId: "org-1",
      analysisRunId: "run-1",
      viewerId: "viewer-1",
    });

    expect(loaded.map((rec) => rec.id)).toEqual(["rec-b1", "rec-b0"]);
    expect(loaded.every((rec) => rec.resultDigest === "b".repeat(64))).toBe(true);
  });

  it("names answers from the stored snapshot and asks profiles for nothing", async () => {
    const { supabase, asked } = stubClient(
      {
        channel_recommendations: { data: [recommendationRow()], error: null },
        channel_recommendation_citations: {
          data: [{ recommendation_id: "rec-1", finding_id: "finding-1" }],
          error: null,
        },
        channel_recommendation_decisions: {
          data: [
            decisionRow(),
            decisionRow({
              id: "decision-0",
              decision: "acknowledged",
              dismissal_reason: null,
              actor_id: "actor-1",
              actor_display_name: "Dana",
              created_at: "2026-02-02T09:00:00Z",
            }),
          ],
          error: null,
        },
        channel_recommendation_feedback: {
          data: [{ recommendation_id: "rec-1", helpful: true }],
          error: null,
        },
      },
      // A session cannot read another member's profile row, so a page load has
      // no business knocking on that door at all.
      { forbiddenTables: ["profiles"] },
    );

    const loaded = await createAuthenticatedChannelAnalysisRepository(
      supabase,
    ).loadRecommendationsForRun({
      organizationId: "org-1",
      analysisRunId: "run-1",
      viewerId: "viewer-1",
    });

    expect(asked).not.toContain("profiles");
    expect(loaded[0].citationFindingIds).toEqual(["finding-1"]);
    // Every answer travels newest-first; each one's name now comes with the
    // row instead of being re-resolved at read time.
    expect(loaded[0].decisions.map((entry) => [entry.decision, entry.actorName])).toEqual([
      ["dismissed", "Omar"],
      ["acknowledged", "Dana"],
    ]);
    expect(loaded[0].myFeedback).toBe(true);
  });

  it("returns nothing at all when the run was never narrated", async () => {
    const { supabase } = stubClient({
      channel_recommendations: { data: [], error: null },
    });

    const loaded = await createAuthenticatedChannelAnalysisRepository(
      supabase,
    ).loadRecommendationsForRun({
      organizationId: "org-1",
      analysisRunId: "run-1",
      viewerId: "viewer-1",
    });

    expect(loaded).toEqual([]);
  });
});

describe("loadEvidence", () => {
  it("loads cited metric display details in bounded PostgREST batches", async () => {
    const evidenceRows = Array.from({ length: 401 }, (_, index) => ({
      finding_id: "finding-1",
      evidence_kind: "normalized_metric",
      evidence_role: index % 2 === 0 ? "component" : "denominator",
      normalized_metric_id: `metric-${index}`,
      exact_range_metric_observation_id: null,
      reconciliation_id: null,
      projection_run_id: null,
    }));
    const metricBatches: string[][] = [];

    const supabase = {
      from(table: string) {
        let ids: readonly string[] = [];
        const builder = {
          select: () => builder,
          eq: () => builder,
          in: (_column: string, values: readonly string[]) => {
            ids = values;
            return builder;
          },
          limit: () => builder,
          then: (
            onFulfilled: (value: QueryResult) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) => {
            const result: QueryResult =
              table === "channel_finding_evidence"
                ? { data: evidenceRows, error: null }
                : table === "normalized_metrics"
                  ? (() => {
                      metricBatches.push([...ids]);
                      return {
                        data: ids.map((id, index) => ({
                          id,
                          period_start: "2026-01-05T20:00:00.000Z",
                          period_end: "2026-01-06T20:00:00.000Z",
                          period_timezone: "Asia/Dubai",
                          value_kind: "count",
                          value_numerator: index === 0 ? "355.6" : "720",
                          dimensions: { reason_code: "CHECK_IN_REQUIRED" },
                        })),
                        error: null,
                      };
                    })()
                  : { data: [], error: null };
            return Promise.resolve(result).then(onFulfilled, onRejected);
          },
        };
        return builder;
      },
    } as unknown as SupabaseClient<Database>;

    const loaded = await createAuthenticatedChannelAnalysisRepository(supabase).loadEvidence({
      organizationId: "org-1",
      findingIds: ["finding-1"],
    });

    expect(metricBatches.map((batch) => batch.length)).toEqual([200, 200, 1]);
    expect(
      (
        loaded[0] as unknown as {
          metric: {
            periodStart: string;
            periodEnd: string;
            numerator: number;
            dimensions: Record<string, string>;
          };
        }
      ).metric,
    ).toEqual({
      periodStart: "2026-01-06",
      periodEnd: "2026-01-06",
      numerator: 355.6,
      dimensions: { reason_code: "CHECK_IN_REQUIRED" },
    });
  });
});

describe("loadEvidenceWindows", () => {
  it("reads current projected metrics in gateway-safe batches", async () => {
    // A complete report can produce hundreds of governed rows. Sending every
    // UUID in one PostgREST `in` filter exceeds the gateway request-line limit
    // before RLS or the database can answer it.
    const metricIds = Array.from({ length: 401 }, (_, index) => `metric-${index}`);
    const metricBatches: string[][] = [];
    const supabase = {
      from(table: string) {
        let ids: readonly string[] = [];
        const builder = {
          select: () => builder,
          eq: () => builder,
          is: () => builder,
          not: () => builder,
          in: (_column: string, values: readonly string[]) => {
            ids = values;
            return builder;
          },
          order: () => builder,
          limit: () => builder,
          then: (
            onFulfilled: (value: QueryResult) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) => {
            const result: QueryResult =
              table === "integration_report_packages"
                ? {
                    data: [
                      {
                        id: "package-1",
                        channel_id: "channel-1",
                        branch_id: "branch-1",
                        declared_period_start: "2026-01-01",
                        declared_period_end: "2026-01-31",
                        period_timezone: "Asia/Dubai",
                        original_filename: "January.xlsx",
                        uploaded_at: "2026-02-01T00:00:00Z",
                      },
                    ],
                    error: null,
                  }
                : table === "integration_report_projection_runs"
                  ? { data: [{ id: "run-1", report_package_id: "package-1" }], error: null }
                  : table === "report_projection_lineage"
                    ? {
                        data: metricIds.map((normalizedMetricId) => ({
                          normalized_metric_id: normalizedMetricId,
                          projection_run_id: "run-1",
                        })),
                        error: null,
                      }
                    : table === "normalized_metrics"
                      ? (() => {
                          metricBatches.push([...ids]);
                          return {
                            data: ids.map((id) => ({ id, period_grain: "day" })),
                            error: null,
                          };
                        })()
                      : { data: [], error: null };
            return Promise.resolve(result).then(onFulfilled, onRejected);
          },
        };
        return builder;
      },
    } as unknown as SupabaseClient<Database>;

    const windows = await createAuthenticatedChannelAnalysisRepository(supabase).loadEvidenceWindows({
      organizationId: "org-1",
      channelId: "channel-1",
      limit: 24,
    });

    expect(metricBatches.map((batch) => batch.length)).toEqual([200, 200, 1]);
    expect(windows).toMatchObject([{ packageId: "package-1", governedRowCount: 401, grain: "day" }]);
  });
});
