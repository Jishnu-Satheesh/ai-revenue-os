import { describe, expect, it } from "vitest";

import {
  addLocalDays,
  GrowthPeriodError,
  isProspectiveStart,
  nextProjectionIssueDate,
  organizationLocalDate,
  resolveGrowthCycleForDate,
  resolveGrowthPeriod,
} from "@/domain/organizations/growth-periods";

const ORIGIN = "2026-09-20";

describe("resolveGrowthPeriod", () => {
  it("keeps horizon periods fixed independently", () => {
    // The 1M horizon rolls monthly; the 3M horizon must not restart with it.
    expect(resolveGrowthPeriod(ORIGIN, 1, 0)).toMatchObject({
      horizonMonths: 1,
      cycleIndex: 0,
      startDate: "2026-09-20",
      endDateExclusive: "2026-10-20",
    });
    expect(resolveGrowthPeriod(ORIGIN, 1, 1)).toMatchObject({
      startDate: "2026-10-20",
      endDateExclusive: "2026-11-20",
    });
    // After the 1M period rolled, the 3M/6M/12M first cycles still start at
    // the shared origin with their own independent ends.
    expect(resolveGrowthPeriod(ORIGIN, 3, 0)).toMatchObject({
      startDate: "2026-09-20",
      endDateExclusive: "2026-12-20",
    });
    expect(resolveGrowthPeriod(ORIGIN, 6, 0)).toMatchObject({
      startDate: "2026-09-20",
      endDateExclusive: "2027-03-20",
    });
    expect(resolveGrowthPeriod(ORIGIN, 12, 0)).toMatchObject({
      startDate: "2026-09-20",
      endDateExclusive: "2027-09-20",
    });
    expect(resolveGrowthPeriod(ORIGIN, 3, 1)).toMatchObject({
      startDate: "2026-12-20",
      endDateExclusive: "2027-03-20",
    });
  });

  it("uses original day anchor after February clamp", () => {
    // January31 -> February28 -> March31: every boundary is recomputed from
    // the original origin, so the March end does not drift to March28.
    expect(resolveGrowthPeriod("2026-01-31", 1, 0)).toMatchObject({
      startDate: "2026-01-31",
      endDateExclusive: "2026-02-28",
    });
    expect(resolveGrowthPeriod("2026-01-31", 1, 1)).toMatchObject({
      startDate: "2026-02-28",
      endDateExclusive: "2026-03-31",
    });
    expect(resolveGrowthPeriod("2026-01-31", 1, 2)).toMatchObject({
      startDate: "2026-03-31",
      endDateExclusive: "2026-04-30",
    });
  });

  it("uses local days through DST", () => {
    // US daylight saving starts 2026-03-08 (23-hour day) and ends 2026-11-01
    // (25-hour day). Calendar stepping must still move one date per day.
    expect(addLocalDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addLocalDays("2026-03-07", 2)).toBe("2026-03-09");
    expect(addLocalDays("2026-03-08", 7)).toBe("2026-03-15");
    expect(addLocalDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addLocalDays("2026-10-31", 2)).toBe("2026-11-02");
    expect(addLocalDays("2026-11-02", -1)).toBe("2026-11-01");
  });

  it("does not start a projection in the past", () => {
    // Publication rejects starts at or before the current local date.
    expect(isProspectiveStart("2026-09-20", "2026-09-20")).toBe(false);
    expect(isProspectiveStart("2026-09-19", "2026-09-20")).toBe(false);
    expect(isProspectiveStart("2026-09-21", "2026-09-20")).toBe(true);
    // The nightly worker may publish during the local day before the start.
    expect(nextProjectionIssueDate("2026-09-20")).toBe("2026-09-19");
  });

  it("anchors February from the origin in leap years", () => {
    expect(resolveGrowthPeriod("2024-01-31", 1, 0)).toMatchObject({
      startDate: "2024-01-31",
      endDateExclusive: "2024-02-29",
    });
    expect(resolveGrowthPeriod("2024-01-31", 1, 1)).toMatchObject({
      startDate: "2024-02-29",
      endDateExclusive: "2024-03-31",
    });
    expect(addLocalDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addLocalDays("2024-02-29", 1)).toBe("2024-03-01");
  });

  it("reads the organization date independently of the UTC date", () => {
    // 00:30 UTC on 1 September is still 31 August in New York but already
    // 1 September in Dubai. Period boundaries follow the organization zone.
    expect(organizationLocalDate("2026-09-01T00:30:00.000Z", "Asia/Dubai")).toBe("2026-09-01");
    expect(organizationLocalDate("2026-09-01T00:30:00.000Z", "America/New_York")).toBe(
      "2026-08-31",
    );
    expect(organizationLocalDate("2026-09-01T00:30:00.000Z", "UTC")).toBe("2026-09-01");
  });

  it("rejects invalid origins, horizons and cycles", () => {
    expect(() => resolveGrowthPeriod("2026-02-30", 1, 0)).toThrow(GrowthPeriodError);
    expect(() => resolveGrowthPeriod("16-09-2026", 1, 0)).toThrow(GrowthPeriodError);
    expect(() => resolveGrowthPeriod(ORIGIN, 2, 0)).toThrow(GrowthPeriodError);
    expect(() => resolveGrowthPeriod(ORIGIN, 1, -1)).toThrow(GrowthPeriodError);
    expect(() => resolveGrowthPeriod(ORIGIN, 1, 1.5)).toThrow(GrowthPeriodError);
    expect(() => organizationLocalDate("2026-09-01T00:30:00.000Z", "Mars/Olympus")).toThrow(
      GrowthPeriodError,
    );
    expect(() => organizationLocalDate("not-an-instant", "Asia/Dubai")).toThrow(GrowthPeriodError);
  });
});

describe("resolveGrowthCycleForDate", () => {
  it("finds the cycle containing a local date without moving other horizons", () => {
    expect(resolveGrowthCycleForDate(ORIGIN, 1, "2026-09-20")).toBe(0);
    expect(resolveGrowthCycleForDate(ORIGIN, 1, "2026-10-19")).toBe(0);
    expect(resolveGrowthCycleForDate(ORIGIN, 1, "2026-10-20")).toBe(1);
    // The 3M horizon is still in its first cycle while 1M has rolled.
    expect(resolveGrowthCycleForDate(ORIGIN, 3, "2026-10-20")).toBe(0);
    expect(resolveGrowthCycleForDate(ORIGIN, 3, "2026-12-20")).toBe(1);
    expect(() => resolveGrowthCycleForDate(ORIGIN, 1, "2026-09-19")).toThrow(GrowthPeriodError);
  });
});
