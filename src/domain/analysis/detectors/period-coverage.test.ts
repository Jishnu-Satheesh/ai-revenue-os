import { describe, expect, it } from "vitest";

import { periodCoverageDetector } from "@/domain/analysis/detectors/period-coverage";
import { CHANNEL, evidence, point, PROJECTION_RUN, window } from "@/domain/analysis/test-fixtures";

describe("evidence.period_coverage", () => {
  it("reports an absent period as absent rather than as a zero", () => {
    const [outcome] = periodCoverageDetector.run(
      evidence({ points: [point("2026-01-01", 120_000), point("2026-01-03", 80_000)] }),
    );

    expect(outcome.kind).toBe("observation");
    expect(outcome.code).toBe("PERIOD_COVERAGE_INCOMPLETE");
    expect(outcome.expectedPeriodCount).toBe(5);
    expect(outcome.observedPeriodCount).toBe(2);
    expect(outcome.absentPeriodCount).toBe(3);
    // The share is stored as both parts of the fraction, never as a quotient.
    expect(outcome.kind === "observation" && outcome.measurement).toEqual({
      valueKind: "ratio",
      numerator: 2,
      denominator: 5,
    });
  });

  it("carries no severity, because no threshold exists for how much is missing", () => {
    const [outcome] = periodCoverageDetector.run(evidence({ points: [point("2026-01-01", 1)] }));

    expect(outcome.kind).toBe("observation");
    expect("severity" in outcome).toBe(false);
  });

  it("says coverage is complete only when every period carries evidence", () => {
    const points = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"].map(
      (date) => point(date, 1_000),
    );

    const [outcome] = periodCoverageDetector.run(evidence({ points }));

    expect(outcome.code).toBe("PERIOD_COVERAGE_COMPLETE");
    expect(outcome.absentPeriodCount).toBe(0);
  });

  it("needs data rather than reporting nothing when no governed evidence exists", () => {
    const [outcome] = periodCoverageDetector.run(evidence({ points: [] }));

    expect(outcome.kind).toBe("needs_data");
    expect(outcome.kind === "needs_data" && outcome.needsDataReason).toBe(
      "NO_GOVERNED_EVIDENCE_IN_WINDOW",
    );
    expect(outcome.evidence).toHaveLength(0);
  });

  it("does not call evidence absent when it is recorded at another grain", () => {
    // A month-grain question over a day-grain ledger. Saying "no approved
    // report has written these days" would send an operator to chase a
    // provider for a file the platform is already holding.
    const [outcome] = periodCoverageDetector.run(
      evidence({
        window: window({ grain: "month", windowStart: "2026-01-01", windowEnd: "2026-01-31" }),
        points: [point("2026-01-01", 7_000), point("2026-01-02", 1_900)],
      }),
    );

    expect(outcome.kind).toBe("needs_data");
    expect(outcome.kind === "needs_data" && outcome.needsDataReason).toBe(
      "EVIDENCE_AT_DIFFERENT_GRAIN",
    );
    expect(outcome.qualityState).toBe("partial");
    expect(outcome.limitations.join(" ")).toMatch(/2 figures .* recorded at day grain/);
    // Still no figure. Naming the grain is not the same as resampling to it.
    expect(outcome.evidence).toHaveLength(0);
  });

  it("still reports a true absence as an absence", () => {
    const [outcome] = periodCoverageDetector.run(
      evidence({
        window: window({ grain: "month", windowStart: "2026-01-01", windowEnd: "2026-01-31" }),
      }),
    );

    expect(outcome.kind === "needs_data" && outcome.needsDataReason).toBe(
      "NO_GOVERNED_EVIDENCE_IN_WINDOW",
    );
    expect(outcome.qualityState).toBe("complete");
  });

  it("needs data when the window is too short to contain one whole period", () => {
    const [outcome] = periodCoverageDetector.run(
      evidence({
        window: window({ grain: "month", windowStart: "2026-01-05", windowEnd: "2026-01-20" }),
        points: [point("2026-01-01", 5_000, { grain: "month", periodEnd: "2026-01-31" })],
      }),
    );

    expect(outcome.kind === "needs_data" && outcome.needsDataReason).toBe(
      "WINDOW_CONTAINS_NO_PERIOD",
    );
  });

  it("sets aside a row bucketed in another timezone and says the answer is partial", () => {
    const [outcome] = periodCoverageDetector.run(
      evidence({
        points: [
          point("2026-01-01", 120_000),
          point("2026-01-02", 90_000, { periodTimezone: "Asia/Riyadh" }),
        ],
      }),
    );

    expect(outcome.qualityState).toBe("partial");
    expect(outcome.observedPeriodCount).toBe(1);
  });

  it("cites every figure it counted and the import that reported the blanks", () => {
    const [outcome] = periodCoverageDetector.run(
      evidence({
        points: [point("2026-01-01", 120_000)],
        projectionRuns: [{ projectionRunId: PROJECTION_RUN, absentRowCount: 11 }],
      }),
    );

    expect(outcome.evidence).toEqual([
      { kind: "normalized_metric", role: "component", id: `metric-2026-01-01-${CHANNEL}` },
      { kind: "projection_run", role: "gap_count", id: PROJECTION_RUN },
    ]);
    // The blank count is reported as a property of the import, not of the window.
    expect(outcome.limitations.some((line) => line.includes("11"))).toBe(true);
  });
});
