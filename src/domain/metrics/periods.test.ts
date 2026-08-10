import { describe, expect, it } from "vitest";

import { MetricError } from "@/domain/metrics/errors";
import {
  enumeratePeriodStarts,
  findMissingPeriodStarts,
  nextPeriodStart,
  startOfPeriod,
} from "@/domain/metrics/periods";

describe("startOfPeriod", () => {
  it("buckets a day in the branch timezone, not in UTC", () => {
    // 20:30 UTC on 1 August is 00:30 on 2 August in Dubai. Bucketing on UTC
    // would file this evening's trade under the wrong day.
    const instant = new Date("2026-08-01T20:30:00Z");

    expect(startOfPeriod(instant, "day", "Asia/Dubai").toISOString()).toBe(
      "2026-08-01T20:00:00.000Z",
    );
    expect(startOfPeriod(instant, "day", "UTC").toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("starts weeks on Monday", () => {
    // 2026-08-01 is a Saturday; its ISO week began on Monday 27 July.
    expect(startOfPeriod(new Date("2026-08-01T12:00:00Z"), "week", "UTC").toISOString()).toBe(
      "2026-07-27T00:00:00.000Z",
    );
  });

  it("rejects a timezone the platform does not recognise", () => {
    expect(() => startOfPeriod(new Date(), "day", "Mars/Olympus")).toThrow(MetricError);
  });
});

describe("nextPeriodStart", () => {
  it("steps by calendar month rather than a fixed number of days", () => {
    const februaryStart = new Date("2026-02-01T00:00:00Z");
    expect(nextPeriodStart(februaryStart, "month", "UTC").toISOString()).toBe(
      "2026-03-01T00:00:00.000Z",
    );
  });

  it("produces a 23-hour day across a spring-forward transition", () => {
    // London moves to BST at 01:00 UTC on 29 March 2026.
    const dayBefore = startOfPeriod(new Date("2026-03-28T12:00:00Z"), "day", "Europe/London");
    const springForward = nextPeriodStart(dayBefore, "day", "Europe/London");
    const dayAfter = nextPeriodStart(springForward, "day", "Europe/London");

    const elapsedHours = (dayAfter.getTime() - springForward.getTime()) / 3_600_000;
    expect(elapsedHours).toBe(23);
  });
});

describe("enumeratePeriodStarts", () => {
  it("covers the period containing the range start", () => {
    const starts = enumeratePeriodStarts(
      "day",
      new Date("2026-08-01T13:00:00Z"),
      new Date("2026-08-04T00:00:00Z"),
      "UTC",
    );

    expect(starts.map((date) => date.toISOString())).toEqual([
      "2026-08-01T00:00:00.000Z",
      "2026-08-02T00:00:00.000Z",
      "2026-08-03T00:00:00.000Z",
    ]);
  });

  it("tracks local midnight across a DST change instead of a fixed 24 hours", () => {
    // London moves to BST at 01:00 UTC on Sunday 29 March 2026, so local
    // midnight shifts from 00:00Z to 23:00Z partway through the range. A fixed
    // 24-hour step would drift an hour and mis-bucket every later day.
    const starts = enumeratePeriodStarts(
      "day",
      new Date("2026-03-27T00:00:00Z"),
      new Date("2026-04-01T00:00:00Z"),
      "Europe/London",
    );

    expect(starts.map((date) => date.toISOString())).toEqual([
      "2026-03-27T00:00:00.000Z",
      "2026-03-28T00:00:00.000Z",
      "2026-03-29T00:00:00.000Z",
      "2026-03-29T23:00:00.000Z",
      "2026-03-30T23:00:00.000Z",
      "2026-03-31T23:00:00.000Z",
    ]);

    // Every entry is a distinct local calendar day, and the transition day is
    // 23 hours long rather than 24.
    const localDates = starts.map((date) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(date),
    );
    expect(new Set(localDates).size).toBe(starts.length);
    expect((starts[3].getTime() - starts[2].getTime()) / 3_600_000).toBe(23);
  });

  it("rejects an inverted or empty range", () => {
    expect(() =>
      enumeratePeriodStarts(
        "day",
        new Date("2026-08-04T00:00:00Z"),
        new Date("2026-08-01T00:00:00Z"),
        "UTC",
      ),
    ).toThrow(MetricError);

    expect(() =>
      enumeratePeriodStarts(
        "day",
        new Date("2026-08-01T00:00:00Z"),
        new Date("2026-08-01T00:00:00Z"),
        "UTC",
      ),
    ).toThrow(MetricError);
  });
});

describe("findMissingPeriodStarts", () => {
  it("reports expected periods with no observation", () => {
    const expected = enumeratePeriodStarts(
      "day",
      new Date("2026-08-01T00:00:00Z"),
      new Date("2026-08-05T00:00:00Z"),
      "UTC",
    );

    const missing = findMissingPeriodStarts(expected, [
      new Date("2026-08-01T00:00:00Z"),
      new Date("2026-08-04T00:00:00Z"),
    ]);

    expect(missing.map((date) => date.toISOString())).toEqual([
      "2026-08-02T00:00:00.000Z",
      "2026-08-03T00:00:00.000Z",
    ]);
  });

  it("returns nothing for a dense series", () => {
    const expected = enumeratePeriodStarts(
      "day",
      new Date("2026-08-01T00:00:00Z"),
      new Date("2026-08-03T00:00:00Z"),
      "UTC",
    );

    expect(findMissingPeriodStarts(expected, expected)).toEqual([]);
  });
});
