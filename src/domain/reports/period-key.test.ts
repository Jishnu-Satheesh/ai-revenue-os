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
