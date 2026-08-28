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

const ORGANIZATION = "org-1";

/**
 * Records every `.from(table)` call and the `eq` filters chained onto it, so
 * a test can assert what one query actually asked for without threading a
 * bespoke stub through every method. `dataByTable` supplies the rows each
 * table should answer with; a table not named there answers empty.
 */
function supabaseStub(dataByTable: Record<string, unknown[]> = {}) {
  const queries: { table: string; filters: [string, unknown][] }[] = [];
  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    queries.push({ table, filters });
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return builder;
      },
      not: () => builder,
      in: () => builder,
      order: () => builder,
      limit: () => builder,
      then: (
        onFulfilled: (value: QueryResult) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) =>
        Promise.resolve({ data: dataByTable[table] ?? [], error: null } as QueryResult).then(
          onFulfilled,
          onRejected,
        ),
    };
    return builder;
  };
  return { from, queries } as unknown as SupabaseClient<Database> & { queries: typeof queries };
}

describe("loadChannelBandsForWindow", () => {
  it("reads the latest completed run per channel for one declared window", async () => {
    const supabase = supabaseStub();
    const repository = createAuthenticatedChannelAnalysisRepository(supabase);

    await repository.loadChannelBandsForWindow({
      organizationId: ORGANIZATION,
      windowStart: "2026-01-01",
      windowEnd: "2026-02-28",
      grain: "day",
    });

    const runsQuery = supabase.queries.find((query) => query.table === "channel_analysis_runs");
    expect(runsQuery).toBeDefined();
    // Scoped to the tenant, to the exact declared window, and to runs that
    // actually finished. A running or failed run has no figures to band.
    expect(runsQuery?.filters).toContainEqual(["organization_id", ORGANIZATION]);
    expect(runsQuery?.filters).toContainEqual(["window_start", "2026-01-01"]);
    expect(runsQuery?.filters).toContainEqual(["window_end", "2026-02-28"]);
    expect(runsQuery?.filters).toContainEqual(["period_grain", "day"]);
    expect(runsQuery?.filters).toContainEqual(["status", "completed"]);
  });

  it("batches the findings read so one window's run ids never exceed a gateway-safe filter", async () => {
    // 401 channels, each with one completed run over this window: more than
    // one gateway-safe batch, and specific enough that a bug collapsing every
    // batch into a single `.in()` filter would not be masked by a shorter list.
    const runRows = Array.from({ length: 401 }, (_, index) => ({
      id: `run-${index}`,
      channel_id: `channel-${index}`,
      completed_at: "2026-02-01T00:00:00Z",
    }));
    const findingBatches: string[][] = [];
    const supabase = {
      from(table: string) {
        let runIds: readonly string[] = [];
        const builder = {
          select: () => builder,
          eq: () => builder,
          not: () => builder,
          in: (column: string, values: readonly string[]) => {
            if (column === "analysis_run_id") runIds = values;
            return builder;
          },
          order: () => builder,
          limit: () => builder,
          then: (
            onFulfilled: (value: QueryResult) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) => {
            const result: QueryResult =
              table === "channel_analysis_runs"
                ? { data: runRows, error: null }
                : table === "channel_findings"
                  ? (() => {
                      findingBatches.push([...runIds]);
                      return { data: [], error: null };
                    })()
                  : { data: [], error: null };
            return Promise.resolve(result).then(onFulfilled, onRejected);
          },
        };
        return builder;
      },
    } as unknown as SupabaseClient<Database>;

    await createAuthenticatedChannelAnalysisRepository(supabase).loadChannelBandsForWindow({
      organizationId: ORGANIZATION,
      windowStart: "2026-01-01",
      windowEnd: "2026-02-28",
      grain: "day",
    });

    expect(findingBatches.map((batch) => batch.length)).toEqual([200, 200, 1]);
  });

  it("excludes a superseded finding a later run replaced", async () => {
    // One run carries both an open WINDOW_GROSS_REVENUE finding and the
    // superseded one a later run left behind. If this query did not filter
    // to open findings, the band would carry both -- and the organization
    // roll-up could then state a figure the channel's own page (which reads
    // through the status-filtered loadFindingsForRun) does not show.
    //
    // Unlike the other stubs in this file, this one actually applies the
    // `status` filter it was given rather than ignoring it: the point of
    // this test is that removing `.eq("status", "open")` from the
    // implementation must make it fail, not merely that the happy path
    // passes.
    const bandFindingRow = (overrides: Record<string, unknown> = {}) => ({
      id: "finding-open",
      analysis_run_id: "run-1",
      channel_id: "channel-1",
      branch_id: null,
      detector_key: "revenue-window-gross",
      detector_version: 1,
      kind: "finding",
      code: "WINDOW_GROSS_REVENUE",
      severity: null,
      priority: null,
      metric_key: "revenue.window_gross",
      period_start: "2026-01-01",
      period_end: "2026-02-28",
      value_kind: "money",
      value_numerator: 10000,
      value_denominator: null,
      currency: "AED",
      monetary_impact_minor_units: 10000,
      expected_period_count: 59,
      observed_period_count: 59,
      absent_period_count: 0,
      quality_state: "complete",
      needs_data_reason: null,
      limitations: [],
      calculation_digest: "d".repeat(64),
      created_at: "2026-03-01T00:00:00Z",
      status: "open",
      ...overrides,
    });
    const findingRows = [
      bandFindingRow({ id: "finding-open", status: "open" }),
      bandFindingRow({ id: "finding-superseded", status: "superseded" }),
    ];

    const supabase = {
      from(table: string) {
        const filters: [string, unknown][] = [];
        const builder = {
          select: () => builder,
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return builder;
          },
          not: () => builder,
          in: () => builder,
          order: () => builder,
          limit: () => builder,
          then: (
            onFulfilled: (value: QueryResult) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) => {
            let data: unknown[] = [];
            if (table === "channel_analysis_runs") {
              data = [{ id: "run-1", channel_id: "channel-1", completed_at: "2026-03-01T00:00:00Z" }];
            } else if (table === "channel_findings") {
              // Apply the status filter the way PostgREST would, so a query
              // that omits it sees every row and a query that includes it
              // sees only the matching one.
              const statusFilter = filters.find(([column]) => column === "status")?.[1];
              data = findingRows.filter(
                (row) => statusFilter === undefined || row.status === statusFilter,
              );
            }
            return Promise.resolve({ data, error: null } as QueryResult).then(
              onFulfilled,
              onRejected,
            );
          },
        };
        return builder;
      },
    } as unknown as SupabaseClient<Database>;

    const bands = await createAuthenticatedChannelAnalysisRepository(
      supabase,
    ).loadChannelBandsForWindow({
      organizationId: ORGANIZATION,
      windowStart: "2026-01-01",
      windowEnd: "2026-02-28",
      grain: "day",
    });

    expect(bands).toHaveLength(1);
    expect(bands[0].findings.map((finding) => finding.id)).toEqual(["finding-open"]);
  });
});

describe("loadAnalysedWindowKeys", () => {
  it("scopes to the organization and to completed runs", async () => {
    const supabase = supabaseStub();
    const repository = createAuthenticatedChannelAnalysisRepository(supabase);

    await repository.loadAnalysedWindowKeys({ organizationId: ORGANIZATION });

    const runsQuery = supabase.queries.find((query) => query.table === "channel_analysis_runs");
    expect(runsQuery).toBeDefined();
    // A running or failed run says nothing a page can open on, and another
    // tenant's windows must never leak into this picker.
    expect(runsQuery?.filters).toContainEqual(["organization_id", ORGANIZATION]);
    expect(runsQuery?.filters).toContainEqual(["status", "completed"]);
  });

  it("deduplicates repeated window keys and returns them newest-first", async () => {
    // The query itself orders by window_end descending; these rows arrive
    // exactly as it would return them, so the method's own dedup logic --
    // keep the first occurrence per key -- is what this test exercises.
    const supabase = supabaseStub({
      channel_analysis_runs: [
        // Two channels analysed over the same window: one row per completed
        // run, but only one window key belongs on the picker.
        { window_start: "2026-02-01", window_end: "2026-02-28", period_grain: "day" },
        { window_start: "2026-02-01", window_end: "2026-02-28", period_grain: "day" },
        { window_start: "2026-01-01", window_end: "2026-01-31", period_grain: "day" },
      ],
    });
    const repository = createAuthenticatedChannelAnalysisRepository(supabase);

    const keys = await repository.loadAnalysedWindowKeys({ organizationId: ORGANIZATION });

    expect(keys).toEqual([
      { windowStart: "2026-02-01", windowEnd: "2026-02-28", grain: "day" },
      { windowStart: "2026-01-01", windowEnd: "2026-01-31", grain: "day" },
    ]);
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

  it("reads evidence windows across every channel when no channel is named", async () => {
    // The merged Channels page offers one window control over the whole
    // organization, so the channel filter has to be optional rather than
    // fanned out into one query per channel.
    const queries: { table: string; filters: [string, unknown][] }[] = [];
    const supabase = {
      from(table: string) {
        const filters: [string, unknown][] = [];
        queries.push({ table, filters });
        const builder = {
          select: () => builder,
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return builder;
          },
          is: () => builder,
          not: () => builder,
          in: () => builder,
          order: () => builder,
          limit: () => builder,
          then: (
            onFulfilled: (value: QueryResult) => unknown,
            onRejected?: (reason: unknown) => unknown,
          ) => Promise.resolve({ data: [], error: null } as QueryResult).then(onFulfilled, onRejected),
        };
        return builder;
      },
    } as unknown as SupabaseClient<Database>;

    await createAuthenticatedChannelAnalysisRepository(supabase).loadEvidenceWindows({
      organizationId: "org-1",
      channelId: null,
      limit: 24,
    });

    const packagesQuery = queries.find((query) => query.table === "integration_report_packages");
    expect(packagesQuery).toBeDefined();
    expect(packagesQuery?.filters).toContainEqual(["organization_id", "org-1"]);
    expect(packagesQuery?.filters.some(([column]) => column === "channel_id")).toBe(false);
  });
});
