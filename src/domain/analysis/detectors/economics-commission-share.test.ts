import { describe, expect, it } from "vitest";

import { economicsCommissionShareDetector } from "@/domain/analysis/detectors/economics-commission-share";
import { evidence, point } from "@/domain/analysis/test-fixtures";

function commission(periodStart: string, minorUnits: number) {
  return point(periodStart, minorUnits, { metricKey: "cost.commission", currency: "AED" });
}
function revenue(periodStart: string, minorUnits: number) {
  return point(periodStart, minorUnits, { metricKey: "revenue.gross", currency: "AED" });
}

describe("economics.commission_share", () => {
  it("states the rate over the days carrying both figures", () => {
    const [outcome] = economicsCommissionShareDetector.run(
      evidence({
        points: [
          commission("2026-01-01", 1_000),
          commission("2026-01-02", 1_000),
          revenue("2026-01-01", 10_000),
          revenue("2026-01-02", 10_000),
        ],
      }),
    );

    expect(outcome).toMatchObject({
      kind: "observation",
      code: "COMMISSION_SHARE_OF_REVENUE",
      measurement: { valueKind: "ratio", numerator: 2_000, denominator: 20_000, currency: "AED" },
      observedPeriodCount: 2,
      expectedPeriodCount: 2,
    });
  });

  it("cites both sides, so a reader can recompute the ratio rather than trust it", () => {
    const [outcome] = economicsCommissionShareDetector.run(
      evidence({ points: [commission("2026-01-01", 1_000), revenue("2026-01-01", 10_000)] }),
    );

    const roles = (outcome as { evidence: readonly { role: string }[] }).evidence.map((e) => e.role);
    expect(roles).toContain("component");
    expect(roles).toContain("denominator");
  });

  it("ignores a day that carries commission but no revenue, and says it did", () => {
    // Keeta is exactly this case: commission runs across two months and gross
    // revenue comes from a billing report covering one. Dividing the whole of
    // one by part of the other would roughly double the reported rate, from two
    // figures that are each individually correct.
    const [outcome] = economicsCommissionShareDetector.run(
      evidence({
        points: [
          commission("2026-01-01", 1_000),
          commission("2026-01-02", 5_000),
          revenue("2026-01-01", 10_000),
        ],
      }),
    );

    expect(outcome).toMatchObject({
      kind: "observation",
      measurement: { numerator: 1_000, denominator: 10_000 },
      observedPeriodCount: 1,
      expectedPeriodCount: 2,
    });
    // And the shortfall is stated on the finding itself, not left to be noticed.
    expect((outcome as { limitations: readonly string[] }).limitations[0]).toMatch(
      /1 day\(s\) carrying both figures, out of 2/,
    );
  });

  it("refuses when no day carries both figures", () => {
    const [outcome] = economicsCommissionShareDetector.run(
      evidence({ points: [commission("2026-01-01", 1_000), revenue("2026-01-02", 10_000)] }),
    );

    expect(outcome).toMatchObject({ kind: "needs_data", needsDataReason: "NO_SHARED_PERIOD" });
  });

  it("refuses commission without revenue, and revenue without commission", () => {
    expect(
      economicsCommissionShareDetector.run(evidence({ points: [commission("2026-01-01", 1_000)] }))[0],
    ).toMatchObject({ needsDataReason: "REVENUE_SERIES_ABSENT" });
    expect(
      economicsCommissionShareDetector.run(evidence({ points: [revenue("2026-01-01", 10_000)] }))[0],
    ).toMatchObject({ needsDataReason: "COMMISSION_SERIES_ABSENT" });
  });

  it("refuses two currencies rather than adding them", () => {
    const [outcome] = economicsCommissionShareDetector.run(
      evidence({
        points: [
          commission("2026-01-01", 1_000),
          point("2026-01-01", 10_000, { metricKey: "revenue.gross", currency: "USD" }),
        ],
      }),
    );

    expect(outcome).toMatchObject({ kind: "needs_data", needsDataReason: "MIXED_CURRENCY" });
  });

  it("refuses a share of zero revenue rather than reporting one", () => {
    const [outcome] = economicsCommissionShareDetector.run(
      evidence({ points: [commission("2026-01-01", 1_000), revenue("2026-01-01", 0)] }),
    );

    expect(outcome).toMatchObject({ kind: "needs_data", needsDataReason: "REVENUE_NOT_POSITIVE" });
  });

  it("claims no monetary impact, because a deduction already applied is not a finding", () => {
    expect(economicsCommissionShareDetector.monetaryImpact.computable).toBe(false);
  });
});
