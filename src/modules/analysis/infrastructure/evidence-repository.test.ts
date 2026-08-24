import { describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createChannelAnalysisEvidenceRepository } from "@/modules/analysis/infrastructure/evidence-repository";
import type {
  GovernedMetricObservation,
  GovernedMetricWindowPort,
} from "@/modules/metrics/application/ports";
import type { Database } from "@/lib/supabase/database.types";

vi.mock("server-only", () => ({}));

/**
 * The last hop a dimension label takes before a detector sees it: the analysis
 * evidence loader maps the metrics port's observations, labels included, onto
 * the series points detectors run over (ADR 0034).
 */

type QueryResult = { data: unknown; error: null };

function stubQuery(result: QueryResult) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    lte: () => builder,
    gte: () => builder,
    limit: () => builder,
    then: (
      onFulfilled: (value: QueryResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return builder;
}

function observation(
  overrides: Partial<GovernedMetricObservation> = {},
): GovernedMetricObservation {
  return {
    id: "metric-closed-days-check-in",
    channelId: "channel-1",
    branchId: "branch-1",
    metricKey: "operations.closed_days",
    grain: "day",
    periodStartDate: "2026-01-05",
    periodEndDate: "2026-01-05",
    periodTimezone: "Asia/Dubai",
    valueKind: "count",
    numerator: 39,
    currency: null,
    qualityTier: "measured",
    dimensions: {},
    ...overrides,
  };
}

describe("the channel analysis evidence loader", () => {
  it("hands dimension-tagged rows to detectors with their labels attached", async () => {
    const governedWindow: GovernedMetricWindowPort = {
      async loadGovernedWindow(query) {
        if (query.reconciliationState === "blocked_overlap") return [];
        return [
          observation({
            id: "metric-check-in",
            numerator: 39,
            dimensions: { reason_code: "CHECK_IN_REQUIRED" },
          }),
          observation({
            id: "metric-unreachable",
            numerator: 20,
            dimensions: { reason_code: "UNREACHABLE" },
          }),
        ];
      },
    };
    // Lineage and held-evidence reads return nothing for this window.
    const supabase = {
      from() {
        return stubQuery({ data: [], error: null });
      },
    } as unknown as SupabaseClient<Database>;

    const loaded = await createChannelAnalysisEvidenceRepository(supabase, governedWindow).load({
      window: {
        organizationId: "org-1",
        channelId: "channel-1",
        branchId: "branch-1",
        windowStart: "2026-01-01",
        windowEnd: "2026-01-31",
        grain: "day",
        timeZone: "Asia/Dubai",
      },
      metricKeys: ["operations.closed_days"],
    });

    expect(loaded.points.map((point) => point.dimensions)).toEqual([
      { reason_code: "CHECK_IN_REQUIRED" },
      { reason_code: "UNREACHABLE" },
    ]);
    expect(loaded.points[0]).toMatchObject({
      normalizedMetricId: "metric-check-in",
      metricKey: "operations.closed_days",
      numerator: 39,
    });
  });

  it("leaves ordinary rows carrying no labels at all", async () => {
    const governedWindow: GovernedMetricWindowPort = {
      async loadGovernedWindow(query) {
        if (query.reconciliationState === "blocked_overlap") return [];
        return [observation({ id: "metric-gross", metricKey: "revenue.gross", numerator: 55_300 })];
      },
    };
    const supabase = {
      from() {
        return stubQuery({ data: [], error: null });
      },
    } as unknown as SupabaseClient<Database>;

    const loaded = await createChannelAnalysisEvidenceRepository(supabase, governedWindow).load({
      window: {
        organizationId: "org-1",
        channelId: "channel-1",
        branchId: "branch-1",
        windowStart: "2026-01-01",
        windowEnd: "2026-01-31",
        grain: "day",
        timeZone: "Asia/Dubai",
      },
      metricKeys: ["revenue.gross"],
    });

    // A figure without a category carries no dimensions, which is not the
    // same as dimensions nobody has read yet.
    expect(loaded.points[0].dimensions).toEqual({});
  });
});
