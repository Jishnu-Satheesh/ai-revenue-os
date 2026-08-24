import { describe, expect, it } from "vitest";

import { operationsClosedShareDetector } from "@/domain/analysis/detectors/operations-closed-share";
import { CHANNEL, evidence, point } from "@/domain/analysis/test-fixtures";

function minutePoint(metricKey: string, periodStart: string, numerator: number) {
  return point(periodStart, numerator, { metricKey, valueKind: "count", currency: null });
}

function closedDayPoint(periodStart: string, days: number, reasonCode: string) {
  return point(periodStart, days, {
    metricKey: "operations.closed_days",
    valueKind: "count",
    currency: null,
    dimensions: { reason_code: reasonCode },
  });
}

describe("operations.closed_share", () => {
  it("computes the share from the summed minutes exactly as the provider wrote them", () => {
    // The real export's window totals: 34,216.93 closed of 70,799 scheduled
    // minutes. The decimals are the provider's own per-day rounding, kept
    // exact rather than silently rounded again (ADR 0036).
    const [outcome] = operationsClosedShareDetector.run(
      evidence({
        points: [
          minutePoint("operations.closed_minutes", "2026-01-01", 17_108.47),
          minutePoint("operations.closed_minutes", "2026-01-02", 17_108.46),
          minutePoint("operations.scheduled_minutes", "2026-01-01", 35_000),
          minutePoint("operations.scheduled_minutes", "2026-01-02", 35_799),
        ],
      }),
    );

    expect(outcome.kind).toBe("observation");
    expect(outcome.code).toBe("OPERATIONS_CLOSED_SHARE");
    expect(outcome.kind === "observation" && outcome.measurement).toEqual({
      valueKind: "ratio",
      numerator: 34_216.93,
      denominator: 70_799,
    });
  });

  it("counts closed days once per reason value found in the window", () => {
    // The provider's own tally for the real package: 39 days marked
    // CHECK_IN_REQUIRED and 20 marked UNREACHABLE.
    const outcomes = operationsClosedShareDetector.run(
      evidence({
        points: [
          minutePoint("operations.closed_minutes", "2026-01-01", 500),
          minutePoint("operations.scheduled_minutes", "2026-01-01", 1_000),
          closedDayPoint("2026-01-01", 21, "CHECK_IN_REQUIRED"),
          closedDayPoint("2026-01-02", 18, "CHECK_IN_REQUIRED"),
          closedDayPoint("2026-01-01", 14, "UNREACHABLE"),
          closedDayPoint("2026-01-02", 6, "UNREACHABLE"),
        ],
      }),
    );

    const dayObservations = outcomes.filter((outcome) => outcome.code === "OPERATIONS_CLOSED_DAYS");
    expect(
      dayObservations.map(
        (outcome) => outcome.kind === "observation" && outcome.measurement?.numerator,
      ),
    ).toEqual([39, 20]);
    expect(dayObservations[0].limitations.join(" ")).toContain("CHECK_IN_REQUIRED");
    // Every cited row is one of the dimension-tagged ones.
    expect(dayObservations[0].evidence).toEqual([
      { kind: "normalized_metric", role: "component", id: `metric-2026-01-01-${CHANNEL}` },
      { kind: "normalized_metric", role: "component", id: `metric-2026-01-02-${CHANNEL}` },
    ]);
  });

  it("reports an unknown reason label like any other instead of absorbing it", () => {
    // ADR 0034: labels are a provider snapshot, not a platform enum. Nothing
    // here switches on which label arrived; a new one is counted as itself.
    const outcomes = operationsClosedShareDetector.run(
      evidence({
        points: [
          minutePoint("operations.closed_minutes", "2026-01-01", 500),
          minutePoint("operations.scheduled_minutes", "2026-01-01", 1_000),
          closedDayPoint("2026-01-01", 39, "CHECK_IN_REQUIRED"),
          closedDayPoint("2026-01-02", 20, "UNREACHABLE"),
          closedDayPoint("2026-01-03", 2, "NEW_PROVIDER_LABEL"),
        ],
      }),
    );

    const dayObservations = outcomes.filter((outcome) => outcome.code === "OPERATIONS_CLOSED_DAYS");
    // Observations are ordered by the label itself, so the same window always
    // reads the same way: C < N < U.
    expect(
      dayObservations.map(
        (outcome) => outcome.kind === "observation" && outcome.measurement?.numerator,
      ),
    ).toEqual([39, 2, 20]);
  });

  it("leaves untagged closed-day rows out of every reason group", () => {
    const outcomes = operationsClosedShareDetector.run(
      evidence({
        points: [
          minutePoint("operations.closed_minutes", "2026-01-01", 500),
          minutePoint("operations.scheduled_minutes", "2026-01-01", 1_000),
          closedDayPoint("2026-01-01", 39, "CHECK_IN_REQUIRED"),
          point("2026-01-02", 5, {
            metricKey: "operations.closed_days",
            valueKind: "count",
            currency: null,
            dimensions: {},
          }),
        ],
      }),
    );

    const dayObservations = outcomes.filter((outcome) => outcome.code === "OPERATIONS_CLOSED_DAYS");
    expect(dayObservations).toHaveLength(1);
    expect(dayObservations[0].kind === "observation" && dayObservations[0].measurement).toEqual({
      valueKind: "count",
      numerator: 39,
    });
  });

  it("needs data when either minute series is absent", () => {
    const [outcome] = operationsClosedShareDetector.run(
      evidence({ points: [minutePoint("operations.scheduled_minutes", "2026-01-01", 70_799)] }),
    );

    expect(outcome.kind).toBe("needs_data");
    expect(outcome.kind === "needs_data" && outcome.needsDataReason).toBe(
      "CLOSED_SHARE_SERIES_ABSENT",
    );
    expect(outcome.limitations.join(" ")).toContain("operations.closed_minutes");
  });

  it("states no monetary impact, because no export prices a closed hour", () => {
    const [outcome] = operationsClosedShareDetector.run(
      evidence({
        points: [
          minutePoint("operations.closed_minutes", "2026-01-01", 34_216.93),
          minutePoint("operations.scheduled_minutes", "2026-01-01", 70_799),
        ],
      }),
    );

    expect(outcome.kind === "observation" && outcome.measurement).not.toHaveProperty(
      "monetaryImpactMinorUnits",
    );
    expect(operationsClosedShareDetector.monetaryImpact.computable).toBe(false);
  });
});
