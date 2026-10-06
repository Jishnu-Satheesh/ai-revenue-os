import { describe, expect, it } from "vitest";

import {
  addLocalDays,
  enumerateLocalPeriodStarts,
  localPeriodEnd,
  localPeriodStart,
  nextLocalPeriodStart,
  previousLocalPeriodStart,
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
