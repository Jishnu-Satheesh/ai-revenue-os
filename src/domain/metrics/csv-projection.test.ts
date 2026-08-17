import { describe, expect, it } from "vitest";

import {
  currencyExponent,
  parseCsvMetricMapping,
  projectCsvRows,
  toMinorUnits,
  type CsvProjectionDefinition,
} from "@/domain/metrics/csv-projection";
import { MetricError } from "@/domain/metrics/errors";

const definitions: CsvProjectionDefinition[] = [
  { key: "revenue.gross", valueKind: "money" },
  { key: "transactions.count", valueKind: "count" },
  { key: "listing.conversion_rate", valueKind: "ratio" },
];

const mapping = parseCsvMetricMapping({
  period: "Date",
  channel: "Channel",
  "revenue.gross": "Total",
  "transactions.count": "Orders",
});

const dubai = {
  grain: "day",
  timeZone: "Asia/Dubai",
  definitions,
  defaultCurrency: "AED",
} as const;

describe("parseCsvMetricMapping", () => {
  it("separates reserved dimensions from metric keys", () => {
    expect(mapping.periodColumn).toBe("Date");
    expect(mapping.channelColumn).toBe("Channel");
    expect([...mapping.metricColumns.keys()].sort()).toEqual([
      "revenue.gross",
      "transactions.count",
    ]);
  });

  it("rejects a mapping with no period column", () => {
    expect(() => parseCsvMetricMapping({ "revenue.gross": "Total" })).toThrow(MetricError);
  });

  it("rejects a mapping with no metric key", () => {
    expect(() => parseCsvMetricMapping({ period: "Date", channel: "Channel" })).toThrow(
      MetricError,
    );
  });

  it("ignores targets that belong to another consumer of the mapping", () => {
    // column_mapping is shared Integration Hub configuration. A non-metric
    // target is somebody else's, so metrics takes what it recognises rather
    // than refusing the whole import.
    const mixed = parseCsvMetricMapping({
      period: "Date",
      order_id: "Order ID",
      notes: "Comments",
      "revenue.gross": "Total",
    });

    expect([...mixed.metricColumns.keys()]).toEqual(["revenue.gross"]);
  });

  it("still claims a mistyped metric key so it surfaces per row", () => {
    // Dotted targets are metric keys by definition, so a typo is not silently
    // dropped here; it reaches the registry lookup and rejects as unknown.
    const typo = parseCsvMetricMapping({ period: "Date", "revenue.gros": "Total" });
    expect([...typo.metricColumns.keys()]).toEqual(["revenue.gros"]);

    const { rejections } = projectCsvRows({
      ...dubai,
      mapping: typo,
      rows: [{ Date: "2026-08-01", Total: "10.00" }],
    });
    expect(rejections).toEqual([
      { row: 1, metricKey: "revenue.gros", reason: "UNKNOWN_METRIC_KEY" },
    ]);
  });

  it("still refuses a mapping that carries no metric key at all", () => {
    expect(() => parseCsvMetricMapping({ period: "Date", order_id: "Order ID" })).toThrow(
      MetricError,
    );
  });
});

describe("toMinorUnits", () => {
  it("converts without float error", () => {
    // 12.34 * 100 is 1233.9999999999998 in floating point.
    expect(toMinorUnits("12.34", 2)).toBe(1234);
    expect(toMinorUnits("0.07", 2)).toBe(7);
    expect(toMinorUnits("1250.5", 2)).toBe(125050);
    expect(toMinorUnits("1250", 2)).toBe(125000);
    expect(toMinorUnits("-4.20", 2)).toBe(-420);
  });

  it("honours currencies that are not two-decimal", () => {
    expect(currencyExponent("KWD")).toBe(3);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("AED")).toBe(2);
    expect(toMinorUnits("1.234", 3)).toBe(1234);
    expect(toMinorUnits("500", 0)).toBe(500);
  });

  it("refuses precision the currency cannot hold rather than truncating", () => {
    expect(toMinorUnits("12.345", 2)).toBeNull();
    expect(toMinorUnits("1.5", 0)).toBeNull();
  });

  it("accepts trailing zeroes beyond the exponent, which lose nothing", () => {
    expect(toMinorUnits("12.3400", 2)).toBe(1234);
  });
});

describe("projectCsvRows", () => {
  it("projects one row into an observation per mapped metric", () => {
    const { observations, rejections } = projectCsvRows({
      ...dubai,
      mapping,
      rows: [{ Date: "2026-08-01", Channel: "talabat", Total: "1250.50", Orders: "42" }],
    });

    expect(rejections).toEqual([]);
    expect(observations).toHaveLength(2);

    const revenue = observations.find((entry) => entry.metricKey === "revenue.gross");
    expect(revenue).toMatchObject({ numerator: 125050, currency: "AED", channel: "talabat" });

    const orders = observations.find((entry) => entry.metricKey === "transactions.count");
    expect(orders).toMatchObject({ numerator: 42, currency: null, denominator: null });
  });

  it("buckets the period at local midnight in the branch timezone", () => {
    const { observations } = projectCsvRows({
      ...dubai,
      mapping,
      rows: [{ Date: "2026-08-01", Total: "100.00", Orders: "1" }],
    });

    // Dubai is UTC+4 year round, so 1 August local starts at 20:00Z on 31 July.
    expect(observations[0].periodStart.toISOString()).toBe("2026-07-31T20:00:00.000Z");
    expect(observations[0].periodEnd.toISOString()).toBe("2026-08-01T20:00:00.000Z");
    expect(observations[0].periodTimezone).toBe("Asia/Dubai");
  });

  it("refuses a ratio metric, which a single column can only express as a quotient", () => {
    const ratioMapping = parseCsvMetricMapping({
      period: "Date",
      "listing.conversion_rate": "CVR",
    });

    const { observations, rejections } = projectCsvRows({
      ...dubai,
      mapping: ratioMapping,
      rows: [{ Date: "2026-08-01", CVR: "0.031" }],
    });

    expect(observations).toEqual([]);
    expect(rejections).toEqual([
      { row: 1, metricKey: "listing.conversion_rate", reason: "UNSUPPORTED_VALUE_KIND" },
    ]);
  });

  it("rejects rather than drops every unprojectable cell", () => {
    const { observations, rejections } = projectCsvRows({
      ...dubai,
      mapping,
      rows: [
        { Date: "", Total: "10.00", Orders: "1" },
        { Date: "03/04/2026", Total: "10.00", Orders: "1" },
        { Date: "2026-08-02", Total: "", Orders: "1" },
        { Date: "2026-08-03", Total: "12.345", Orders: "1.5" },
      ],
    });

    // Only the order count on row 3 survives; every other cell is accounted
    // for by a rejection rather than vanishing.
    expect(observations).toHaveLength(1);
    expect(rejections).toEqual([
      { row: 1, metricKey: null, reason: "MISSING_PERIOD" },
      { row: 2, metricKey: null, reason: "INVALID_PERIOD" },
      { row: 3, metricKey: "revenue.gross", reason: "MISSING_VALUE" },
      { row: 4, metricKey: "revenue.gross", reason: "INVALID_VALUE" },
      { row: 4, metricKey: "transactions.count", reason: "INVALID_VALUE" },
    ]);
  });

  it("refuses ambiguous and impossible dates instead of guessing", () => {
    const { observations, rejections } = projectCsvRows({
      ...dubai,
      mapping,
      rows: [
        // Date.parse accepts this and returns 4 March, guessing US month-first.
        // A Dubai client writing 3 April would be filed a month early.
        { Date: "03/04/2026", Total: "10.00", Orders: "1" },
        { Date: "2026-02-30", Total: "10.00", Orders: "1" },
        { Date: "1 August 2026", Total: "10.00", Orders: "1" },
      ],
    });

    expect(observations).toEqual([]);
    expect(rejections.map((entry) => entry.reason)).toEqual([
      "INVALID_PERIOD",
      "INVALID_PERIOD",
      "INVALID_PERIOD",
    ]);
  });

  it("reads a timestamp with an offset as absolute and one without as branch local", () => {
    const { observations } = projectCsvRows({
      ...dubai,
      mapping,
      rows: [
        // 23:30Z on 1 August is 03:30 on 2 August in Dubai.
        { Date: "2026-08-01T23:30:00Z", Total: "10.00", Orders: "1" },
        // No offset: read as a wall-clock reading at the branch, so 1 August.
        { Date: "2026-08-01T23:30:00", Total: "10.00", Orders: "1" },
      ],
    });

    const starts = observations
      .filter((entry) => entry.metricKey === "transactions.count")
      .map((entry) => entry.periodStart.toISOString());

    expect(starts).toEqual(["2026-08-01T20:00:00.000Z", "2026-07-31T20:00:00.000Z"]);
  });

  it("rejects a metric key with no registered definition", () => {
    const unknownMapping = parseCsvMetricMapping({ period: "Date", "mystery.metric": "X" });

    const { rejections } = projectCsvRows({
      ...dubai,
      mapping: unknownMapping,
      rows: [{ Date: "2026-08-01", X: "1" }],
    });

    expect(rejections).toEqual([
      { row: 1, metricKey: "mystery.metric", reason: "UNKNOWN_METRIC_KEY" },
    ]);
  });

  it("rejects money with no currency from either the row or the default", () => {
    const { observations, rejections } = projectCsvRows({
      grain: "day",
      timeZone: "Asia/Dubai",
      definitions,
      mapping,
      rows: [{ Date: "2026-08-01", Total: "10.00", Orders: "1" }],
      defaultCurrency: null,
    });

    expect(rejections).toContainEqual({
      row: 1,
      metricKey: "revenue.gross",
      reason: "MISSING_CURRENCY",
    });
    expect(observations).toHaveLength(1);
  });

  it("prefers a per-row currency column over the default", () => {
    const currencyMapping = parseCsvMetricMapping({
      period: "Date",
      currency: "Ccy",
      "revenue.gross": "Total",
    });

    const { observations } = projectCsvRows({
      grain: "day",
      timeZone: "Asia/Dubai",
      definitions,
      mapping: currencyMapping,
      rows: [{ Date: "2026-08-01", Ccy: "KWD", Total: "1.234" }],
      defaultCurrency: "AED",
    });

    // KWD has three minor digits, so 1.234 is 1234 fils rather than rejected.
    expect(observations[0]).toMatchObject({ currency: "KWD", numerator: 1234 });
  });
});
