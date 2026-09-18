import { describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

vi.mock("server-only", () => ({}));

/**
 * Session-only growth reads (data contract D05/D07).
 *
 * Like a librarian fetching only the borrower's own reserved slips: every
 * query names the organization, pages stay bounded, and a missing slip, a
 * damaged slip and a locked door are three different answers.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const DEF = "22222222-2222-4222-8222-222222222222";

type CallSteps = {
  table: string;
  select?: string;
  filters: string[];
  orders: string[];
  range?: readonly [number, number];
  limit?: number;
  maybeSingle: boolean;
};

type HandlerResult = { data: unknown; error: unknown };

class FakeTable {
  readonly steps: CallSteps;

  constructor(table: string) {
    this.steps = { table, filters: [], orders: [], maybeSingle: false };
  }

  select(columns: string): this {
    this.steps.select = columns;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.steps.filters.push(`eq:${column}=${String(value)}`);
    return this;
  }

  gt(column: string, value: unknown): this {
    this.steps.filters.push(`gt:${column}=${String(value)}`);
    return this;
  }

  gte(column: string, value: unknown): this {
    this.steps.filters.push(`gte:${column}=${String(value)}`);
    return this;
  }

  lt(column: string, value: unknown): this {
    this.steps.filters.push(`lt:${column}=${String(value)}`);
    return this;
  }

  is(column: string, value: unknown): this {
    this.steps.filters.push(`is:${column}=${String(value)}`);
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    this.steps.filters.push(`not:${column}:${operator}:${String(value)}`);
    return this;
  }

  in(column: string, values: readonly unknown[]): this {
    this.steps.filters.push(`in:${column}=${[...values].join(",")}`);
    return this;
  }

  or(expression: string): this {
    this.steps.filters.push(`or:${expression}`);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.steps.orders.push(`order:${column}:${options?.ascending === false ? "desc" : "asc"}`);
    return this;
  }

  range(from: number, to: number): this {
    this.steps.range = [from, to];
    return this;
  }

  limit(count: number): this {
    this.steps.limit = count;
    return this;
  }

  maybeSingle(): Promise<HandlerResult> {
    this.steps.maybeSingle = true;
    return this.execute();
  }

  then<TResult1 = HandlerResult, TResult2 = never>(
    onFulfilled?: (value: HandlerResult) => TResult1 | PromiseLike<TResult1>,
    onRejected?: (reason: unknown) => TResult2 | PromiseLike<TResult2>,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve()
      .then(() => this.execute())
      .then(onFulfilled, onRejected);
  }

  private execute: () => Promise<HandlerResult> = async () => ({ data: [], error: null });
}

function fakeClient(responder: (steps: CallSteps) => HandlerResult) {
  const calls: CallSteps[] = [];
  const client = {
    from: (table: string) => {
      const query = new FakeTable(table);
      query["execute"] = async () => {
        calls.push(query.steps);
        const result = responder(query.steps);
        if (query.steps.maybeSingle && Array.isArray(result.data)) {
          return { data: result.data[0] ?? null, error: result.error };
        }
        return result;
      };
      return query as unknown as ReturnType<SupabaseClient<Database>["from"]>;
    },
  } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

type PointShape = {
  date: string;
  lowMinor: number;
  centralMinor: number;
  highMinor: number;
  anchor: boolean;
};

function dayPoints(days: number): PointShape[] {
  const points: PointShape[] = [
    { date: "2030-01-01", lowMinor: 0, centralMinor: 0, highMinor: 0, anchor: true },
  ];
  for (let day = 1; day <= days; day += 1) {
    const date = `2030-01-${String(day).padStart(2, "0")}`;
    points.push({
      date,
      lowMinor: 1000 * day,
      centralMinor: 1100 * day,
      highMinor: 1200 * day,
      anchor: false,
    });
  }
  return points;
}

function frozenDocument() {
  return {
    organizationId: ORG,
    scheduleOriginDate: "2030-01-01",
    cycleIndex: 0,
    horizonMonths: 1,
    startDate: "2030-01-01",
    endDateExclusive: "2030-02-01",
    issuedAt: "2030-01-02T00:00:00Z",
    sourceCutoffDate: "2030-01-01",
    timeZone: "Asia/Dubai",
    currency: "AED",
    metricKey: "revenue.gross",
    scopePartitions: [
      {
        partitionKey: "pk-a1000000",
        channelId: null,
        branchId: null,
        metricDefinitionId: DEF,
        dimensionsDigest: "empty",
        periodTimezone: "Asia/Dubai",
      },
    ],
    baselineWindow: { startDate: "2029-12-01", endDateExclusive: "2030-01-01" },
    monthlyLowMinor: 31000,
    monthlyHighMinor: 37200,
    points: dayPoints(31),
    sources: [],
    actionAssumptions: [],
    limitations: ["Seeded capacity note."],
  };
}

function projectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001",
    organization_id: ORG,
    schedule_origin_date: "2030-01-01",
    cycle_index: 0,
    horizon_months: 1,
    period_start: "2030-01-01",
    period_end_exclusive: "2030-02-01",
    issued_at: "2030-01-02T00:00:00Z",
    source_cutoff_date: "2030-01-01",
    timezone: "Asia/Dubai",
    currency: "AED",
    metric_key: "revenue.gross",
    scope_digest: "a".repeat(64),
    input_digest: "b".repeat(64),
    document_version: 1,
    method_version: "even_pace_v1",
    requires_growth_read: false,
    requires_campaign_read: false,
    frozen_document: frozenDocument(),
    created_at: "2030-01-02T00:00:00Z",
    ...overrides,
  };
}

const SCOPE = [
  {
    partitionKey: "pk-1",
    channelId: null,
    branchId: null,
    metricDefinitionId: DEF,
    dimensionsDigest: "empty",
    periodTimezone: "UTC",
  },
];

function normalizedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb001",
    organization_id: ORG,
    branch_id: null,
    channel_id: null,
    metric_definition_id: DEF,
    value_kind: "money",
    dimensions: {},
    period_grain: "day",
    period_start: "2030-01-01T00:00:00Z",
    period_end: "2030-01-02T00:00:00Z",
    period_timezone: "UTC",
    value_numerator: 100000,
    value_denominator: null,
    currency: "AED",
    quality_tier: "measured",
    revision: 1,
    superseded_by_id: null,
    reconciliation_state: "current",
    reconciliation_digest: "digest-1",
    created_at: "2030-01-05T00:00:00Z",
    ...overrides,
  };
}

function exactRow(overrides: Record<string, unknown> = {}) {
  // Note: no quality_tier column exists on this table by design; eligibility
  // uses quality_state/completeness_state plus reconciliation_state.
  return {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccc0001",
    organization_id: ORG,
    branch_id: "44444444-4444-4444-8444-444444444444",
    channel_id: "55555555-5555-4555-8555-555555555555",
    metric_definition_id: DEF,
    value_kind: "money",
    period_start: "2030-01-01",
    period_end: "2030-01-01",
    period_timezone: "UTC",
    value_numerator: 50000,
    currency: "AED",
    quality_state: "complete",
    completeness_state: "complete",
    revision: 1,
    superseded_by_id: null,
    reconciliation_state: "current",
    reconciliation_digest: "digest-exact-1",
    created_at: "2030-01-05T00:00:00Z",
    ...overrides,
  };
}

function registryRows() {
  return [
    {
      id: DEF,
      key: "revenue.gross",
      value_kind: "money",
      aggregation: "sum",
      is_active: true,
      organization_id: null,
    },
  ];
}

describe("growth-progress repository", () => {
  it("scopes every projection query to the organization", async () => {
    const { createGrowthProgressRepository } = await import(
      "@/modules/organizations/infrastructure/growth-progress-repository"
    );
    const { client, calls } = fakeClient((steps) => {
      if (steps.table === "organizations") return { data: [{ id: ORG }], error: null };
      return { data: [], error: null };
    });
    const result = await createGrowthProgressRepository(client).readProjections({
      organizationId: ORG,
      asOfDate: "2030-01-15",
    });
    expect(result).toEqual({ status: "missing", reason: "PROJECTION_MISSING" });
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const scoped =
        call.filters.some((filter) => filter.includes("organization_id")) ||
        call.filters.some((filter) => filter === `eq:id=${ORG}`);
      expect(scoped).toBe(true);
    }
    const projectionCall = calls.find((call) => call.table === "organization_growth_projections");
    expect(projectionCall?.filters).toContain(`eq:organization_id=${ORG}`);
    expect(projectionCall?.filters).toContain("gt:period_end_exclusive=2030-01-15");
  });

  it("returns one active row per horizon and skips the past", async () => {
    const { createGrowthProgressRepository } = await import(
      "@/modules/organizations/infrastructure/growth-progress-repository"
    );
    const { client } = fakeClient((steps) => {
      if (steps.table === "organizations") return { data: [{ id: ORG }], error: null };
      const rows = [
        projectionRow(),
        projectionRow({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0003",
          horizon_months: 3,
          frozen_document: { ...frozenDocument(), horizonMonths: 3 },
        }),
        projectionRow({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0000",
          cycle_index: 5,
          period_start: "2029-01-01",
          period_end_exclusive: "2029-02-01",
          frozen_document: {
            ...frozenDocument(),
            cycleIndex: 5,
            startDate: "2029-01-01",
            endDateExclusive: "2029-02-01",
            points: dayPoints(31).map((point, index) =>
              index === 0
                ? { ...point, date: "2029-01-01" }
                : { ...point, date: `2029-01-${String(index).padStart(2, "0")}` },
            ),
          },
        }),
      ];
      // The database applies the as-of filter; the fake honors it the same way.
      const cutoff = steps.filters
        .find((filter) => filter.startsWith("gt:period_end_exclusive="))
        ?.split("=")[1];
      return {
        data: rows.filter((row) => !cutoff || row.period_end_exclusive > cutoff),
        error: null,
      };
    });
    const result = await createGrowthProgressRepository(client).readProjections({
      organizationId: ORG,
      asOfDate: "2030-01-15",
    });
    if (result.status !== "ready") throw new Error(`expected ready, got ${result.status}`);
    expect(result.projections.map((doc) => doc.horizonMonths)).toEqual([1, 3]);
  });

  it("tells missing, corrupt, denied and failed apart", async () => {
    const { createGrowthProgressRepository } = await import(
      "@/modules/organizations/infrastructure/growth-progress-repository"
    );
    const read = (client: SupabaseClient<Database>) =>
      createGrowthProgressRepository(client).readProjections({
        organizationId: ORG,
        asOfDate: "2030-01-15",
      });

    const missing = fakeClient((steps) =>
      steps.table === "organizations"
        ? { data: [{ id: ORG }], error: null }
        : { data: [], error: null },
    );
    expect(await read(missing.client)).toEqual({
      status: "missing",
      reason: "PROJECTION_MISSING",
    });

    const corrupt = fakeClient((steps) =>
      steps.table === "organizations"
        ? { data: [{ id: ORG }], error: null }
        : { data: [projectionRow({ frozen_document: { nonsense: true } })], error: null },
    );
    expect(await read(corrupt.client)).toEqual({
      status: "corrupt",
      reason: "PROJECTION_CORRUPT",
    });

    const mismatched = fakeClient((steps) =>
      steps.table === "organizations"
        ? { data: [{ id: ORG }], error: null }
        : { data: [projectionRow({ horizon_months: 3 })], error: null },
    );
    expect(await read(mismatched.client)).toEqual({
      status: "corrupt",
      reason: "PROJECTION_CORRUPT",
    });

    const deniedCalls: CallSteps[] = [];
    const denied = fakeClient((steps) => {
      deniedCalls.push(steps);
      return { data: [], error: null };
    });
    expect(await read(denied.client)).toEqual({
      status: "denied",
      reason: "PERMISSION_DENIED",
    });
    expect(deniedCalls.map((call) => call.table)).toEqual(["organizations"]);

    const failedProbe = fakeClient((steps) =>
      steps.table === "organizations"
        ? { data: null, error: { code: "XX000", message: "boom" } }
        : { data: [], error: null },
    );
    expect(await read(failedProbe.client)).toEqual({
      status: "failed",
      reason: "SOURCE_READ_FAILED",
    });

    const failedRows = fakeClient((steps) =>
      steps.table === "organizations"
        ? { data: [{ id: ORG }], error: null }
        : { data: null, error: { code: "XX000", message: "boom" } },
    );
    expect(await read(failedRows.client)).toEqual({
      status: "failed",
      reason: "SOURCE_READ_FAILED",
    });

    expect(
      await createGrowthProgressRepository(missing.client).readProjections({
        organizationId: "not-a-uuid",
        asOfDate: "2030-01-15",
      }),
    ).toEqual({ status: "failed", reason: "SOURCE_READ_FAILED" });
  });

  it("reads facts with bounded pages in deterministic order", async () => {
    const { createGrowthProgressRepository } = await import(
      "@/modules/organizations/infrastructure/growth-progress-repository"
    );
    const rows = Array.from({ length: 1200 }, (_, index) => {
      const day = (index % 28) + 1;
      const start = `2030-01-${String(day).padStart(2, "0")}T00:00:00Z`;
      const endDay = day === 28 ? "2030-01-29" : `2030-01-${String(day + 1).padStart(2, "0")}`;
      return normalizedRow({
        id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, "0")}`,
        period_start: start,
        period_end: `${endDay}T00:00:00Z`,
        rowId: undefined,
      });
    });
    const { client, calls } = fakeClient((steps) => {
      if (steps.table === "organizations") return { data: [{ id: ORG }], error: null };
      if (steps.table === "metric_definitions") return { data: registryRows(), error: null };
      if (steps.table === "normalized_metrics") {
        const [from = 0, to = 499] = steps.range ?? [0, 499];
        return { data: rows.slice(from, to + 1), error: null };
      }
      return { data: [], error: null };
    });
    const result = await createGrowthProgressRepository(client).readRevenueFacts({
      organizationId: ORG,
      from: "2030-01-01",
      toExclusive: "2030-02-01",
      scopePartitions: SCOPE,
    });
    if (result.status !== "ready") throw new Error(`expected ready, got ${result.status}`);
    expect(result.facts).toHaveLength(1200);
    const pageCalls = calls.filter((call) => call.table === "normalized_metrics");
    expect(pageCalls).toHaveLength(3);
    expect(pageCalls[0]?.range).toEqual([0, 499]);
    expect(pageCalls[1]?.range).toEqual([500, 999]);
    for (const call of pageCalls) {
      expect(call.orders).toContain("order:period_start:asc");
      expect(call.orders).toContain("order:id:asc");
      expect(call.filters).toContain(`eq:organization_id=${ORG}`);
    }
  });

  it("reports truncation instead of a partial total", async () => {
    const { createGrowthProgressRepository } = await import(
      "@/modules/organizations/infrastructure/growth-progress-repository"
    );
    const { client } = fakeClient((steps) => {
      if (steps.table === "organizations") return { data: [{ id: ORG }], error: null };
      if (steps.table === "metric_definitions") return { data: registryRows(), error: null };
      if (steps.table === "normalized_metrics") {
        const [from = 0, to = 499] = steps.range ?? [0, 499];
        const count = Math.min(500, 10_001 - from);
        void to;
        return {
          data: Array.from({ length: Math.max(count, 0) }, (_, index) =>
            normalizedRow({
              id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(from + index).padStart(12, "0")}`,
            }),
          ),
          error: null,
        };
      }
      return { data: [], error: null };
    });
    const result = await createGrowthProgressRepository(client).readRevenueFacts({
      organizationId: ORG,
      from: "2030-01-01",
      toExclusive: "2030-02-01",
      scopePartitions: SCOPE,
    });
    expect(result).toEqual({ status: "limited", reason: "SOURCE_LIMIT_EXCEEDED" });
  });

  it("preserves source identity on every fact", async () => {
    const { createGrowthProgressRepository } = await import(
      "@/modules/organizations/infrastructure/growth-progress-repository"
    );
    const branchScope = [
      {
        partitionKey: "pk-branch",
        channelId: "55555555-5555-4555-8555-555555555555",
        branchId: "44444444-4444-4444-8444-444444444444",
        metricDefinitionId: DEF,
        dimensionsDigest: "empty",
        periodTimezone: "UTC",
      },
    ];
    const { client, calls } = fakeClient((steps) => {
      if (steps.table === "organizations") return { data: [{ id: ORG }], error: null };
      if (steps.table === "metric_definitions") return { data: registryRows(), error: null };
      if (steps.table === "organization_channels")
        return {
          data: [{ id: "55555555-5555-4555-8555-555555555555" }],
          error: null,
        };
      if (steps.table === "branches")
        return {
          data: [{ id: "44444444-4444-4444-8444-444444444444" }],
          error: null,
        };
      if (steps.table === "normalized_metrics") return { data: [normalizedRow()], error: null };
      if (steps.table === "exact_range_metric_observations")
        return { data: [exactRow()], error: null };
      return { data: [], error: null };
    });
    void calls;
    const result = await createGrowthProgressRepository(client).readRevenueFacts({
      organizationId: ORG,
      from: "2030-01-01",
      toExclusive: "2030-02-01",
      scopePartitions: [...SCOPE, ...branchScope],
    });
    if (result.status !== "ready") throw new Error(`expected ready, got ${result.status}`);
    expect(result.facts).toHaveLength(2);
    const [periodFact, spanFact] = result.facts;
    expect(periodFact).toMatchObject({
      sourceTable: "normalized_metrics",
      rowId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb001",
      organizationId: ORG,
      partitionKey: "pk-1",
      startDate: "2030-01-01",
      endDateExclusive: "2030-01-02",
      amountMinor: 100000,
      currency: "AED",
      reconciliationDigest: "digest-1",
    });
    // Inclusive exact-range end dates arrive end-exclusive internally.
    expect(spanFact).toMatchObject({
      sourceTable: "exact_range_metric_observations",
      rowId: "cccccccc-cccc-4ccc-8ccc-cccccccc0001",
      partitionKey: "pk-branch",
      startDate: "2030-01-01",
      endDateExclusive: "2030-01-02",
      amountMinor: 50000,
      currency: "AED",
    });
  });

  it("qualifies rows by their real contracts, never a guessed quality_tier", async () => {
    const { createGrowthProgressRepository } = await import(
      "@/modules/organizations/infrastructure/growth-progress-repository"
    );
    const { client, calls } = fakeClient((steps) => {
      if (steps.table === "organizations") return { data: [{ id: ORG }], error: null };
      if (steps.table === "metric_definitions") return { data: registryRows(), error: null };
      if (steps.table === "normalized_metrics") {
        return {
          data: [
            normalizedRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb101" }),
            normalizedRow({
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb102",
              quality_tier: "derived",
            }),
            normalizedRow({
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb103",
              quality_tier: "estimated",
            }),
            normalizedRow({
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb104",
              reconciliation_state: "blocked_overlap",
            }),
            normalizedRow({
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb105",
              reconciliation_digest: null,
            }),
            normalizedRow({
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb106",
              currency: null,
            }),
            normalizedRow({
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb107",
              dimensions: { item: "soup" },
            }),
            normalizedRow({
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb108",
              period_start: "2030-01-01T00:30:00Z",
              period_end: "2030-01-01T01:30:00Z",
            }),
            normalizedRow({
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb109",
              period_start: "2029-12-31T00:00:00Z",
              period_end: "2030-01-01T00:00:00Z",
            }),
            normalizedRow({
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb110",
              value_numerator: 12.5,
            }),
            normalizedRow({
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb111",
              channel_id: "55555555-5555-4555-8555-555555555555",
            }),
          ],
          error: null,
        };
      }
      if (steps.table === "exact_range_metric_observations") {
        return {
          data: [
            exactRow({
              id: "cccccccc-cccc-4ccc-8ccc-cccccccc0101",
              branch_id: "44444444-4444-4444-8444-444444444444",
              channel_id: "55555555-5555-4555-8555-555555555555",
            }),
            exactRow({
              id: "cccccccc-cccc-4ccc-8ccc-cccccccc0102",
              quality_state: "partial",
              branch_id: "44444444-4444-4444-8444-444444444444",
              channel_id: "55555555-5555-4555-8555-555555555555",
            }),
            exactRow({
              id: "cccccccc-cccc-4ccc-8ccc-cccccccc0103",
              completeness_state: "partial",
              branch_id: "44444444-4444-4444-8444-444444444444",
              channel_id: "55555555-5555-4555-8555-555555555555",
            }),
            exactRow({
              id: "cccccccc-cccc-4ccc-8ccc-cccccccc0104",
              branch_id: null,
            }),
          ],
          error: null,
        };
      }
      if (steps.table === "organization_channels")
        return {
          data: [{ id: "55555555-5555-4555-8555-555555555555" }],
          error: null,
        };
      if (steps.table === "branches")
        return {
          data: [{ id: "44444444-4444-4444-8444-444444444444" }],
          error: null,
        };
      return { data: [], error: null };
    });
    const result = await createGrowthProgressRepository(client).readRevenueFacts({
      organizationId: ORG,
      from: "2030-01-01",
      toExclusive: "2030-02-01",
      scopePartitions: [
        ...SCOPE,
        {
          partitionKey: "pk-branch",
          channelId: "55555555-5555-4555-8555-555555555555",
          branchId: "44444444-4444-4444-8444-444444444444",
          metricDefinitionId: DEF,
          dimensionsDigest: "empty",
          periodTimezone: "UTC",
        },
      ],
    });
    if (result.status !== "ready") throw new Error(`expected ready, got ${result.status}`);
    // Measured + derived period rows and the complete/complete span survive;
    // estimated, blocked, undigested, currency-less, dimensioned, misaligned,
    // out-of-window, fractional, unmatched and branchless-span rows do not.
    expect(result.facts.map((fact) => fact.rowId).sort()).toEqual([
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb101",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb102",
      "cccccccc-cccc-4ccc-8ccc-cccccccc0101",
    ]);
    const exactCall = calls.find((call) => call.table === "exact_range_metric_observations");
    expect(exactCall).toBeDefined();
    expect(exactCall?.filters.some((filter) => filter.includes("quality_tier"))).toBe(false);
  });

  it("reads the registry with org-override precedence and money-sum rules", async () => {
    const { createGrowthProgressRepository } = await import(
      "@/modules/organizations/infrastructure/growth-progress-repository"
    );
    const read = (client: SupabaseClient<Database>) =>
      createGrowthProgressRepository(client).readRevenueFacts({
        organizationId: ORG,
        from: "2030-01-01",
        toExclusive: "2030-02-01",
        scopePartitions: SCOPE,
      });

    const OVERRIDE_DEF = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const orgOverride = fakeClient((steps) => {
      if (steps.table === "organizations") return { data: [{ id: ORG }], error: null };
      if (steps.table === "metric_definitions")
        return {
          data: [
            ...registryRows(),
            {
              id: OVERRIDE_DEF,
              key: "revenue.gross",
              value_kind: "money",
              aggregation: "sum",
              is_active: true,
              organization_id: ORG,
            },
          ],
          error: null,
        };
      if (steps.table === "normalized_metrics")
        return { data: [normalizedRow({ metric_definition_id: OVERRIDE_DEF })], error: null };
      return { data: [], error: null };
    });
    const scoped = await createGrowthProgressRepository(orgOverride.client).readRevenueFacts({
      organizationId: ORG,
      from: "2030-01-01",
      toExclusive: "2030-02-01",
      scopePartitions: [{ ...SCOPE[0]!, metricDefinitionId: OVERRIDE_DEF }],
    });
    // The org override shadows shared vocabulary: the row carrying the
    // override id is admitted, which only happens when it wins precedence.
    if (scoped.status !== "ready") throw new Error(`expected ready, got ${scoped.status}`);
    expect(scoped.facts).toHaveLength(1);
    const metricCall = orgOverride.calls.find((call) => call.table === "metric_definitions");
    expect(metricCall?.filters).toContain("eq:key=revenue.gross");

    const inactive = fakeClient((steps) => {
      if (steps.table === "organizations") return { data: [{ id: ORG }], error: null };
      if (steps.table === "metric_definitions")
        return {
          data: [
            {
              id: DEF,
              key: "revenue.gross",
              value_kind: "money",
              aggregation: "sum",
              is_active: false,
              organization_id: null,
            },
          ],
          error: null,
        };
      return { data: [], error: null };
    });
    expect(await read(inactive.client)).toEqual({ status: "ready", facts: [] });

    const badAggregation = fakeClient((steps) => {
      if (steps.table === "organizations") return { data: [{ id: ORG }], error: null };
      if (steps.table === "metric_definitions")
        return {
          data: [
            {
              id: DEF,
              key: "revenue.gross",
              value_kind: "money",
              aggregation: "mean",
              is_active: true,
              organization_id: null,
            },
          ],
          error: null,
        };
      return { data: [], error: null };
    });
    expect(await read(badAggregation.client)).toEqual({ status: "ready", facts: [] });
  });

  it("rejects unresolved scope overlap without reading the ledgers", async () => {
    const { createGrowthProgressRepository } = await import(
      "@/modules/organizations/infrastructure/growth-progress-repository"
    );
    const branchId = "44444444-4444-4444-8444-444444444444";
    const overlapping = [
      ...SCOPE,
      {
        partitionKey: "pk-branch",
        channelId: null,
        branchId,
        metricDefinitionId: DEF,
        dimensionsDigest: "empty",
        periodTimezone: "UTC",
      },
    ];
    const { client, calls } = fakeClient((steps) => {
      if (steps.table === "organizations") return { data: [{ id: ORG }], error: null };
      return { data: [], error: null };
    });
    await expect(
      createGrowthProgressRepository(client).readRevenueFacts({
        organizationId: ORG,
        from: "2030-01-01",
        toExclusive: "2030-02-01",
        scopePartitions: overlapping,
      }),
    ).rejects.toMatchObject({ code: "SCOPE_NOT_COMPARABLE" });
    expect(calls.map((call) => call.table)).toEqual(["organizations"]);
  });

  it("denies strangers before any ledger read and fails loudly on errors", async () => {
    const { createGrowthProgressRepository } = await import(
      "@/modules/organizations/infrastructure/growth-progress-repository"
    );
    const denied = fakeClient(() => ({ data: [], error: null }));
    const deniedResult = await createGrowthProgressRepository(denied.client).readRevenueFacts({
      organizationId: ORG,
      from: "2030-01-01",
      toExclusive: "2030-02-01",
      scopePartitions: SCOPE,
    });
    expect(deniedResult).toEqual({ status: "denied", reason: "PERMISSION_DENIED" });
    expect(denied.calls.map((call) => call.table)).toEqual(["organizations"]);

    const failing = fakeClient((steps) =>
      steps.table === "organizations"
        ? { data: [{ id: ORG }], error: null }
        : steps.table === "metric_definitions"
          ? { data: registryRows(), error: null }
          : { data: null, error: { code: "XX000", message: "boom" } },
    );
    const failedResult = await createGrowthProgressRepository(failing.client).readRevenueFacts({
      organizationId: ORG,
      from: "2030-01-01",
      toExclusive: "2030-02-01",
      scopePartitions: SCOPE,
    });
    expect(failedResult).toEqual({ status: "failed", reason: "SOURCE_READ_FAILED" });
  });
});
