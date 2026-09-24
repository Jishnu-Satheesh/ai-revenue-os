import { describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { FrozenGrowthProjection } from "@/domain/organizations/growth-progress";
import { frozenGrowthProjectionSchema } from "@/domain/organizations/growth-progress";
import type { RevenueScenarioInput } from "@/domain/organizations/revenue-scenario";
import type { Database } from "@/lib/supabase/database.types";
import { assembleLedgerBaselineCandidate } from "@/modules/organizations/application/growth-candidate-assembly";
import {
  createGrowthProgressRepository,
  listBaselineCoordinates,
  resolveGrowthRevenueDefinitionId,
} from "@/modules/organizations/infrastructure/growth-progress-repository";
import {
  publishDueGrowthProjections,
  type GrowthCandidateBuildContext,
  type GrowthProjectionPublisherDependencies,
  type GrowthScheduleSnapshot,
} from "@/modules/organizations/application/growth-projection-publisher";

vi.mock("server-only", () => ({}));

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG_ID = "22222222-2222-4222-8222-222222222222";
const CORRELATION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DIGEST = "a".repeat(64);

/** Dubai local 2026-09-17; New York local 2026-09-16 for the same instant. */
const NOW_ISO = "2026-09-16T20:00:00.000Z";

function material(): { input: RevenueScenarioInput } {
  return {
    input: {
      organizationId: ORG_ID,
      grain: "month",
      history: [{ label: "2026-08", minorUnits: 800_00, currency: "AED" }],
      losses: [],
      actions: [],
      lastObservationDate: "2026-08-31",
      today: "2026-09-17",
      cutoffNote: "Reports through 2026-08-31.",
      coverageNote: "Monthly baseline.",
    },
  };
}

function cannedDocument(context: GrowthCandidateBuildContext, organizationId = ORG_ID) {
  return {
    organizationId,
    scheduleOriginDate: context.scheduleOriginDate,
    horizonMonths: context.horizonMonths,
    cycleIndex: context.cycleIndex,
  } as unknown as FrozenGrowthProjection;
}

function dependencies(
  overrides: Partial<GrowthProjectionPublisherDependencies> = {},
): GrowthProjectionPublisherDependencies & {
  isEnabled: ReturnType<typeof vi.fn>;
  readSchedule: ReturnType<typeof vi.fn>;
  buildCandidate: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
} {
  // Every override at the call sites is a vi.fn; the cast recovers the mock
  // surface the assertions use without weakening the dependency contract.
  return {
    isEnabled: vi.fn(() => true),
    readSchedule: vi.fn(async (): Promise<GrowthScheduleSnapshot> => ({ status: "missing" })),
    buildCandidate: vi.fn(
      async (_material: RevenueScenarioInput, context: GrowthCandidateBuildContext) => ({
        status: "ready" as const,
        document: cannedDocument(context),
      }),
    ),
    publish: vi.fn(async () => ({
      projectionId: "33333333-3333-4333-8333-333333333333",
      digest: DIGEST,
      published: true,
    })),
    ...overrides,
  } as GrowthProjectionPublisherDependencies & {
    isEnabled: ReturnType<typeof vi.fn>;
    readSchedule: ReturnType<typeof vi.fn>;
    buildCandidate: ReturnType<typeof vi.fn>;
    publish: ReturnType<typeof vi.fn>;
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG_ID,
    nowIso: NOW_ISO,
    timeZone: "Asia/Dubai",
    correlationId: CORRELATION_ID,
    candidateMaterial: material(),
    ...overrides,
  };
}

describe("publishDueGrowthProjections bootstrap", () => {
  it("opens every horizon at cycle 0 from the next-day origin", async () => {
    const deps = dependencies();
    const result = await publishDueGrowthProjections(input(), deps);

    expect(result.results.map((entry) => entry.horizonMonths)).toEqual([1, 3, 6, 12]);
    for (const entry of result.results) {
      expect(entry).toMatchObject({ status: "published", reasonCode: null });
    }
    expect(deps.buildCandidate).toHaveBeenCalledTimes(4);
    for (const call of deps.buildCandidate.mock.calls) {
      const context = call[1] as GrowthCandidateBuildContext;
      expect(context).toMatchObject({
        organizationId: ORG_ID,
        scheduleOriginDate: "2026-09-18",
        cycleIndex: 0,
        issuedAt: NOW_ISO,
        sourceCutoffDate: "2026-09-17",
        timeZone: "Asia/Dubai",
      });
    }
    expect(deps.publish).toHaveBeenCalledTimes(4);
    for (const call of deps.publish.mock.calls) {
      const payload = call[0] as { organizationId: string; correlationId: string };
      expect(payload.organizationId).toBe(ORG_ID);
      expect(payload.correlationId).toBe(CORRELATION_ID);
    }
  });

  it("hands candidate documents to the write boundary unchanged", async () => {
    const built: FrozenGrowthProjection[] = [];
    const deps = dependencies({
      buildCandidate: vi.fn(
        async (_material: RevenueScenarioInput, context: GrowthCandidateBuildContext) => {
          const document = cannedDocument(context);
          built.push(document);
          return { status: "ready" as const, document };
        },
      ),
    });
    await publishDueGrowthProjections(input(), deps);

    const published = deps.publish.mock.calls.map(
      (call) => (call[0] as { document: FrozenGrowthProjection }).document,
    );
    // Same objects, same order, untouched: lineage included, nothing re-dated.
    expect(published).toEqual(built);
    for (const [index, document] of published.entries()) {
      expect(document).toBe(built[index]);
    }
  });
});

describe("publishDueGrowthProjections scheduling", () => {
  it("rolls each horizon on its own cycle from the stored origin", async () => {
    const deps = dependencies({
      readSchedule: vi.fn(
        async (): Promise<GrowthScheduleSnapshot> => ({
          status: "ready",
          origins: ["2026-08-18"],
        }),
      ),
    });
    const result = await publishDueGrowthProjections(input(), deps);

    // Only the 1-month horizon opens a new period on 2026-09-17: its cycle-1
    // issue date. Longer horizons stay quiet until their own issue day.
    expect(result.results[0]).toMatchObject({ horizonMonths: 1, status: "published" });
    expect(result.results.slice(1)).toMatchObject([
      { horizonMonths: 3, status: "skipped", reasonCode: "NOT_DUE" },
      { horizonMonths: 6, status: "skipped", reasonCode: "NOT_DUE" },
      { horizonMonths: 12, status: "skipped", reasonCode: "NOT_DUE" },
    ]);
    expect(deps.buildCandidate).toHaveBeenCalledTimes(1);
    expect(deps.publish).toHaveBeenCalledTimes(1);
    const context = deps.buildCandidate.mock.calls[0]?.[1] as GrowthCandidateBuildContext;
    expect(context).toMatchObject({
      scheduleOriginDate: "2026-08-18",
      horizonMonths: 1,
      cycleIndex: 1,
    });
  });

  it("anchors later months to the original day, never to a clamped month", async () => {
    const deps = dependencies({
      readSchedule: vi.fn(
        async (): Promise<GrowthScheduleSnapshot> => ({
          status: "ready",
          origins: ["2026-01-31"],
        }),
      ),
    });
    // Dubai local 2026-03-30: the issue day for the period starting 2026-03-31,
    // which is origin + 2 months — not origin + 1 month + 1 month (03-28).
    const result = await publishDueGrowthProjections(
      input({ nowIso: "2026-03-29T20:00:00.000Z", timeZone: "Asia/Dubai" }),
      deps,
    );

    expect(result.results[0]).toMatchObject({ horizonMonths: 1, status: "published" });
    const context = deps.buildCandidate.mock.calls[0]?.[1] as GrowthCandidateBuildContext;
    expect(context).toMatchObject({
      scheduleOriginDate: "2026-01-31",
      horizonMonths: 1,
      cycleIndex: 2,
    });
  });

  it("bypasses quiet days without building, publishing or calling a model", async () => {
    const deps = dependencies({
      readSchedule: vi.fn(
        async (): Promise<GrowthScheduleSnapshot> => ({
          status: "ready",
          origins: ["2026-09-18"],
        }),
      ),
    });
    // Dubai local 2026-09-20: no horizon opens a period on 2026-09-21.
    const result = await publishDueGrowthProjections(
      input({ nowIso: "2026-09-19T20:00:00.000Z" }),
      deps,
    );

    for (const entry of result.results) {
      expect(entry).toMatchObject({ status: "skipped", reasonCode: "NOT_DUE" });
    }
    expect(deps.buildCandidate).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("reads the organization's own calendar, so the same instant differs by zone", async () => {
    const schedule: GrowthScheduleSnapshot = { status: "ready", origins: ["2026-09-18"] };
    const dubaiDeps = dependencies({ readSchedule: vi.fn(async () => schedule) });
    const yorkDeps = dependencies({ readSchedule: vi.fn(async () => schedule) });

    // 2026-09-16T20:00Z is 2026-09-17 in Dubai (issue day) but 2026-09-16 in
    // New York (a quiet day for the same schedule).
    const dubai = await publishDueGrowthProjections(input({ timeZone: "Asia/Dubai" }), dubaiDeps);
    const york = await publishDueGrowthProjections(
      input({ timeZone: "America/New_York" }),
      yorkDeps,
    );

    expect(dubai.results[0]).toMatchObject({ horizonMonths: 1, status: "published" });
    for (const entry of york.results) {
      expect(entry).toMatchObject({ status: "skipped", reasonCode: "NOT_DUE" });
    }
    expect(yorkDeps.publish).not.toHaveBeenCalled();
  });
});

describe("publishDueGrowthProjections gating", () => {
  it("leaves disabled organizations untouched before any read", async () => {
    const deps = dependencies({ isEnabled: vi.fn(() => false) });
    const result = await publishDueGrowthProjections(input(), deps);

    for (const entry of result.results) {
      expect(entry).toMatchObject({ status: "skipped", reasonCode: "DISABLED" });
    }
    expect(deps.readSchedule).not.toHaveBeenCalled();
    expect(deps.buildCandidate).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("skips due horizons with a typed code when the snapshot never stored", async () => {
    const deps = dependencies();
    const result = await publishDueGrowthProjections(input({ candidateMaterial: null }), deps);

    for (const entry of result.results) {
      expect(entry).toMatchObject({ status: "skipped", reasonCode: "CANDIDATE_UNAVAILABLE" });
    }
    expect(deps.buildCandidate).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("refuses a schedule with two origins instead of guessing one", async () => {
    const deps = dependencies({
      readSchedule: vi.fn(
        async (): Promise<GrowthScheduleSnapshot> => ({
          status: "ready",
          origins: ["2026-09-18", "2026-09-19"],
        }),
      ),
    });
    const result = await publishDueGrowthProjections(input(), deps);

    for (const entry of result.results) {
      expect(entry).toMatchObject({ status: "skipped", reasonCode: "SCHEDULE_CORRUPT" });
    }
    expect(deps.buildCandidate).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("fails closed when the schedule cannot be read", async () => {
    for (const schedule of [
      { status: "unavailable", reasonCode: "SCHEDULE_READ_FAILED" },
      { status: "unavailable", reasonCode: "SCHEDULE_DENIED" },
    ] as GrowthScheduleSnapshot[]) {
      const deps = dependencies({ readSchedule: vi.fn(async () => schedule) });
      const result = await publishDueGrowthProjections(input(), deps);
      for (const entry of result.results) {
        expect(entry.status).toBe("skipped");
      }
      expect(deps.publish).not.toHaveBeenCalled();
    }
  });

  it("carries a refused candidate as a skipped horizon with its reason", async () => {
    const deps = dependencies({
      buildCandidate: vi.fn(async () => ({
        status: "refused" as const,
        reason: "BASELINE_STALE" as const,
        detail: "The baseline month ended too long before issue.",
      })),
    });
    const result = await publishDueGrowthProjections(input(), deps);

    for (const entry of result.results) {
      expect(entry).toMatchObject({ status: "skipped", reasonCode: "CANDIDATE_BASELINE_STALE" });
    }
    expect(deps.publish).not.toHaveBeenCalled();
  });

  it("fails a horizon whose document names another tenant without publishing", async () => {
    const deps = dependencies({
      buildCandidate: vi.fn(
        async (_material: RevenueScenarioInput, context: GrowthCandidateBuildContext) => ({
          status: "ready" as const,
          document: cannedDocument(context, OTHER_ORG_ID),
        }),
      ),
    });
    const result = await publishDueGrowthProjections(input(), deps);

    for (const entry of result.results) {
      expect(entry).toMatchObject({ status: "failed", reasonCode: "TENANT_MISMATCH" });
    }
    expect(deps.publish).not.toHaveBeenCalled();
  });
});

describe("publishDueGrowthProjections idempotency", () => {
  it("replays an already-stored identity instead of moving the frozen line", async () => {
    const deps = dependencies({
      publish: vi.fn(async () => ({
        projectionId: "33333333-3333-4333-8333-333333333333",
        digest: DIGEST,
        published: false,
      })),
    });
    const result = await publishDueGrowthProjections(input(), deps);

    for (const entry of result.results) {
      expect(entry).toMatchObject({
        status: "replayed",
        projectionId: "33333333-3333-4333-8333-333333333333",
        digest: DIGEST,
        reasonCode: null,
      });
    }
  });

  it("keeps one identity across duplicate deliveries and retries", async () => {
    const seen = new Map<string, { projectionId: string; digest: string; published: boolean }>();
    const deps = dependencies({
      publish: vi.fn(async ({ document }: { document: FrozenGrowthProjection }) => {
        const key = `${document.horizonMonths}:${document.cycleIndex}`;
        const existing = seen.get(key);
        // Mirrors the database authority: the first delivery files the
        // original (and its single audit event); every redelivery replays the
        // stored identity with no second event and no changed numbers.
        if (existing) return { ...existing, published: false };
        const stored = {
          projectionId: "33333333-3333-4333-8333-333333333333",
          digest: DIGEST,
          published: true,
        };
        seen.set(key, stored);
        return stored;
      }),
    });

    const first = await publishDueGrowthProjections(input(), deps);
    const second = await publishDueGrowthProjections(input(), deps);

    expect(first.results.map((entry) => entry.status)).toEqual([
      "published",
      "published",
      "published",
      "published",
    ]);
    expect(second.results.map((entry) => entry.status)).toEqual([
      "replayed",
      "replayed",
      "replayed",
      "replayed",
    ]);
    for (const [index, entry] of second.results.entries()) {
      expect(entry).toMatchObject({
        projectionId: (first.results[index] as { projectionId: string }).projectionId,
        digest: (first.results[index] as { digest: string }).digest,
      });
    }
  });

  it("maps a retry across the start boundary to a failed horizon, not a backfill", async () => {
    const deps = dependencies({
      publish: vi.fn(async () => {
        throw { code: "PERIOD_ALREADY_STARTED" };
      }),
    });
    const result = await publishDueGrowthProjections(input(), deps);

    for (const entry of result.results) {
      expect(entry).toMatchObject({ status: "failed", reasonCode: "PERIOD_ALREADY_STARTED" });
    }
  });

  it("exposes publication failure per horizon, never hidden behind a stored flag", async () => {
    const deps = dependencies({
      publish: vi.fn(async ({ document }: { document: FrozenGrowthProjection }) =>
        document.horizonMonths === 3
          ? Promise.reject({ code: "PUBLISH_FAILED" })
          : {
              projectionId: "33333333-3333-4333-8333-333333333333",
              digest: DIGEST,
              published: true,
            },
      ),
    });
    const result = await publishDueGrowthProjections(input(), deps);

    // The envelope carries no snapshot `stored` field at all: a frozen-line
    // failure stands beside neighboring successes, each with its own code.
    expect("stored" in result).toBe(false);
    expect("snapshotStored" in result).toBe(false);
    expect(result.results[0]).toMatchObject({ horizonMonths: 1, status: "published" });
    expect(result.results[1]).toMatchObject({
      horizonMonths: 3,
      status: "failed",
      reasonCode: "PUBLISH_FAILED",
    });
  });
});

describe("publishDueGrowthProjections over the live dev-org profile", () => {
  const DEFINITION_ID = "a1a1a1a1-1111-4111-8111-111111111111";
  const FACT_DIGEST = "d".repeat(64);
  /** Dubai local 2026-08-29: the live ledger ends here, so the cutoff sits here. */
  const LIVE_NOW_ISO = "2026-08-28T20:00:00.000Z";
  const LIVE_CUTOFF = "2026-08-29";

  // Live profile from the controller's staging reads: revenue.gross rows are
  // measured/current/AED ending 2026-08-29, zero exact_range rows, 208 of 286
  // trailing-120d rows lack a reconciliation digest, zero frozen projections.
  // The fixture mirrors that composition at a smaller scale: 88 trailing-120d
  // normalized rows, 60 digest-null (a 68% majority, live 73%), 28
  // digest-present across 28 distinct days, 0 exact_range rows. Recent days
  // are deliberately thin (5 digest-present in the trailing 30): under the old
  // 7-in-30 rule the real ladder had to widen to the 14-in-60 rung, while
  // under ADR 0069 (floor 1 at every rung, digest-null rows admitted as
  // unreconciled evidence) rung 1 builds on its own from 18 reported days,
  // 15 of them from unreconciled rows.
  const LIVE_RECENT_DAYS = [
    "2026-08-25",
    "2026-08-26",
    "2026-08-27",
    "2026-08-28",
    "2026-08-29",
  ];

  function dateRange(from: string, to: string): string[] {
    const dates: string[] = [];
    let current = Date.parse(`${from}T00:00:00Z`);
    const end = Date.parse(`${to}T00:00:00Z`);
    while (current <= end) {
      dates.push(new Date(current).toISOString().slice(0, 10));
      current += 24 * 60 * 60 * 1000;
    }
    return dates;
  }

  const LIVE_MID_DAYS = dateRange("2026-07-05", "2026-07-15");
  const LIVE_OLD_DAYS = dateRange("2026-05-10", "2026-05-21");

  type LiveLedgerRow = Record<string, unknown>;

  function liveRow(date: string, rowId: string, digest: string | null): LiveLedgerRow {
    const previous = new Date(Date.parse(`${date}T00:00:00Z`) - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    return {
      id: rowId,
      organization_id: ORG_ID,
      branch_id: null,
      channel_id: null,
      metric_definition_id: DEFINITION_ID,
      value_kind: "money",
      dimensions: {},
      // Dubai-midnight instants: date 00:00 at +04:00 is 20:00Z the day before.
      period_start: `${previous}T20:00:00.000Z`,
      period_end: `${date}T20:00:00.000Z`,
      period_timezone: "Asia/Dubai",
      value_numerator: 100000,
      currency: "AED",
      quality_tier: "measured",
      revision: 1,
      superseded_by_id: null,
      reconciliation_state: "current",
      reconciliation_digest: digest,
      created_at: "2026-08-29T00:00:00.000Z",
    };
  }

  /**
   * In-memory stand-in for the database boundary beneath the readers: the
   * only stub in these tests. It answers the exact query vocabulary the real
   * readers use (eq/or/is/not/in/gte/lt/order/range/limit/maybeSingle) with
   * PostgREST-like semantics, so the real definition, coordinate and fact
   * readers — membership, window, measured and currency filtering included,
   * with digest-null rows admitted as unreconciled evidence per ADR 0069 —
   * run un-bypassed above it.
   */
  class LiveLedgerQuery {
    private readonly tests: Array<(row: LiveLedgerRow) => boolean> = [];
    private readonly sorts: Array<{ column: string; ascending: boolean }> = [];
    private rangeValue: readonly [number, number] | null = null;
    private limitValue: number | null = null;
    private single = false;

    constructor(
      private readonly table: string,
      private readonly tables: Record<string, LiveLedgerRow[]>,
    ) {}

    select(): this {
      return this;
    }

    eq(column: string, value: unknown): this {
      const text = String(value);
      this.tests.push((row) => String(row[column]) === text);
      return this;
    }

    or(expression: string): this {
      const clauses = expression.split(",").map((part) => {
        const [column = "", operator = "", ...rest] = part.split(".");
        return { column, operator, value: rest.join(".") };
      });
      this.tests.push((row) =>
        clauses.some(({ column, operator, value }) => {
          if (operator === "is" && value === "null") return row[column] == null;
          if (operator === "eq") return String(row[column]) === value;
          return false;
        }),
      );
      return this;
    }

    is(column: string, value: unknown): this {
      this.tests.push((row) =>
        value === null ? row[column] == null : String(row[column]) === String(value),
      );
      return this;
    }

    not(column: string, operator: string, value: unknown): this {
      this.tests.push((row) => {
        if (operator === "is" && value === null) return row[column] != null;
        return String(row[column]) !== String(value);
      });
      return this;
    }

    in(column: string, values: readonly unknown[]): this {
      const accepted = new Set(values.map(String));
      this.tests.push((row) => accepted.has(String(row[column])));
      return this;
    }

    gte(column: string, value: unknown): this {
      const text = String(value);
      this.tests.push((row) => String(row[column]) >= text);
      return this;
    }

    lt(column: string, value: unknown): this {
      const text = String(value);
      this.tests.push((row) => String(row[column]) < text);
      return this;
    }

    order(column: string, options?: { ascending?: boolean }): this {
      this.sorts.push({ column, ascending: options?.ascending !== false });
      return this;
    }

    range(from: number, to: number): this {
      this.rangeValue = [from, to];
      return this;
    }

    limit(count: number): this {
      this.limitValue = count;
      return this;
    }

    maybeSingle(): Promise<{ data: unknown; error: unknown }> {
      this.single = true;
      return this.execute();
    }

    then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
      onFulfilled?: (value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>,
      onRejected?: (reason: unknown) => TResult2 | PromiseLike<TResult2>,
    ): Promise<TResult1 | TResult2> {
      return this.execute().then(onFulfilled, onRejected);
    }

    private async execute(): Promise<{ data: unknown; error: unknown }> {
      let rows = [...(this.tables[this.table] ?? [])];
      for (const test of this.tests) rows = rows.filter(test);
      for (const sort of this.sorts) {
        const { column, ascending } = sort;
        rows = [...rows].sort((left, right) => {
          if (String(left[column]) === String(right[column])) return 0;
          const result = String(left[column]) < String(right[column]) ? -1 : 1;
          return ascending ? result : -result;
        });
      }
      if (this.rangeValue) rows = rows.slice(this.rangeValue[0], this.rangeValue[1] + 1);
      if (this.limitValue !== null) rows = rows.slice(0, this.limitValue);
      if (this.single) return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    }
  }

  function fakeLiveClient(options: { definitionId: string | null } = { definitionId: DEFINITION_ID }) {
    const presentDates = [...LIVE_RECENT_DAYS, ...LIVE_MID_DAYS, ...LIVE_OLD_DAYS];
    // Every second day of the trailing 120d window: 60 digest-null rows, the
    // majority the live profile reports (208 of 286).
    const nullDates = dateRange("2026-05-02", "2026-08-29").filter((_, index) => index % 2 === 0);
    const tables: Record<string, LiveLedgerRow[]> = {
      organizations: [{ id: ORG_ID }],
      metric_definitions:
        options.definitionId === null
          ? []
          : [
              {
                id: DEFINITION_ID,
                key: "revenue.gross",
                value_kind: "money",
                aggregation: "sum",
                is_active: true,
                organization_id: null,
              },
            ],
      normalized_metrics: [
        ...presentDates.map((date) => liveRow(date, `live-present-${date}`, FACT_DIGEST)),
        ...nullDates.map((date, index) => liveRow(date, `live-null-${index}`, null)),
      ],
      // The live profile carries zero exact_range rows: the table stays empty.
      exact_range_metric_observations: [],
    };
    const calls: string[] = [];
    const client = {
      from: (table: string) => {
        calls.push(table);
        return new LiveLedgerQuery(table, tables) as unknown as ReturnType<
          SupabaseClient<Database>["from"]
        >;
      },
    } as unknown as SupabaseClient<Database>;
    return { client, calls };
  }

  /**
   * The exact nightly composition minus the database: the real assembly over
   * the real readers, with only the ledger boundary faked. The readers
   * themselves are never stubbed, so their filtering and the fallback ladder
   * run exactly as they would on staging.
   */
  function liveBuildCandidate(client: SupabaseClient<Database>) {
    return async (nightlyMaterial: RevenueScenarioInput, context: GrowthCandidateBuildContext) =>
      assembleLedgerBaselineCandidate(nightlyMaterial, context, {
        resolveRevenueDefinitionId: (organizationId) =>
          resolveGrowthRevenueDefinitionId(client, organizationId),
        listBaselineCoordinates: (coordinateInput) => listBaselineCoordinates(client, coordinateInput),
        readBaselineFacts: (factInput) =>
          createGrowthProgressRepository(client).readRevenueFacts(factInput),
      });
  }

  function liveInput(overrides: Record<string, unknown> = {}) {
    return input({ nowIso: LIVE_NOW_ISO, ...overrides });
  }

  it("publishes due horizons from live-profile baseline facts through the real readers", async () => {
    const { client, calls } = fakeLiveClient();
    const seen: FrozenGrowthProjection[] = [];
    const deps = dependencies({
      buildCandidate: liveBuildCandidate(client),
      publish: vi.fn(async ({ document }: { document: FrozenGrowthProjection }) => {
        // The nightly composition hands the RPC a schema-valid frozen
        // document: the publication boundary revalidates the same shape.
        expect(frozenGrowthProjectionSchema.safeParse(document).success).toBe(true);
        seen.push(document);
        return {
          projectionId: "33333333-3333-4333-8333-333333333333",
          digest: DIGEST,
          published: true,
        };
      }),
    });
    // Bootstrap: zero frozen projections on staging, so all four horizons
    // open at cycle 0 from the next-day origin.
    const result = await publishDueGrowthProjections(liveInput(), deps);

    for (const entry of result.results) {
      expect(entry).toMatchObject({ status: "published", reasonCode: null });
    }
    expect(seen).toHaveLength(4);
    for (const document of seen) {
      // Floor 1 at every rung (ADR 0069): rung 1 builds on its own from its
      // 18 reported days instead of widening — the ladder ran, it was not
      // bypassed, and the first rung with >=1 reported day won.
      expect(document.baselineWindow).toEqual({
        startDate: "2026-07-31",
        endDateExclusive: "2026-08-30",
      });
      expect(document.monthlyLowMinor).toBe(3000000);
      expect(document.monthlyHighMinor).toBe(3000000);
      expect(document.currency).toBe("AED");
      // Published horizons carry scope + provenance to the display layer: the
      // qualifying scope partition, the exact reported-day count with latest
      // date, and the unreconciled share — labelled, never hidden.
      expect(document.scopePartitions).toHaveLength(1);
      expect(document.scopePartitions[0]).toMatchObject({
        partitionKey: "organization-total",
        channelId: null,
        branchId: null,
      });
      expect(document.limitations).toContain(
        "Baseline from 18 reported days (ending 2026-08-29); missing days excluded, monthly pace scaled from the observed daily mean.",
      );
      expect(document.limitations).toContain(
        "Baseline covers 1 of 1 scope partitions: organization-total (18 days ending 2026-08-29).",
      );
      expect(document.limitations).toContain(
        "Baseline includes 15 reported days from unreconciled rows (organization-total (15 days)); treat figures as estimates pending reconciliation.",
      );
      expect(
        document.limitations.some((line) => line.startsWith("Excluded partitions")),
      ).toBe(false);
      expect(document.limitations).toContain("Action impact is not included in this estimate.");
    }
    expect(new Set(seen.map((document) => document.horizonMonths))).toEqual(
      new Set([1, 3, 6, 12]),
    );
    // Proof nothing was bypassed: the run reached the membership probe, the
    // definition registry, and both ledger tables through the real readers.
    expect(new Set(calls)).toEqual(
      new Set([
        "organizations",
        "metric_definitions",
        "normalized_metrics",
        "exact_range_metric_observations",
      ]),
    );
  });

  it("records each horizon's own blocker when some horizons are due and others quiet", async () => {
    const { client } = fakeLiveClient({ definitionId: null });
    const buildCandidate = vi.fn(liveBuildCandidate(client));
    const deps = dependencies({
      readSchedule: vi.fn(
        async (): Promise<GrowthScheduleSnapshot> => ({
          status: "ready",
          origins: ["2026-05-30"],
        }),
      ),
      buildCandidate,
      publish: vi.fn(async () => ({
        projectionId: "33333333-3333-4333-8333-333333333333",
        digest: DIGEST,
        published: true,
      })),
    });
    const result = await publishDueGrowthProjections(liveInput(), deps);

    // Only the 1-month (cycle 3) and 3-month (cycle 1) horizons open a period
    // on 2026-08-30: each due horizon records its own true blocker while the
    // quieter horizons keep theirs — no shared blanket skip.
    expect(result.results[0]).toMatchObject({
      horizonMonths: 1,
      status: "skipped",
      reasonCode: "CANDIDATE_BASELINE_INCOMPLETE",
    });
    expect(result.results[1]).toMatchObject({
      horizonMonths: 3,
      status: "skipped",
      reasonCode: "CANDIDATE_BASELINE_INCOMPLETE",
    });
    expect(result.results.slice(2)).toMatchObject([
      { horizonMonths: 6, status: "skipped", reasonCode: "NOT_DUE" },
      { horizonMonths: 12, status: "skipped", reasonCode: "NOT_DUE" },
    ]);
    expect(buildCandidate).toHaveBeenCalledTimes(2);
    expect(deps.publish).not.toHaveBeenCalled();

    // The refusal names the missing binding, not a vague baseline complaint.
    const direct = await assembleLedgerBaselineCandidate(
      material().input,
      {
        organizationId: ORG_ID,
        scheduleOriginDate: "2026-05-30",
        horizonMonths: 1,
        cycleIndex: 3,
        issuedAt: LIVE_NOW_ISO,
        sourceCutoffDate: LIVE_CUTOFF,
        timeZone: "Asia/Dubai",
      },
      {
        resolveRevenueDefinitionId: (organizationId) =>
          resolveGrowthRevenueDefinitionId(client, organizationId),
        listBaselineCoordinates: (coordinateInput) =>
          listBaselineCoordinates(client, coordinateInput),
        readBaselineFacts: (factInput) =>
          createGrowthProgressRepository(client).readRevenueFacts(factInput),
      },
    );
    expect(direct).toMatchObject({ status: "refused", reason: "BASELINE_INCOMPLETE" });
    if (direct.status === "refused") {
      expect(direct.detail).toContain("revenue definition");
    }
  });

  it("keeps neighboring publications when one horizon's write fails", async () => {
    const { client } = fakeLiveClient();
    const seen: FrozenGrowthProjection[] = [];
    const deps = dependencies({
      buildCandidate: liveBuildCandidate(client),
      publish: vi.fn(async ({ document }: { document: FrozenGrowthProjection }) => {
        seen.push(document);
        return document.horizonMonths === 6
          ? Promise.reject({ code: "PERIOD_ALREADY_STARTED" })
          : {
              projectionId: "33333333-3333-4333-8333-333333333333",
              digest: DIGEST,
              published: true,
            };
      }),
    });
    const result = await publishDueGrowthProjections(liveInput(), deps);

    // One horizon's missed prospective window stands beside neighboring
    // successes, each with its own code — never a shared verdict.
    expect(result.results[0]).toMatchObject({ horizonMonths: 1, status: "published" });
    expect(result.results[1]).toMatchObject({ horizonMonths: 3, status: "published" });
    expect(result.results[2]).toMatchObject({
      horizonMonths: 6,
      status: "failed",
      reasonCode: "PERIOD_ALREADY_STARTED",
    });
    expect(result.results[3]).toMatchObject({ horizonMonths: 12, status: "published" });
    expect(deps.publish).toHaveBeenCalledTimes(4);
    // Mixed horizons differentiate fully: every horizon built the same
    // rung-1 baseline, so each built document carries the scope and
    // provenance coverage — the failed horizon's write code never dilutes it.
    expect(seen).toHaveLength(4);
    for (const document of seen) {
      expect(document.scopePartitions.map((partition) => partition.partitionKey)).toEqual([
        "organization-total",
      ]);
      expect(document.limitations.join(" ")).toContain(
        "Baseline from 18 reported days (ending 2026-08-29)",
      );
      expect(document.limitations.join(" ")).toContain(
        "Baseline covers 1 of 1 scope partitions",
      );
      expect(document.limitations.join(" ")).toContain(
        "Baseline includes 15 reported days from unreconciled rows",
      );
    }
  });
});
