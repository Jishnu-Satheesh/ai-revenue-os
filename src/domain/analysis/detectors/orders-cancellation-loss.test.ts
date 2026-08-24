import { describe, expect, it } from "vitest";

import { ordersCancellationLossDetector } from "@/domain/analysis/detectors/orders-cancellation-loss";
import { CHANNEL, evidence, point } from "@/domain/analysis/test-fixtures";

function countPoint(metricKey: string, periodStart: string, numerator: number) {
  return point(periodStart, numerator, { metricKey, valueKind: "count", currency: null });
}

describe("orders.cancellation_loss", () => {
  it("reports the avoidable count beside the provider's own rejection loss", () => {
    // The real export's figure: AED 357.00 lost to rejections, which the
    // provider printed itself. In minor units that is 35,700.
    const [outcome] = ordersCancellationLossDetector.run(
      evidence({
        points: [
          countPoint("order.avoidable_cancellation_count", "2026-01-01", 3),
          countPoint("order.avoidable_cancellation_count", "2026-01-02", 4),
          point("2026-01-01", 20_000, { metricKey: "revenue.rejection_loss" }),
          point("2026-01-02", 15_700, { metricKey: "revenue.rejection_loss" }),
        ],
      }),
    );

    expect(outcome.kind).toBe("observation");
    expect(outcome.code).toBe("ORDER_CANCELLATION_LOSS");
    expect(outcome.kind === "observation" && outcome.measurement).toEqual({
      valueKind: "count",
      numerator: 7,
      currency: "AED",
      monetaryImpactMinorUnits: 35_700,
    });
    expect(outcome.limitations.join(" ")).toMatch(/provider's own/);
  });

  it("cites every row behind both figures", () => {
    const [outcome] = ordersCancellationLossDetector.run(
      evidence({
        points: [
          countPoint("order.avoidable_cancellation_count", "2026-01-01", 3),
          point("2026-01-02", 35_700, { metricKey: "revenue.rejection_loss" }),
        ],
      }),
    );

    expect(outcome.evidence).toEqual([
      {
        kind: "normalized_metric",
        role: "component",
        id: `metric-2026-01-01-${CHANNEL}`,
      },
      {
        kind: "normalized_metric",
        role: "component",
        id: `metric-2026-01-02-${CHANNEL}`,
      },
    ]);
  });

  it("needs data when the rejection-loss series is absent", () => {
    // Reporting a count with no declared impact would silently demote the
    // finding out of the cost-led ordering the workspace ranks by.
    const [outcome] = ordersCancellationLossDetector.run(
      evidence({ points: [countPoint("order.avoidable_cancellation_count", "2026-01-01", 3)] }),
    );

    expect(outcome.kind).toBe("needs_data");
    expect(outcome.kind === "needs_data" && outcome.needsDataReason).toBe(
      "CANCELLATION_LOSS_SERIES_ABSENT",
    );
    expect(outcome.limitations.join(" ")).toContain("revenue.rejection_loss");
  });

  it("refuses two currencies rather than converting the provider's loss", () => {
    const [outcome] = ordersCancellationLossDetector.run(
      evidence({
        points: [
          countPoint("order.avoidable_cancellation_count", "2026-01-01", 3),
          point("2026-01-01", 20_000, { metricKey: "revenue.rejection_loss" }),
          point("2026-01-02", 15_700, { metricKey: "revenue.rejection_loss", currency: "SAR" }),
        ],
      }),
    );

    expect(outcome.kind === "needs_data" && outcome.needsDataReason).toBe("MIXED_CURRENCY");
  });

  it("carries no severity, because no threshold prices a cancellation", () => {
    const [outcome] = ordersCancellationLossDetector.run(
      evidence({
        points: [
          countPoint("order.avoidable_cancellation_count", "2026-01-01", 900),
          point("2026-01-01", 5_000_000, { metricKey: "revenue.rejection_loss" }),
        ],
      }),
    );

    expect(outcome.kind).toBe("observation");
    expect("severity" in outcome).toBe(false);
  });
});
