import { describe, expect, it } from "vitest";

import { economicsChannelCostLoadDetector } from "@/domain/analysis/detectors/economics-channel-cost-load";
import { economicsCommissionShareDetector } from "@/domain/analysis/detectors/economics-commission-share";
import { evidence, point } from "@/domain/analysis/test-fixtures";

function cost(metricKey: string, periodStart: string, minorUnits: number) {
  return point(periodStart, minorUnits, {
    metricKey,
    currency: "AED",
    normalizedMetricId: `${metricKey}-${periodStart}`,
  });
}
function revenue(periodStart: string, minorUnits: number) {
  return cost("revenue.gross", periodStart, minorUnits);
}

const ratio = (outcome: unknown) => {
  const measurement = (outcome as { measurement: { numerator: number; denominator: number } })
    .measurement;
  return measurement.numerator / measurement.denominator;
};
const limitations = (outcome: unknown) => (outcome as { limitations: string[] }).limitations;

describe("economics.channel_cost_load", () => {
  it("adds every merchant-borne deduction against the revenue it was charged on", () => {
    const [outcome] = economicsChannelCostLoadDetector.run(
      evidence({
        points: [
          revenue("2026-01-01", 100_000),
          cost("cost.commission", "2026-01-01", 20_000),
          cost("cost.payment_processing", "2026-01-01", 2_000),
          cost("cost.equipment_fee", "2026-01-01", 5_000),
          cost("promotion.funding", "2026-01-01", 3_000),
        ],
      }),
    );

    expect(outcome).toMatchObject({
      kind: "observation",
      code: "CHANNEL_COST_LOAD_OF_REVENUE",
      measurement: {
        valueKind: "ratio",
        numerator: 30_000,
        denominator: 100_000,
        currency: "AED",
      },
      observedPeriodCount: 1,
      expectedPeriodCount: 1,
    });
  });

  it("parts company with the commission rate by the size of what commission omits", () => {
    // The shape a real marketplace statement of account showed: commission is
    // the largest deduction and about half of the whole bill. Both detectors
    // are correct on the same evidence, which is exactly the danger -- an
    // operator told only the narrower figure prices against half a cost.
    const points = [
      revenue("2026-01-01", 500_000),
      cost("cost.commission", "2026-01-01", 110_000),
      cost("cost.payment_processing", "2026-01-01", 9_000),
      cost("cost.equipment_fee", "2026-01-01", 40_000),
      cost("promotion.funding", "2026-01-01", 46_000),
    ];

    const [load] = economicsChannelCostLoadDetector.run(evidence({ points }));
    const [commissionOnly] = economicsCommissionShareDetector.run(evidence({ points }));

    expect(ratio(commissionOnly)).toBeCloseTo(0.22, 2);
    expect(ratio(load)).toBeCloseTo(0.41, 2);
    expect(ratio(load)).toBeGreaterThan(ratio(commissionOnly) * 1.8);
  });

  it("names the cost lines it read, so a partial figure cannot read as a total", () => {
    const [outcome] = economicsChannelCostLoadDetector.run(
      evidence({
        points: [revenue("2026-01-01", 100_000), cost("cost.commission", "2026-01-01", 20_000)],
      }),
    );

    expect(limitations(outcome)[0]).toBe("Read from 1 cost line(s): commission.");
    expect(limitations(outcome).join(" ")).toContain("the figure is a floor");
  });

  it("leaves out the promotion the marketplace funded, which the restaurant never paid", () => {
    const [outcome] = economicsChannelCostLoadDetector.run(
      evidence({
        points: [
          revenue("2026-01-01", 100_000),
          cost("cost.commission", "2026-01-01", 20_000),
          cost("promotion.provider_subsidy", "2026-01-01", 90_000),
        ],
      }),
    );

    expect((outcome as { measurement: { numerator: number } }).measurement.numerator).toBe(20_000);
    expect(limitations(outcome)[0]).not.toContain("marketplace");
  });

  it("ignores a cost charged on a period revenue never covered", () => {
    // Keeta again: commission runs across two months and the billing report
    // covers one. A February cost divided by January revenue is not a rate.
    const [outcome] = economicsChannelCostLoadDetector.run(
      evidence({
        points: [
          revenue("2026-01-01", 100_000),
          cost("cost.commission", "2026-01-01", 20_000),
          cost("cost.commission", "2026-02-01", 90_000),
        ],
      }),
    );

    expect((outcome as { measurement: { numerator: number } }).measurement.numerator).toBe(20_000);
  });

  it("counts only the revenue of periods that carry a cost, and says how many", () => {
    // Dividing one day's cost by two days' revenue halves the reported load
    // and looks careful doing it.
    const [outcome] = economicsChannelCostLoadDetector.run(
      evidence({
        points: [
          revenue("2026-01-01", 100_000),
          revenue("2026-01-02", 100_000),
          cost("cost.commission", "2026-01-01", 20_000),
        ],
      }),
    );

    expect(outcome).toMatchObject({
      measurement: { numerator: 20_000, denominator: 100_000 },
      observedPeriodCount: 1,
      expectedPeriodCount: 2,
    });
    expect(limitations(outcome)[1]).toBe(
      "Read over the 1 period(s) carrying both revenue and a cost, out of 2 carrying either.",
    );
  });

  it("cites every cost row and the revenue rows it was divided by", () => {
    const [outcome] = economicsChannelCostLoadDetector.run(
      evidence({
        points: [
          revenue("2026-01-01", 100_000),
          cost("cost.commission", "2026-01-01", 20_000),
          cost("cost.payment_processing", "2026-01-01", 2_000),
        ],
      }),
    );

    const cited = (outcome as { evidence: readonly { role: string; id: string }[] }).evidence;
    expect(cited.filter((item) => item.role === "component")).toHaveLength(2);
    expect(cited.filter((item) => item.role === "denominator")).toHaveLength(1);
  });

  it("refuses when no approved report writes any cost", () => {
    const [outcome] = economicsChannelCostLoadDetector.run(
      evidence({ points: [revenue("2026-01-01", 100_000)] }),
    );

    expect(outcome).toMatchObject({
      kind: "needs_data",
      code: "CHANNEL_COST_LOAD_UNAVAILABLE",
      needsDataReason: "COST_SERIES_ABSENT",
    });
  });

  it("refuses without revenue to divide by", () => {
    const [outcome] = economicsChannelCostLoadDetector.run(
      evidence({ points: [cost("cost.commission", "2026-01-01", 20_000)] }),
    );

    expect(outcome).toMatchObject({ needsDataReason: "REVENUE_SERIES_ABSENT" });
  });

  it("refuses to divide figures in different currencies", () => {
    const [outcome] = economicsChannelCostLoadDetector.run(
      evidence({
        points: [
          revenue("2026-01-01", 100_000),
          point("2026-01-01", 20_000, {
            metricKey: "cost.commission",
            currency: "USD",
            normalizedMetricId: "usd-commission",
          }),
        ],
      }),
    );

    expect(outcome).toMatchObject({ needsDataReason: "MIXED_CURRENCY" });
  });

  it("refuses a share of no revenue, which is undefined rather than zero", () => {
    const [outcome] = economicsChannelCostLoadDetector.run(
      evidence({
        points: [revenue("2026-01-01", 0), cost("cost.commission", "2026-01-01", 20_000)],
      }),
    );

    expect(outcome).toMatchObject({ needsDataReason: "REVENUE_NOT_POSITIVE" });
  });

  it("has nothing to say about a span, which has no periods to line up", () => {
    expect(economicsChannelCostLoadDetector.exactRangeEvidence).toBe("refused");
    expect(economicsChannelCostLoadDetector.compatibleGrains).not.toContain("span");
  });
});
