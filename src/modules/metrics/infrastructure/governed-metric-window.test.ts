import { describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createGovernedMetricWindowRepository } from "@/modules/metrics/infrastructure/repository";
import type { Database } from "@/lib/supabase/database.types";

vi.mock("server-only", () => ({}));

/**
 * The governed-window read is the boundary where the ledger's jsonb `dimensions`
 * column becomes a typed record a detector may group by (ADR 0034). These tests
 * stub the PostgREST chain at exactly that boundary.
 */

type QueryResult = { data: unknown; error: null };

function stubQuery(result: QueryResult) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    or: () => builder,
    order: () => builder,
    limit: () => builder,
    in: () => builder,
    is: () => builder,
    not: () => builder,
    gte: () => builder,
    lt: () => builder,
    maybeSingle: async () => result,
    then: (
      onFulfilled: (value: QueryResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return builder;
}

const DEFINITION_ROW = {
  id: "def-closed-days",
  key: "operations.closed_days",
  value_kind: "count",
  aggregation: "sum",
  percentile_p: null,
  is_active: true,
};

/** Local midnight on 2026-01-05 in Dubai, as Postgres would hand it over. */
const PERIOD_START_INSTANT = "2026-01-04T20:00:00Z";
/** The exclusive next local midnight. */
const PERIOD_END_INSTANT = "2026-01-05T20:00:00Z";

describe("the governed metric window loader", () => {
  it("carries dimension-tagged rows through with their labels intact", async () => {
    const rows = [
      {
        id: "metric-check-in",
        channel_id: "channel-1",
        branch_id: "branch-1",
        metric_definition_id: "def-closed-days",
        period_grain: "day",
        period_start: PERIOD_START_INSTANT,
        period_end: PERIOD_END_INSTANT,
        period_timezone: "Asia/Dubai",
        value_kind: "count",
        value_numerator: "39",
        currency: null,
        quality_tier: "measured",
        dimensions: { reason_code: "CHECK_IN_REQUIRED" },
      },
      {
        id: "metric-unreachable",
        channel_id: "channel-1",
        branch_id: "branch-1",
        metric_definition_id: "def-closed-days",
        period_grain: "day",
        period_start: PERIOD_START_INSTANT,
        period_end: PERIOD_END_INSTANT,
        period_timezone: "Asia/Dubai",
        value_kind: "count",
        value_numerator: "20",
        currency: null,
        quality_tier: "measured",
        dimensions: { reason_code: "UNREACHABLE" },
      },
    ];
    const supabase = {
      from(table: string) {
        return table === "metric_definitions"
          ? stubQuery({ data: DEFINITION_ROW, error: null })
          : stubQuery({ data: rows, error: null });
      },
    } as unknown as SupabaseClient<Database>;

    const observations = await createGovernedMetricWindowRepository(supabase).loadGovernedWindow({
      organizationId: "org-1",
      metricKeys: ["operations.closed_days"],
      windowStart: "2026-01-01",
      windowEnd: "2026-01-31",
      timeZone: "Asia/Dubai",
    });

    expect(observations.map((observation) => observation.id)).toEqual([
      "metric-check-in",
      "metric-unreachable",
    ]);
    // The label rides beside the figure it describes, which is what lets a
    // detector group by reason without a second read.
    expect(observations[0].dimensions).toEqual({ reason_code: "CHECK_IN_REQUIRED" });
    expect(observations[0].numerator).toBe(39);
    expect(observations[1].dimensions).toEqual({ reason_code: "UNREACHABLE" });
  });

  it("drops dimension values it cannot read as flat string labels", async () => {
    // jsonb is untyped from this side. A nested or non-string value is not a
    // label a detector may group by, so it is dropped rather than trusted --
    // and an ordinary numeric row carries no dimensions at all.
    const rows = [
      {
        id: "metric-nested",
        channel_id: "channel-1",
        branch_id: null,
        metric_definition_id: "def-closed-days",
        period_grain: "day",
        period_start: PERIOD_START_INSTANT,
        period_end: PERIOD_END_INSTANT,
        period_timezone: "Asia/Dubai",
        value_kind: "count",
        value_numerator: "7",
        currency: null,
        quality_tier: "measured",
        dimensions: { reason_code: { injected: "object" }, note: null, keep: "fine" },
      },
      {
        id: "metric-plain",
        channel_id: "channel-1",
        branch_id: null,
        metric_definition_id: "def-closed-days",
        period_grain: "day",
        period_start: PERIOD_START_INSTANT,
        period_end: PERIOD_END_INSTANT,
        period_timezone: "Asia/Dubai",
        value_kind: "count",
        value_numerator: "3",
        currency: null,
        quality_tier: "measured",
        dimensions: null,
      },
    ];
    const supabase = {
      from(table: string) {
        return table === "metric_definitions"
          ? stubQuery({ data: DEFINITION_ROW, error: null })
          : stubQuery({ data: rows, error: null });
      },
    } as unknown as SupabaseClient<Database>;

    const observations = await createGovernedMetricWindowRepository(supabase).loadGovernedWindow({
      organizationId: "org-1",
      metricKeys: ["operations.closed_days"],
      windowStart: "2026-01-01",
      windowEnd: "2026-01-31",
      timeZone: "Asia/Dubai",
    });

    expect(observations[0].dimensions).toEqual({ keep: "fine" });
    expect(observations[1].dimensions).toEqual({});
  });
});
