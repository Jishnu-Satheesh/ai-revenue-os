import { describe, expect, it } from "vitest";

import { revenuePeriodMovementDetector } from "@/domain/analysis/detectors/revenue-period-movement";
import { CHANNEL, evidence, OTHER_CHANNEL, point, window } from "@/domain/analysis/test-fixtures";

describe("revenue.period_movement", () => {
  it("computes the movement as the difference in integer minor units", () => {
    const [outcome] = revenuePeriodMovementDetector.run(
      evidence({ points: [point("2026-01-01", 120_000), point("2026-01-02", 90_000)] }),
    );

    expect(outcome.kind).toBe("observation");
    expect(outcome.code).toBe("REVENUE_PERIOD_MOVEMENT_DOWN");
    expect(outcome.kind === "observation" && outcome.measurement).toEqual({
      valueKind: "money",
      numerator: -30_000,
      denominator: 120_000,
      currency: "AED",
      monetaryImpactMinorUnits: -30_000,
    });
    // The later period is the subject and the earlier one is the base, named
    // explicitly so a reader never has to guess which way the difference ran.
    expect(outcome.evidence).toEqual([
      { kind: "normalized_metric", role: "subject_period", id: `metric-2026-01-02-${CHANNEL}` },
      { kind: "normalized_metric", role: "prior_period", id: `metric-2026-01-01-${CHANNEL}` },
    ]);
  });

  it("carries no severity, so no untuned threshold decides how bad a fall is", () => {
    const [outcome] = revenuePeriodMovementDetector.run(
      evidence({ points: [point("2026-01-01", 500_000), point("2026-01-02", 1_000)] }),
    );

    expect(outcome.kind).toBe("observation");
    expect("severity" in outcome).toBe(false);
  });

  it("needs data with fewer than two comparable periods", () => {
    const [outcome] = revenuePeriodMovementDetector.run(
      evidence({ points: [point("2026-01-01", 120_000)] }),
    );

    expect(outcome.kind === "needs_data" && outcome.needsDataReason).toBe(
      "INSUFFICIENT_COMPARABLE_PERIODS",
    );
    // Nothing was set aside, so there is nothing to disclose.
    expect(outcome.qualityState).toBe("complete");
    expect(outcome.limitations).toHaveLength(0);
  });

  it("names the rows it set aside instead of looking like an empty window", () => {
    // Refusing silently over twenty real day rows reads as "there is nothing
    // here", which is the opposite of what happened.
    const [outcome] = revenuePeriodMovementDetector.run(
      evidence({
        window: window({ grain: "month", windowStart: "2026-01-01", windowEnd: "2026-01-31" }),
        points: [point("2026-01-01", 7_000), point("2026-01-02", 1_900)],
      }),
    );

    expect(outcome.kind === "needs_data" && outcome.needsDataReason).toBe(
      "INSUFFICIENT_COMPARABLE_PERIODS",
    );
    expect(outcome.qualityState).toBe("partial");
    expect(outcome.limitations.join(" ")).toMatch(/2 figures .* recorded at day grain/);
  });

  it("refuses to reach past a gap, because an absent period is not a zero", () => {
    const [outcome] = revenuePeriodMovementDetector.run(
      evidence({ points: [point("2026-01-01", 120_000), point("2026-01-04", 90_000)] }),
    );

    expect(outcome.kind === "needs_data" && outcome.needsDataReason).toBe("PRIOR_PERIOD_ABSENT");
    expect(outcome.limitations[0]).toContain("2026-01-03");
  });

  it("refuses two currencies rather than converting them", () => {
    const [outcome] = revenuePeriodMovementDetector.run(
      evidence({
        points: [point("2026-01-01", 120_000), point("2026-01-02", 90_000, { currency: "SAR" })],
      }),
    );

    expect(outcome.kind === "needs_data" && outcome.needsDataReason).toBe("MIXED_CURRENCY");
  });

  it("refuses periods from two channels", () => {
    const [outcome] = revenuePeriodMovementDetector.run(
      evidence({
        window: window({ channelId: null }),
        points: [
          point("2026-01-01", 120_000),
          point("2026-01-02", 90_000, { channelId: OTHER_CHANNEL }),
        ],
      }),
    );

    expect(outcome.kind === "needs_data" && outcome.needsDataReason).toBe("INCOMPARABLE_PERIODS");
  });

  it("compares whole months only against the month before them", () => {
    const [outcome] = revenuePeriodMovementDetector.run(
      evidence({
        window: window({ grain: "month", windowStart: "2026-01-01", windowEnd: "2026-02-28" }),
        points: [
          point("2026-01-01", 1_000_000, { grain: "month", periodEnd: "2026-01-31" }),
          point("2026-02-01", 1_250_000, { grain: "month", periodEnd: "2026-02-28" }),
        ],
      }),
    );

    expect(outcome.code).toBe("REVENUE_PERIOD_MOVEMENT_UP");
    expect(outcome.kind === "observation" && outcome.measurement?.numerator).toBe(250_000);
  });

  it("reports no proportional base when the preceding period recorded zero", () => {
    const [outcome] = revenuePeriodMovementDetector.run(
      evidence({ points: [point("2026-01-01", 0), point("2026-01-02", 40_000)] }),
    );

    expect(outcome.kind === "observation" && outcome.measurement?.denominator).toBeUndefined();
    expect(outcome.limitations.some((line) => line.includes("zero"))).toBe(true);
  });
});

describe("revenue.period_movement over whole periods", () => {
  it("will not compare a week the window only partly covers", () => {
    // A window closing on the twentieth contains the weeks beginning the fifth
    // and the twelfth whole, and only two days of the week beginning the
    // nineteenth. Comparing that stub against a full week would report a
    // collapse in trade that is really a collapse in the question.
    const [outcome] = revenuePeriodMovementDetector.run(
      evidence({
        window: window({ grain: "week", windowStart: "2026-01-01", windowEnd: "2026-01-20" }),
        points: [
          point("2026-01-05", 700_000, { grain: "week", periodEnd: "2026-01-11" }),
          point("2026-01-12", 720_000, { grain: "week", periodEnd: "2026-01-18" }),
          point("2026-01-19", 90_000, { grain: "week", periodEnd: "2026-01-25" }),
        ],
      }),
    );

    expect(outcome.code).toBe("REVENUE_PERIOD_MOVEMENT_UP");
    expect(outcome.kind === "observation" && outcome.measurement?.numerator).toBe(20_000);
    expect(outcome.periodEnd).toBe("2026-01-18");
  });
});
