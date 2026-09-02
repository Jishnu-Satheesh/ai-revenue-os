import { describe, expect, it } from "vitest";

import { customerNewShareDetector } from "@/domain/analysis/detectors/customer-new-share";
import { CHANNEL, evidence, point } from "@/domain/analysis/test-fixtures";

function countPoint(metricKey: string, periodStart: string, numerator: number) {
  return point(periodStart, numerator, { metricKey, valueKind: "count", currency: null });
}

describe("customer.new_share", () => {
  it("computes the repeat share as returning orders over all reported orders", () => {
    // The real export's mix: 25 new and 1 returning order, so the repeat
    // share is 1 in 26.
    const [outcome] = customerNewShareDetector.run(
      evidence({
        points: [
          countPoint("customer.new_order_count", "2026-01-01", 10),
          countPoint("customer.new_order_count", "2026-01-02", 15),
          countPoint("customer.returning_order_count", "2026-01-01", 1),
        ],
      }),
    );

    expect(outcome.kind).toBe("observation");
    expect(outcome.code).toBe("CUSTOMER_REPEAT_SHARE");
    expect(outcome.kind === "observation" && outcome.measurement).toEqual({
      valueKind: "ratio",
      numerator: 1,
      denominator: 26,
    });
  });

  it("cites both series it summed", () => {
    const [outcome] = customerNewShareDetector.run(
      evidence({
        points: [
          countPoint("customer.new_order_count", "2026-01-01", 25),
          countPoint("customer.returning_order_count", "2026-01-02", 1),
        ],
      }),
    );

    expect(outcome.evidence).toEqual([
      { kind: "normalized_metric", role: "component", id: `metric-2026-01-01-${CHANNEL}` },
      { kind: "normalized_metric", role: "component", id: `metric-2026-01-02-${CHANNEL}` },
    ]);
  });

  it("needs data when either side of the mix is absent", () => {
    const [outcome] = customerNewShareDetector.run(
      evidence({ points: [countPoint("customer.new_order_count", "2026-01-01", 25)] }),
    );

    expect(outcome.kind).toBe("needs_data");
    expect(outcome.kind === "needs_data" && outcome.needsDataReason).toBe(
      "CUSTOMER_MIX_SERIES_ABSENT",
    );
    expect(outcome.limitations.join(" ")).toContain("customer.returning_order_count");
  });

  it("refuses a share of nothing when every count is zero", () => {
    // A window of zeros has no mix. Zero percent would read as "nobody came
    // back" over what is really "nobody ordered".
    const [outcome] = customerNewShareDetector.run(
      evidence({
        points: [
          countPoint("customer.new_order_count", "2026-01-01", 0),
          countPoint("customer.returning_order_count", "2026-01-01", 0),
        ],
      }),
    );

    expect(outcome.kind === "needs_data" && outcome.needsDataReason).toBe(
      "CUSTOMER_ORDER_TOTAL_IS_ZERO",
    );
  });

  it("carries no severity, because no threshold makes a repeat share a problem", () => {
    const [outcome] = customerNewShareDetector.run(
      evidence({
        points: [
          countPoint("customer.new_order_count", "2026-01-01", 1),
          countPoint("customer.returning_order_count", "2026-01-01", 99),
        ],
      }),
    );

    expect(outcome.kind).toBe("observation");
    expect("severity" in outcome).toBe(false);
  });
});
