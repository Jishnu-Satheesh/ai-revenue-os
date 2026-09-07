import { describe, expect, it } from "vitest";

import {
  isWindowCovered,
  mergeCoverageSegments,
  MAX_ANALYSIS_WINDOW_DAYS,
} from "@/domain/analysis/window-selection";

const w = (windowStart: string, windowEnd: string) => ({ windowStart, windowEnd });

describe("mergeCoverageSegments", () => {
  it("returns nothing for no packages", () => {
    expect(mergeCoverageSegments([])).toEqual([]);
  });

  it("keeps two genuinely separate stretches apart", () => {
    // Nostaza's real shape: Keeta covers Jan-Feb, the offline store May-Aug.
    // A gap between them is a gap, and the calendar must show it as one.
    expect(
      mergeCoverageSegments([w("2026-05-01", "2026-08-31"), w("2026-01-01", "2026-02-28")]),
    ).toEqual([
      { start: "2026-01-01", end: "2026-02-28" },
      { start: "2026-05-01", end: "2026-08-31" },
    ]);
  });

  it("merges overlapping declarations into one stretch", () => {
    expect(
      mergeCoverageSegments([w("2026-01-01", "2026-01-31"), w("2026-01-15", "2026-02-28")]),
    ).toEqual([{ start: "2026-01-01", end: "2026-02-28" }]);
  });

  it("merges stretches that merely touch, leaving no false one-day gap", () => {
    // 31 January and 1 February are adjacent, not separated. Treating them as
    // two segments would grey out a boundary the reports actually cover.
    expect(
      mergeCoverageSegments([w("2026-01-01", "2026-01-31"), w("2026-02-01", "2026-02-28")]),
    ).toEqual([{ start: "2026-01-01", end: "2026-02-28" }]);
  });

  it("swallows a declaration wholly inside another", () => {
    expect(
      mergeCoverageSegments([w("2026-01-01", "2026-02-28"), w("2026-01-10", "2026-01-12")]),
    ).toEqual([{ start: "2026-01-01", end: "2026-02-28" }]);
  });
});

describe("isWindowCovered", () => {
  const segments = mergeCoverageSegments([
    w("2026-01-01", "2026-02-28"),
    w("2026-05-01", "2026-08-31"),
  ]);

  it("accepts a range wholly inside one stretch", () => {
    expect(isWindowCovered("2026-01-01", "2026-01-04", segments)).toBe(true);
  });

  it("accepts a range equal to a whole stretch", () => {
    expect(isWindowCovered("2026-01-01", "2026-02-28", segments)).toBe(true);
  });

  it("refuses a range that leaves cover by a single day", () => {
    expect(isWindowCovered("2026-02-28", "2026-03-01", segments)).toBe(false);
  });

  it("refuses a range that spans the gap between two stretches", () => {
    // Every day of March and April is uncovered. A range bridging Jan and May
    // is not "mostly covered"; it is a question the reports cannot answer.
    expect(isWindowCovered("2026-02-01", "2026-05-31", segments)).toBe(false);
  });

  it("refuses a reversed range", () => {
    expect(isWindowCovered("2026-01-04", "2026-01-01", segments)).toBe(false);
  });

  it("refuses a range wider than the run ceiling", () => {
    const wide = mergeCoverageSegments([w("2024-01-01", "2026-12-31")]);
    expect(isWindowCovered("2024-01-01", "2025-06-01", wide)).toBe(false);
    expect(MAX_ANALYSIS_WINDOW_DAYS).toBe(400);
  });

  it("accepts a range at exactly the ceiling, and refuses one past it", () => {
    // The database's check is `window_end - window_start <= 400`, so 400 is
    // legal and 401 is not. Refusing 400 here would reject a window the
    // database would have taken, which is the opposite of this guard's job.
    const wide = mergeCoverageSegments([w("2024-01-01", "2027-12-31")]);
    expect(isWindowCovered("2026-01-01", "2027-02-05", wide)).toBe(true);
    expect(isWindowCovered("2026-01-01", "2027-02-06", wide)).toBe(false);
  });

  it("refuses anything when nothing is declared", () => {
    expect(isWindowCovered("2026-01-01", "2026-01-04", [])).toBe(false);
  });
});
