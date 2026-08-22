import { describe, expect, it } from "vitest";

import { parsePeriodKey, periodStartFor } from "@/domain/reports/period-key";
import { ReportProjectionError } from "@/domain/reports/projection-error";

describe("reading the date a row belongs to", () => {
  describe("the encodings the client's providers actually send", () => {
    it("reads Talabat's ISO date", () => {
      expect(parsePeriodKey("2026-01-31", "iso_date")).toBe("2026-01-31");
    });

    it("reads Keeta's compact integer, as a number or a string", () => {
      expect(parsePeriodKey(20260228, "compact_date")).toBe("2026-02-28");
      expect(parsePeriodKey("20260228", "compact_date")).toBe("2026-02-28");
    });

    it("reads the textual form Keeta's billing report uses", () => {
      expect(parsePeriodKey("1 Jan 2026", "text_date")).toBe("2026-01-01");
      expect(parsePeriodKey("28 February 2026", "text_date")).toBe("2026-02-28");
    });

    it("reads EatEasily's day and month, taking the year from the declared period", () => {
      // The day-orders export writes `01/Jan` and never says which year. The
      // package already declares the period it covers, and that is the diary
      // the page came from.
      const period = { periodStart: "2026-01-01", periodEnd: "2026-02-28" };

      expect(parsePeriodKey("01/Jan", "day_month", period)).toBe("2026-01-01");
      expect(parsePeriodKey("28/Feb", "day_month", period)).toBe("2026-02-28");
      expect(parsePeriodKey("1 Jan", "day_month", period)).toBe("2026-01-01");
    });

    it("refuses a year-less date when no period was declared", () => {
      expect(() => parsePeriodKey("01/Jan", "day_month")).toThrow(ReportProjectionError);
    });

    it("refuses a year-less date that falls outside the declared period", () => {
      // A row dated in March inside a January-to-February export is not a row
      // whose year needs working out. It is the wrong file, or the wrong row.
      expect(() =>
        parsePeriodKey("05/Mar", "day_month", {
          periodStart: "2026-01-01",
          periodEnd: "2026-02-28",
        }),
      ).toThrow(ReportProjectionError);
    });

    it("refuses a year-less date the period could place in two years", () => {
      // Over fourteen months, `15/Jan` is two different days and choosing
      // either would be a guess.
      expect(() =>
        parsePeriodKey("15/Jan", "day_month", {
          periodStart: "2025-12-01",
          periodEnd: "2027-01-31",
        }),
      ).toThrow(ReportProjectionError);
    });

    it("resolves a year-less date across a New Year without ambiguity", () => {
      const period = { periodStart: "2025-12-15", periodEnd: "2026-01-15" };

      expect(parsePeriodKey("20/Dec", "day_month", period)).toBe("2025-12-20");
      expect(parsePeriodKey("05/Jan", "day_month", period)).toBe("2026-01-05");
    });

    it("refuses a year-less leap day in a year that has none", () => {
      expect(() =>
        parsePeriodKey("29/Feb", "day_month", {
          periodStart: "2026-01-01",
          periodEnd: "2026-12-31",
        }),
      ).toThrow(ReportProjectionError);
      expect(
        parsePeriodKey("29/Feb", "day_month", {
          periodStart: "2024-01-01",
          periodEnd: "2024-12-31",
        }),
      ).toBe("2024-02-29");
    });

    it("reads a spreadsheet date cell by its UTC parts", () => {
      // A reader anchors a date cell at UTC midnight. Reading it locally would
      // move the day backwards for anyone west of Greenwich, quietly filing a
      // day of sales under the wrong date.
      expect(parsePeriodKey(new Date(Date.UTC(2026, 0, 1)), "iso_date")).toBe("2026-01-01");
    });
  });

  describe("refusing what it cannot read", () => {
    it("will not read one encoding as another", () => {
      // The contract states the encoding because the value cannot. `03/04/2026`
      // is two different days depending on who exported it.
      expect(() => parsePeriodKey("20260131", "iso_date")).toThrow(ReportProjectionError);
      expect(() => parsePeriodKey("2026-01-31", "compact_date")).toThrow(ReportProjectionError);
      expect(() => parsePeriodKey("2026-01-31", "text_date")).toThrow(ReportProjectionError);
    });

    it("rejects a date that does not exist rather than rolling it forward", () => {
      // JavaScript would happily turn 31 February into 3 March.
      expect(() => parsePeriodKey("20260231", "compact_date")).toThrow(ReportProjectionError);
      expect(() => parsePeriodKey("2026-13-01", "iso_date")).toThrow(ReportProjectionError);
      expect(() => parsePeriodKey("31 Feb 2026", "text_date")).toThrow(ReportProjectionError);
    });

    it("accepts a real leap day and rejects a false one", () => {
      expect(parsePeriodKey("20240229", "compact_date")).toBe("2024-02-29");
      expect(() => parsePeriodKey("20260229", "compact_date")).toThrow(ReportProjectionError);
    });

    it("rejects a blank rather than treating it as a day", () => {
      for (const blank of [null, undefined, "", "   "]) {
        expect(() => parsePeriodKey(blank, "iso_date")).toThrow(ReportProjectionError);
      }
    });

    it("rejects a month name it does not know", () => {
      expect(() => parsePeriodKey("1 Smarch 2026", "text_date")).toThrow(ReportProjectionError);
    });
  });
});

describe("the period a date falls in", () => {
  it("leaves a day as itself", () => {
    expect(periodStartFor("2026-01-31", "day")).toBe("2026-01-31");
  });

  it("takes a month back to its first", () => {
    expect(periodStartFor("2026-01-31", "month")).toBe("2026-01-01");
  });

  it("starts a week on Monday, whatever the server's locale thinks", () => {
    // 2026-01-31 is a Saturday. A locale-dependent week boundary would make the
    // same evidence roll up differently on two machines.
    expect(periodStartFor("2026-01-31", "week")).toBe("2026-01-26");
    expect(periodStartFor("2026-01-26", "week")).toBe("2026-01-26");
    expect(periodStartFor("2026-02-01", "week")).toBe("2026-01-26");
  });

  it("crosses a year boundary without losing the week", () => {
    // 2026-01-01 is a Thursday, so its week began in December.
    expect(periodStartFor("2026-01-01", "week")).toBe("2025-12-29");
  });
});
