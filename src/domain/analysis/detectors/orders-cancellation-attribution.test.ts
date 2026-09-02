import { describe, expect, it } from "vitest";

import { ordersCancellationAttributionDetector } from "@/domain/analysis/detectors/orders-cancellation-attribution";
import { evidence, point } from "@/domain/analysis/test-fixtures";
import type { AnalysisSeriesPoint, DetectorOutcome } from "@/domain/analysis/types";

/**
 * Whose cancellations these are.
 *
 * The detector reads counts the provider itself attributed and states the
 * proportions between them. What it must never do is recognise a party: the
 * vocabulary arrives through a provider's approved label map, so a core
 * detector that branched on "merchant" would be treating one marketplace's
 * words as the platform's own.
 */

const run = (points: readonly AnalysisSeriesPoint[]): readonly DetectorOutcome[] =>
  ordersCancellationAttributionDetector.run(evidence({ points: [...points] }));

function attribution(
  periodStart: string,
  count: number,
  party: string,
  overrides: Partial<AnalysisSeriesPoint> = {},
): AnalysisSeriesPoint {
  return point(periodStart, count, {
    normalizedMetricId: `attribution-${periodStart}-${party}`,
    metricKey: "order.cancellation_attribution_count",
    valueKind: "count",
    currency: null,
    dimensions: { cancelled_by: party },
    ...overrides,
  });
}

function orders(periodStart: string, count: number): AnalysisSeriesPoint {
  return point(periodStart, count, {
    normalizedMetricId: `orders-${periodStart}`,
    metricKey: "order.total_count",
    valueKind: "count",
    currency: null,
  });
}

const codes = (outcomes: readonly DetectorOutcome[]): string[] =>
  outcomes.map((outcome) => outcome.code);

describe("reporting who cancelled", () => {
  it("refuses when no approved report attributes a cancellation", () => {
    const outcomes = run([point("2026-01-01", 120_000)]);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      kind: "needs_data",
      needsDataReason: "CANCELLATION_ATTRIBUTION_SERIES_ABSENT",
    });
  });

  it("refuses when nothing carries the declared party dimension", () => {
    // A count with no party is a cancellation total, which another detector
    // already reports. Grouping it under an invented party would be worse.
    const outcomes = run([attribution("2026-01-01", 3, "MERCHANT", { dimensions: {} })]);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      kind: "needs_data",
      needsDataReason: "CANCELLATION_ATTRIBUTION_UNDIMENSIONED",
    });
  });

  it("states the window's attributed total", () => {
    const outcomes = run([
      attribution("2026-01-01", 3, "MERCHANT"),
      attribution("2026-01-02", 2, "MERCHANT"),
      attribution("2026-01-02", 1, "PLATFORM"),
    ]);

    expect(outcomes[0]).toMatchObject({
      code: "ORDER_CANCELLATION_ATTRIBUTION_TOTAL",
      measurement: { valueKind: "count", numerator: 6 },
    });
  });

  it("ranks each party by how much of the window it accounts for", () => {
    const outcomes = run([
      attribution("2026-01-01", 1, "PLATFORM"),
      attribution("2026-01-01", 7, "MERCHANT"),
      attribution("2026-01-01", 2, "CUSTOMER_SERVICE"),
    ]);
    const parties = outcomes.filter(
      (outcome) => outcome.code === "ORDER_CANCELLATION_ATTRIBUTION_PARTY",
    );

    expect(
      parties.map((outcome) => (outcome.kind === "observation" ? outcome.measurement : null)),
    ).toEqual([
      { valueKind: "ratio", numerator: 7, denominator: 10 },
      { valueKind: "ratio", numerator: 2, denominator: 10 },
      { valueKind: "ratio", numerator: 1, denominator: 10 },
    ]);
  });

  it("measures attributions against the orders the channel took", () => {
    const outcomes = run([
      attribution("2026-01-01", 3, "MERCHANT"),
      orders("2026-01-01", 12),
    ]);

    expect(
      outcomes.find(
        (outcome) => outcome.code === "ORDER_CANCELLATION_ATTRIBUTION_SHARE_OF_ORDERS",
      ),
    ).toMatchObject({ measurement: { valueKind: "ratio", numerator: 3, denominator: 12 } });
  });

  it("reads the share over the days carrying both, and says how many that was", () => {
    // An attribution count over two days divided by an order count over one is
    // a rate roughly twice the truth, from two figures each individually right.
    const outcomes = run([
      attribution("2026-01-01", 3, "MERCHANT"),
      attribution("2026-01-02", 5, "MERCHANT"),
      orders("2026-01-01", 12),
    ]);
    const share = outcomes.find(
      (outcome) => outcome.code === "ORDER_CANCELLATION_ATTRIBUTION_SHARE_OF_ORDERS",
    );

    expect(share).toMatchObject({ measurement: { numerator: 3, denominator: 12 } });
    expect(share?.limitations[0]).toContain("1 day(s) carrying both");
  });

  it("omits the share entirely when no approved report counts the orders", () => {
    // Silence rather than a denominator nobody reported.
    const outcomes = run([attribution("2026-01-01", 3, "MERCHANT")]);

    expect(codes(outcomes)).toEqual([
      "ORDER_CANCELLATION_ATTRIBUTION_TOTAL",
      "ORDER_CANCELLATION_ATTRIBUTION_PARTY",
    ]);
  });

  it("omits the share when the orders it would divide by are zero", () => {
    const outcomes = run([attribution("2026-01-01", 3, "MERCHANT"), orders("2026-01-01", 0)]);

    expect(codes(outcomes)).not.toContain("ORDER_CANCELLATION_ATTRIBUTION_SHARE_OF_ORDERS");
  });

  it("says the attributed count is not the cancelled-order count", () => {
    // A partially refunded order carries a party while the provider still
    // counts it as fulfilled, so the two figures will disagree and a reader
    // has to be told why before they notice it themselves.
    const outcomes = run([attribution("2026-01-01", 3, "MERCHANT")]);

    expect(outcomes[0]?.limitations.join(" ")).toContain("partially refunded");
  });

  it("claims no money for a cancellation nobody priced", () => {
    expect(ordersCancellationAttributionDetector.monetaryImpact.computable).toBe(false);
    const outcomes = run([attribution("2026-01-01", 3, "MERCHANT"), orders("2026-01-01", 12)]);
    for (const outcome of outcomes) {
      if (outcome.kind !== "observation") continue;
      expect(outcome.measurement?.monetaryImpactMinorUnits).toBe(undefined);
    }
  });
});
