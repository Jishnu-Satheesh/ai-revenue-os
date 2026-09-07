import { describe, expect, it } from "vitest";

import {
  addLocalDays,
  analysisMonthBounds,
  enumerateAnalysisMonths,
  enumerateLocalPeriodStarts,
  formatAnalysisMonth,
  localPeriodEnd,
  localPeriodStart,
  nextLocalPeriodStart,
  parseAnalysisMonth,
  previousLocalPeriodStart,
  resolveAnalysisMonth,
} from "@/domain/analysis/calendar";
import { ChannelAnalysisError } from "@/domain/analysis/errors";

describe("local period arithmetic", () => {
  it("ends a month on its own last day", () => {
    expect(localPeriodEnd("2026-02-01", "month")).toBe("2026-02-28");
    expect(localPeriodEnd("2024-02-01", "month")).toBe("2024-02-29");
    expect(localPeriodEnd("2026-01-01", "week")).toBe("2026-01-07");
  });

  it("starts a week on Monday", () => {
    // 2026-01-01 is a Thursday.
    expect(localPeriodStart("2026-01-01", "week")).toBe("2025-12-29");
    expect(nextLocalPeriodStart("2025-12-29", "week")).toBe("2026-01-05");
    expect(previousLocalPeriodStart("2026-01-05", "week")).toBe("2025-12-29");
  });

  it("steps across a month boundary without arriving in the wrong month", () => {
    expect(previousLocalPeriodStart("2026-03-01", "month")).toBe("2026-02-01");
    expect(nextLocalPeriodStart("2026-12-01", "month")).toBe("2027-01-01");
    expect(addLocalDays("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("counts only the periods whose own start falls inside the window", () => {
    // Only whole weeks. The part-week at either end is not a week this window
    // asked about, so reporting it missing would be a gap nobody has.
    expect(enumerateLocalPeriodStarts("2026-01-01", "2026-01-20", "week")).toEqual([
      "2026-01-05",
      "2026-01-12",
    ]);
    expect(enumerateLocalPeriodStarts("2026-01-01", "2026-01-31", "month")).toEqual(["2026-01-01"]);
    expect(enumerateLocalPeriodStarts("2026-01-01", "2026-01-30", "month")).toEqual([]);
    expect(enumerateLocalPeriodStarts("2026-01-05", "2026-01-20", "month")).toEqual([]);
    expect(enumerateLocalPeriodStarts("2026-01-01", "2026-01-03", "day")).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ]);
  });

  it("rejects a date that does not exist rather than rolling it forward", () => {
    expect(() => addLocalDays("2026-02-31", 1)).toThrow(ChannelAnalysisError);
    expect(() => addLocalDays("2026-1-1", 1)).toThrow(ChannelAnalysisError);
  });

  it("refuses a window wider than a run may cover", () => {
    expect(() => enumerateLocalPeriodStarts("2026-01-01", "2028-01-01", "day")).toThrow(
      ChannelAnalysisError,
    );
  });
});

describe("canonical analysis months", () => {
  it("parses a canonical YYYY-MM selection", () => {
    expect(parseAnalysisMonth("2026-01")).toEqual({ year: 2026, month: 1 });
    expect(parseAnalysisMonth("2026-12")).toEqual({ year: 2026, month: 12 });
  });

  it("rejects anything that is not a canonical month", () => {
    for (const value of ["2026-1", "26-01", "2026-13", "2026-00", "2026/01", "", "2026-01-01"]) {
      expect(() => parseAnalysisMonth(value)).toThrow(ChannelAnalysisError);
    }
  });

  it("resolves a month to its own first and last local dates", () => {
    expect(analysisMonthBounds("2026-01")).toEqual({
      windowStart: "2026-01-01",
      windowEnd: "2026-01-31",
    });
    expect(analysisMonthBounds("2026-02")).toEqual({
      windowStart: "2026-02-01",
      windowEnd: "2026-02-28",
    });
    // Leap years stay inside February rather than spilling into March.
    expect(analysisMonthBounds("2024-02")).toEqual({
      windowStart: "2024-02-01",
      windowEnd: "2024-02-29",
    });
    expect(analysisMonthBounds("2026-12")).toEqual({
      windowStart: "2026-12-01",
      windowEnd: "2026-12-31",
    });
  });

  it("keeps a month inside the channel's known timeline", () => {
    const horizon = { firstMonth: "2026-01", lastMonth: "2026-03" };
    expect(resolveAnalysisMonth("2026-02", horizon)).toEqual({
      windowStart: "2026-02-01",
      windowEnd: "2026-02-28",
    });
    // Edge months are selectable: a gap at the boundary is still a month the
    // channel's reports declare, not an invented window.
    expect(resolveAnalysisMonth("2026-01", horizon).windowStart).toBe("2026-01-01");
    expect(resolveAnalysisMonth("2026-03", horizon).windowEnd).toBe("2026-03-31");
  });

  it("refuses a month outside the known timeline", () => {
    const horizon = { firstMonth: "2026-01", lastMonth: "2026-03" };
    expect(() => resolveAnalysisMonth("2025-12", horizon)).toThrow(ChannelAnalysisError);
    expect(() => resolveAnalysisMonth("2026-04", horizon)).toThrow(ChannelAnalysisError);
    expect(() => resolveAnalysisMonth("not-a-month", horizon)).toThrow(ChannelAnalysisError);
  });

  it("expands a horizon into every selectable month, oldest first", () => {
    expect(enumerateAnalysisMonths({ firstMonth: "2025-11", lastMonth: "2026-02" })).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
    expect(enumerateAnalysisMonths({ firstMonth: "2026-02", lastMonth: "2026-02" })).toEqual([
      "2026-02",
    ]);
  });

  it("refuses to expand a horizon no picker could show", () => {
    expect(() => enumerateAnalysisMonths({ firstMonth: "2026-04", lastMonth: "2026-01" })).toThrow(
      ChannelAnalysisError,
    );
    expect(() => enumerateAnalysisMonths({ firstMonth: "1900-01", lastMonth: "2200-01" })).toThrow(
      ChannelAnalysisError,
    );
  });

  it("names a month without consulting a timezone", () => {
    expect(formatAnalysisMonth("2026-02")).toBe("February 2026");
    expect(formatAnalysisMonth("2025-12")).toBe("December 2025");
    expect(() => formatAnalysisMonth("2026-13")).toThrow(ChannelAnalysisError);
  });
});
