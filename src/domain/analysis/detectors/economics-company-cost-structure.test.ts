import { describe, expect, it } from "vitest";

import { economicsCompanyCostStructureDetector } from "@/domain/analysis/detectors/economics-company-cost-structure";
import { evidence, point, window } from "@/domain/analysis/test-fixtures";

/**
 * A monthly window, because that is the grain a set of books is kept at. The
 * default fixture window is five days in January and would exclude every point
 * below.
 */
const MONTHS = window({ grain: "month", windowStart: "2026-05-01", windowEnd: "2026-08-31" });

function monthly(points: ReturnType<typeof metric>[]) {
  return evidence({ window: MONTHS, points });
}

function metric(metricKey: string, periodStart: string, minorUnits: number) {
  const [year, month] = periodStart.split("-").map(Number);
  return point(periodStart, minorUnits, {
    metricKey,
    currency: "AED",
    grain: "month",
    periodEnd: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
    normalizedMetricId: `${metricKey}-${periodStart}`,
  });
}
function revenue(periodStart: string, minorUnits: number) {
  return metric("revenue.company_gross", periodStart, minorUnits);
}

const detector = economicsCompanyCostStructureDetector;
const codes = (outcomes: readonly unknown[]) =>
  outcomes.map((outcome) => (outcome as { code: string }).code);
const lines = (outcomes: readonly unknown[]) =>
  outcomes
    .filter(
      (outcome) => (outcome as { code: string }).code === "COMPANY_COST_LINE_SHARE_OF_REVENUE",
    )
    .map((outcome) => (outcome as { metricKey: string }).metricKey);
const measurementOf = (outcome: unknown) =>
  (outcome as { measurement: { numerator: number; denominator: number } }).measurement;
const limitationsOf = (outcome: unknown) => (outcome as { limitations: string[] }).limitations;

describe("economics.company_cost_structure", () => {
  it("adds what the company spent against the revenue its own books state", () => {
    const outcomes = detector.run(
      monthly([
        revenue("2026-05-01", 100_000),
        metric("cost.food", "2026-05-01", 30_000),
        metric("cost.packaging", "2026-05-01", 5_000),
        metric("cost.commission", "2026-05-01", 15_000),
      ]),
    );

    expect(outcomes[0]).toMatchObject({
      kind: "observation",
      code: "COMPANY_COST_STRUCTURE_OF_REVENUE",
      measurement: { valueKind: "ratio", numerator: 50_000, denominator: 100_000, currency: "AED" },
    });
  });

  it("reports each cost line on its own as well as together", () => {
    // A reader deciding what to do needs to know whether the cost sits in the
    // kitchen or in the commission. One combined ratio hides exactly that.
    const outcomes = detector.run(
      monthly([
        revenue("2026-05-01", 100_000),
        metric("cost.food", "2026-05-01", 30_000),
        metric("cost.packaging", "2026-05-01", 5_000),
      ]),
    );

    expect(lines(outcomes)).toEqual(["cost.food", "cost.packaging"]);
    const food = outcomes.find(
      (outcome) => (outcome as { metricKey: string }).metricKey === "cost.food",
    );
    expect(measurementOf(food)).toMatchObject({ numerator: 30_000, denominator: 100_000 });
  });

  it("divides only by the periods that carry a cost", () => {
    // The client's bookkeeper posted a quarter's commission in one month. If
    // every month's revenue went into the denominator, the commission would
    // read as a third of what was actually charged against those sales.
    const outcomes = detector.run(
      monthly([
        revenue("2026-05-01", 100_000),
        revenue("2026-06-01", 100_000),
        metric("cost.commission", "2026-06-01", 20_000),
      ]),
    );

    expect(measurementOf(outcomes[0])).toMatchObject({ numerator: 20_000, denominator: 100_000 });
    expect(outcomes[0]).toMatchObject({ expectedPeriodCount: 2, observedPeriodCount: 1 });
  });

  it("says which cost lines it read and over how many periods", () => {
    const outcomes = detector.run(
      monthly([
        revenue("2026-05-01", 100_000),
        revenue("2026-06-01", 100_000),
        metric("cost.food", "2026-06-01", 30_000),
      ]),
    );

    // Named, not counted: "one cost line" says nothing about which.
    expect(limitationsOf(outcomes[0])[0]).toBe("Read from 1 cost line(s): food.");
    expect(limitationsOf(outcomes[0])[1]).toContain("1 period(s) carrying both revenue and a cost");
  });

  it("never lets a company figure be read as one channel's", () => {
    const outcomes = detector.run(
      monthly([revenue("2026-05-01", 100_000), metric("cost.food", "2026-05-01", 30_000)]),
    );

    expect(limitationsOf(outcomes[0]).join(" ")).toContain(
      "already contains what the marketplaces sold",
    );
    expect(detector.requiredMetricKeys).toEqual(["revenue.company_gross"]);
    expect(detector.requiredMetricKeys).not.toContain("revenue.gross");
  });

  it("refuses when the books state costs but no revenue", () => {
    const outcomes = detector.run(monthly([metric("cost.food", "2026-05-01", 30_000)]));

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      kind: "needs_data",
      code: "COMPANY_COST_STRUCTURE_UNAVAILABLE",
      needsDataReason: "REVENUE_SERIES_ABSENT",
    });
  });

  it("refuses when no period carries both sides", () => {
    const outcomes = detector.run(
      monthly([revenue("2026-05-01", 100_000), metric("cost.food", "2026-06-01", 30_000)]),
    );

    expect(codes(outcomes)).toEqual(["COMPANY_COST_STRUCTURE_UNAVAILABLE"]);
    expect(outcomes[0]).toMatchObject({ needsDataReason: "COST_SERIES_ABSENT" });
  });

  it("refuses a share of nothing rather than reporting zero", () => {
    const outcomes = detector.run(
      monthly([revenue("2026-05-01", 0), metric("cost.food", "2026-05-01", 30_000)]),
    );

    expect(outcomes[0]).toMatchObject({ needsDataReason: "REVENUE_NOT_POSITIVE" });
  });

  it("claims no monetary impact, because the money was already spent", () => {
    expect(detector.monetaryImpact.computable).toBe(false);
  });
});
