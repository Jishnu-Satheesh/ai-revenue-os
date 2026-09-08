import { describe, expect, it } from "vitest";

import {
  isWindowCovered,
  mergeCoverageSegments,
  MAX_ANALYSIS_WINDOW_DAYS,
  defaultAnalysisWindow,
  describeGrainMismatch,
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

const daily = (windowStart: string, windowEnd: string) => ({
  windowStart,
  windowEnd,
  grain: "day" as const,
  governedRowCount: 100,
});

describe("defaultAnalysisWindow", () => {
  it("has no answer for a channel with nothing declared", () => {
    expect(defaultAnalysisWindow({ today: "2026-09-07", windows: [] })).toBeNull();
  });

  it("opens on the last seven days when a daily report covers them", () => {
    expect(
      defaultAnalysisWindow({ today: "2026-09-07", windows: [daily("2026-06-01", "2026-09-30")] }),
    ).toEqual({ from: "2026-09-01", to: "2026-09-07" });
  });

  it("falls back to the last seven covered days on a daily channel", () => {
    // Keeta's real shape. Today is September; the reports stop on 28 February.
    // Counting seven days back from today reaches nothing, so the default has
    // to walk back to where the evidence actually ends.
    expect(
      defaultAnalysisWindow({ today: "2026-09-07", windows: [daily("2026-01-01", "2026-02-28")] }),
    ).toEqual({ from: "2026-02-22", to: "2026-02-28" });
  });

  it("opens on the last whole month for a monthly channel", () => {
    // The offline store's profit and loss: one figure per month, May to August.
    // Seven days ending 31 August would contain no whole month, so the page
    // would open on the grain warning. It opens on August instead.
    expect(
      defaultAnalysisWindow({
        today: "2026-09-07",
        windows: [
          {
            windowStart: "2026-05-01",
            windowEnd: "2026-08-31",
            grain: "month",
            governedRowCount: 16,
          },
        ],
      }),
    ).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("opens on the whole span for a channel that files one figure", () => {
    // Noon reported a single figure for the whole of January and February.
    // Any narrower default would be a window that figure cannot fill.
    expect(
      defaultAnalysisWindow({
        today: "2026-09-07",
        windows: [
          {
            windowStart: "2026-01-01",
            windowEnd: "2026-02-28",
            grain: "span",
            governedRowCount: 2,
          },
        ],
      }),
    ).toEqual({ from: "2026-01-01", to: "2026-02-28" });
  });

  it("opens on the last whole week for a weekly channel", () => {
    // Weeks start Monday. 2026-02-28 is a Saturday, so the last whole week
    // inside the declaration is Monday 16 to Sunday 22 February.
    expect(
      defaultAnalysisWindow({
        today: "2026-09-07",
        windows: [
          {
            windowStart: "2026-01-05",
            windowEnd: "2026-02-28",
            grain: "week",
            governedRowCount: 40,
          },
        ],
      }),
    ).toEqual({ from: "2026-02-16", to: "2026-02-22" });
  });

  it("refuses to reach behind the start of a short declaration", () => {
    // A three-day report cannot yield a seven-day default.
    expect(
      defaultAnalysisWindow({ today: "2026-09-07", windows: [daily("2026-02-26", "2026-02-28")] }),
    ).toEqual({ from: "2026-02-26", to: "2026-02-28" });
  });

  it("prefers the latest declaration when a channel has several", () => {
    expect(
      defaultAnalysisWindow({
        today: "2026-09-07",
        windows: [daily("2026-01-01", "2026-02-28"), daily("2026-05-01", "2026-06-30")],
      }),
    ).toEqual({ from: "2026-06-24", to: "2026-06-30" });
  });

  it("does not open on seven days when those days are monthly-reported", () => {
    // The last seven days are covered, but by a report that files one figure a
    // month. Opening there would open on a warning, so the month wins.
    expect(
      defaultAnalysisWindow({
        today: "2026-09-07",
        windows: [
          {
            windowStart: "2026-01-01",
            windowEnd: "2026-09-30",
            grain: "month",
            governedRowCount: 9,
          },
        ],
      }),
    ).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
});

import { describeGrainMismatch } from "@/domain/analysis/window-selection";

describe("describeGrainMismatch", () => {
  const monthly = {
    windowStart: "2026-05-01",
    windowEnd: "2026-08-31",
    grain: "month" as const,
    governedRowCount: 16,
  };
  const span = {
    windowStart: "2026-01-01",
    windowEnd: "2026-02-28",
    grain: "span" as const,
    governedRowCount: 2,
  };

  it("says nothing when a daily report can answer a four-day question", () => {
    expect(
      describeGrainMismatch({
        from: "2026-01-01",
        to: "2026-01-04",
        windows: [daily("2026-01-01", "2026-02-28")],
      }),
    ).toBeNull();
  });

  it("warns when four days are asked of a monthly report, and names the month", () => {
    expect(
      describeGrainMismatch({ from: "2026-08-01", to: "2026-08-04", windows: [monthly] }),
    ).toEqual({
      grain: "month",
      declaredStart: "2026-05-01",
      declaredEnd: "2026-08-31",
      suggested: { from: "2026-08-01", to: "2026-08-31" },
    });
  });

  it("warns when part of a single-figure span is asked for, and offers the whole span", () => {
    // Noon reported one figure for 1 January to 28 February. Four days of it
    // is not a smaller answer; it is no answer.
    expect(
      describeGrainMismatch({ from: "2026-01-01", to: "2026-01-04", windows: [span] }),
    ).toEqual({
      grain: "span",
      declaredStart: "2026-01-01",
      declaredEnd: "2026-02-28",
      suggested: { from: "2026-01-01", to: "2026-02-28" },
    });
  });

  it("blames the declaration carrying the most governed rows", () => {
    // Two declarations, both too coarse to answer, different sizes. The
    // warning names the one the operator is most likely to recognise, which
    // is the one that produced the most rows -- not whichever sorted first.
    const mismatch = describeGrainMismatch({
      from: "2026-08-01",
      to: "2026-08-04",
      windows: [
        {
          windowStart: "2026-01-01",
          windowEnd: "2026-12-31",
          grain: "month",
          governedRowCount: 12,
        },
        {
          windowStart: "2026-07-01",
          windowEnd: "2026-09-30",
          grain: "month",
          governedRowCount: 900,
        },
      ],
    });

    expect(mismatch?.declaredStart).toBe("2026-07-01");
    expect(mismatch?.declaredEnd).toBe("2026-09-30");
  });

  it("breaks a tie on row count by blaming the finer declaration", () => {
    const mismatch = describeGrainMismatch({
      from: "2026-08-01",
      to: "2026-08-04",
      windows: [
        { windowStart: "2026-01-01", windowEnd: "2026-12-31", grain: "span", governedRowCount: 40 },
        {
          windowStart: "2026-07-01",
          windowEnd: "2026-09-30",
          grain: "month",
          governedRowCount: 40,
        },
      ],
    });

    expect(mismatch?.grain).toBe("month");
  });

  it("says nothing when the whole span is asked for", () => {
    expect(
      describeGrainMismatch({ from: "2026-01-01", to: "2026-02-28", windows: [span] }),
    ).toBeNull();
  });

  it("says nothing when a whole month is asked of a monthly report", () => {
    expect(
      describeGrainMismatch({ from: "2026-08-01", to: "2026-08-31", windows: [monthly] }),
    ).toBeNull();
  });

  it("warns on a part-month that straddles two months", () => {
    // 15 July to 15 August contains no whole month, so a monthly report has
    // nothing to put in it. The suggestion widens to both whole months.
    expect(
      describeGrainMismatch({ from: "2026-07-15", to: "2026-08-15", windows: [monthly] }),
    ).toEqual({
      grain: "month",
      declaredStart: "2026-05-01",
      declaredEnd: "2026-08-31",
      suggested: { from: "2026-07-01", to: "2026-08-31" },
    });
  });

  it("stays quiet when any one of several reports can answer", () => {
    // Keeta files three families at once. One daily report is enough to make
    // a four-day question answerable, whatever the others do.
    expect(
      describeGrainMismatch({
        from: "2026-01-01",
        to: "2026-01-04",
        windows: [monthly, span, daily("2026-01-01", "2026-02-28")],
      }),
    ).toBeNull();
  });

  it("says nothing about a range no report overlaps", () => {
    // That is a coverage problem, refused by isWindowCovered. Two complaints
    // about one mistake is one too many.
    expect(
      describeGrainMismatch({ from: "2026-03-01", to: "2026-03-04", windows: [monthly] }),
    ).toBeNull();
  });
});
