import { describe, expect, it } from "vitest";

import { funnelStageConversionDetector } from "@/domain/analysis/detectors/funnel-stage-conversion";
import type { AnalysisSeriesPoint } from "@/domain/analysis/types";
import { CHANNEL, evidence, point } from "@/domain/analysis/test-fixtures";

function countPoint(
  metricKey: string,
  periodStart: string,
  numerator: number,
  overrides: Partial<AnalysisSeriesPoint> = {},
) {
  return point(periodStart, numerator, {
    metricKey,
    valueKind: "count",
    currency: null,
    ...overrides,
  });
}

describe("funnel.stage_conversion", () => {
  it("computes each stage pair and the end-to-end span as summed fractions", () => {
    const outcomes = funnelStageConversionDetector.run(
      evidence({
        points: [
          // The figures the real Talabat export produced: 18,294 impressions,
          // 949 menu views, 59 carts, 24 orders -- split across days so the
          // sums are exercised rather than single rows.
          countPoint("listing.impressions", "2026-01-01", 9_000),
          countPoint("listing.impressions", "2026-01-02", 9_294),
          countPoint("listing.menu_views", "2026-01-02", 949),
          countPoint("listing.cart_additions", "2026-01-03", 59),
          countPoint("listing.placed_orders", "2026-01-04", 24),
        ],
      }),
    );

    expect(outcomes.map((outcome) => outcome.code)).toEqual([
      "FUNNEL_STAGE_CONVERSION",
      "FUNNEL_STAGE_CONVERSION",
      "FUNNEL_STAGE_CONVERSION",
      "FUNNEL_STAGE_CONVERSION_END_TO_END",
    ]);
    const [viewsOverImpressions, cartOverViews, ordersOverCarts, endToEnd] = outcomes;
    expect(viewsOverImpressions.kind === "observation" && viewsOverImpressions.measurement).toEqual(
      {
        valueKind: "ratio",
        numerator: 949,
        denominator: 18_294,
      },
    );
    expect(cartOverViews.kind === "observation" && cartOverViews.measurement).toEqual({
      valueKind: "ratio",
      numerator: 59,
      denominator: 949,
    });
    expect(ordersOverCarts.kind === "observation" && ordersOverCarts.measurement).toEqual({
      valueKind: "ratio",
      numerator: 24,
      denominator: 59,
    });
    expect(endToEnd.kind === "observation" && endToEnd.measurement).toEqual({
      valueKind: "ratio",
      numerator: 24,
      denominator: 18_294,
    });
  });

  it("cites every row it summed, denominators under their own role", () => {
    const [outcome] = funnelStageConversionDetector.run(
      evidence({
        points: [
          countPoint("listing.impressions", "2026-01-01", 9_000),
          countPoint("listing.impressions", "2026-01-02", 9_294),
          countPoint("listing.menu_views", "2026-01-02", 949),
          countPoint("listing.cart_additions", "2026-01-03", 59),
          countPoint("listing.placed_orders", "2026-01-04", 24),
        ],
      }),
    );

    expect(outcome.evidence).toEqual([
      {
        kind: "normalized_metric",
        role: "component",
        id: `metric-2026-01-02-${CHANNEL}`,
      },
      {
        kind: "normalized_metric",
        role: "denominator",
        id: `metric-2026-01-01-${CHANNEL}`,
      },
      {
        kind: "normalized_metric",
        role: "denominator",
        id: `metric-2026-01-02-${CHANNEL}`,
      },
    ]);
  });

  it("reports one refusal, not several, when the top of the funnel is missing", () => {
    const [outcome] = funnelStageConversionDetector.run(
      evidence({
        points: [countPoint("listing.menu_views", "2026-01-02", 949)],
      }),
    );

    expect(outcome.kind).toBe("needs_data");
    expect(outcome.kind === "needs_data" && outcome.needsDataReason).toBe(
      "IMPRESSION_SERIES_ABSENT",
    );
    expect(outcome.limitations.join(" ")).toContain("listing.impressions");
    expect(outcome.evidence).toHaveLength(0);
  });

  it("answers the pairs it can and names the ones it cannot", () => {
    // No cart additions reported. Views over impressions and orders over
    // impressions are still defined; both pairs touching the cart refuse by
    // name rather than silently skipping a step.
    const outcomes = funnelStageConversionDetector.run(
      evidence({
        points: [
          countPoint("listing.impressions", "2026-01-01", 18_294),
          countPoint("listing.menu_views", "2026-01-02", 949),
          countPoint("listing.placed_orders", "2026-01-04", 24),
        ],
      }),
    );

    expect(outcomes).toHaveLength(4);
    const refusals = outcomes.filter((outcome) => outcome.kind === "needs_data");
    expect(refusals).toHaveLength(2);
    // Each refusal names its own pair's missing numerator series.
    expect(refusals.map((refusal) => refusal.metricKey)).toEqual([
      "listing.cart_additions",
      "listing.placed_orders",
    ]);
    for (const refusal of refusals) {
      expect(refusal.kind === "needs_data" && refusal.needsDataReason).toBe("STAGE_SERIES_ABSENT");
    }
    const answered = outcomes.filter((outcome) => outcome.kind === "observation");
    expect(answered.map((outcome) => outcome.code)).toEqual([
      "FUNNEL_STAGE_CONVERSION",
      "FUNNEL_STAGE_CONVERSION_END_TO_END",
    ]);
  });

  it("carries no severity, because no threshold makes a conversion a problem", () => {
    const [outcome] = funnelStageConversionDetector.run(
      evidence({
        points: [
          countPoint("listing.impressions", "2026-01-01", 18_294),
          countPoint("listing.menu_views", "2026-01-02", 949),
          countPoint("listing.cart_additions", "2026-01-03", 59),
          countPoint("listing.placed_orders", "2026-01-04", 24),
        ],
      }),
    );

    expect(outcome.kind).toBe("observation");
    expect("severity" in outcome).toBe(false);
  });

  it("says the answer is partial when some rows were set aside as incomparable", () => {
    const [outcome] = funnelStageConversionDetector.run(
      evidence({
        points: [
          countPoint("listing.impressions", "2026-01-01", 18_294),
          countPoint("listing.impressions", "2026-01-02", 500, { periodTimezone: "Asia/Riyadh" }),
          countPoint("listing.menu_views", "2026-01-02", 949),
          countPoint("listing.cart_additions", "2026-01-03", 59),
          countPoint("listing.placed_orders", "2026-01-04", 24),
        ],
      }),
    );

    expect(outcome.qualityState).toBe("partial");
    expect(outcome.limitations.join(" ")).toMatch(/set aside/);
    expect(outcome.kind === "observation" && outcome.measurement?.denominator).toBe(18_294);
  });
});
