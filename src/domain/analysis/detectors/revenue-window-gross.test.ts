import { describe, expect, it } from "vitest";

import { revenueWindowGrossDetector } from "@/domain/analysis/detectors/revenue-window-gross";
import {
  CHANNEL,
  OTHER_CHANNEL,
  evidence,
  exactRangePoint,
  point,
} from "@/domain/analysis/test-fixtures";

describe("revenue.window_gross", () => {
  it("stores the channel's reported gross revenue with coverage and every source row", () => {
    const [outcome] = revenueWindowGrossDetector.run(
      evidence({
        points: [point("2026-01-01", 55_300), point("2026-01-02", 35_700)],
      }),
    );

    expect(outcome).toMatchObject({
      kind: "observation",
      code: "WINDOW_GROSS_REVENUE",
      channelId: CHANNEL,
      metricKey: "revenue.gross",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-05",
      measurement: { valueKind: "money", numerator: 91_000, currency: "AED" },
      expectedPeriodCount: 5,
      observedPeriodCount: 2,
      absentPeriodCount: 3,
    });
    expect(outcome.evidence).toEqual([
      { kind: "normalized_metric", role: "component", id: `metric-2026-01-01-${CHANNEL}` },
      { kind: "normalized_metric", role: "component", id: `metric-2026-01-02-${CHANNEL}` },
    ]);
  });

  it("refuses a gross-revenue total that would combine currencies", () => {
    const [outcome] = revenueWindowGrossDetector.run(
      evidence({
        points: [point("2026-01-01", 55_300), point("2026-01-02", 35_700, { currency: "SAR" })],
      }),
    );

    expect(outcome.kind).toBe("needs_data");
    expect(outcome.kind === "needs_data" && outcome.needsDataReason).toBe("MIXED_CURRENCY");
    expect(outcome.evidence).toHaveLength(0);
  });

  it("does not invent a gross-revenue figure when no governed row is available", () => {
    const [outcome] = revenueWindowGrossDetector.run(evidence({ points: [] }));

    expect(outcome.kind).toBe("needs_data");
    expect(outcome.kind === "needs_data" && outcome.needsDataReason).toBe(
      "NO_GOVERNED_EVIDENCE_IN_WINDOW",
    );
  });
});

describe("revenue.window_gross over a provider's own span total", () => {
  it("answers from one exact total when the provider reports no series", () => {
    // Noon and EatEasily state a figure for the range their export covers and
    // never a row per day. Refusing it leaves a channel with a real, cited
    // revenue figure showing nothing at all.
    const [outcome] = revenueWindowGrossDetector.run(
      evidence({
        points: [],
        exactRangePoints: [exactRangePoint({ numerator: 91_000 })],
      }),
    );

    expect(outcome).toMatchObject({
      kind: "observation",
      code: "WINDOW_GROSS_REVENUE",
      measurement: { valueKind: "money", numerator: 91_000, currency: "AED" },
    });
    expect(outcome.evidence).toEqual([
      {
        kind: "exact_range_metric_observation",
        role: "component",
        id: `exact-revenue.gross-${CHANNEL}`,
      },
    ]);
  });

  it("states no period coverage for a span nobody broke into periods", () => {
    // A span total says nothing about which days traded. Reporting "1 of 5
    // days observed" would invent a fact the export never carried.
    const [outcome] = revenueWindowGrossDetector.run(
      evidence({ points: [], exactRangePoints: [exactRangePoint()] }),
    );

    expect(outcome.kind).toBe("observation");
    expect(outcome.observedPeriodCount).toBeUndefined();
    expect(outcome.absentPeriodCount).toBeUndefined();
  });

  it("refuses a total whose dates are not the window it was asked about", () => {
    // A January-to-February figure cannot answer January. Cutting it down would
    // be proration, which nobody reported and nobody approved.
    const [outcome] = revenueWindowGrossDetector.run(
      evidence({
        points: [],
        exactRangePoints: [exactRangePoint({ periodStart: "2026-01-01", periodEnd: "2026-02-28" })],
      }),
    );

    expect(outcome.kind).toBe("needs_data");
    expect(outcome.kind === "needs_data" && outcome.needsDataReason).toBe(
      "EXACT_RANGE_WINDOW_MISMATCH",
    );
  });

  it("refuses to mix a span total with a series rather than choosing one", () => {
    // Both shapes present means two sources answering the same question. Adding
    // them double-counts and picking one silently discards governed evidence.
    const [outcome] = revenueWindowGrossDetector.run(
      evidence({
        points: [point("2026-01-01", 55_300)],
        exactRangePoints: [exactRangePoint()],
      }),
    );

    expect(outcome.kind).toBe("needs_data");
    expect(outcome.kind === "needs_data" && outcome.needsDataReason).toBe(
      "EXACT_RANGE_AND_SERIES_BOTH_PRESENT",
    );
  });

  it("refuses more than one total for the same window", () => {
    const [outcome] = revenueWindowGrossDetector.run(
      evidence({
        points: [],
        exactRangePoints: [
          exactRangePoint({ exactRangeMetricObservationId: "a" }),
          exactRangePoint({ exactRangeMetricObservationId: "b" }),
        ],
      }),
    );

    expect(outcome.kind).toBe("needs_data");
    expect(outcome.kind === "needs_data" && outcome.needsDataReason).toBe(
      "EXACT_RANGE_NOT_SINGULAR",
    );
  });

  it("ignores a total for another channel", () => {
    const [outcome] = revenueWindowGrossDetector.run(
      evidence({
        points: [],
        exactRangePoints: [exactRangePoint({ channelId: OTHER_CHANNEL })],
      }),
    );

    expect(outcome.kind).toBe("needs_data");
    expect(outcome.kind === "needs_data" && outcome.needsDataReason).toBe(
      "NO_GOVERNED_EVIDENCE_IN_WINDOW",
    );
  });
});
