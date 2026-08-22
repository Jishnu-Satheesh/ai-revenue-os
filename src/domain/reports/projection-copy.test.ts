import { describe, expect, it } from "vitest";

import { summarizeReportProjection } from "@/domain/reports/projection-copy";

const mapping = {
  schemaVersion: 1,
  currency: "AED",
  outletGrain: "branch",
  sheets: [
    {
      normalizedSheetName: "csv",
      headerRow: 1,
      dataStartRow: 2,
      allowFormula: false,
      allowMergedCells: false,
      fields: [
        { canonicalField: "period_date", sourceHeader: "order_date", parser: "local_date", required: true },
        {
          canonicalField: "gross_sales",
          sourceHeader: "total_sales",
          parser: "money",
          financialSign: "positive",
          required: true,
        },
        { canonicalField: "order_count", sourceHeader: "total_orders", parser: "integer", required: true },
      ],
    },
  ],
  controls: [],
  unmappedFieldDisposition: "reviewed_ignore",
};

const output = (key: string, canonicalField: string, metricKey: string, valueKind: string) => ({
  key,
  normalizedSheetName: "csv",
  canonicalField,
  metricKey,
  valueKind,
  aggregation: "sum",
});

const exactRange = {
  schemaVersion: 1,
  outputKind: "exact_range",
  outputs: [
    output("gross_revenue", "gross_sales", "revenue.gross", "money"),
    output("orders", "order_count", "transactions.count", "count"),
  ],
};

const daily = {
  schemaVersion: 1,
  outputKind: "period_grain",
  grain: "day",
  periodKey: { normalizedSheetName: "csv", canonicalField: "period_date" },
  outputs: exactRange.outputs,
};

describe("saying what a declaration will record", () => {
  it("names each figure and the column it comes from, in the operator's words", () => {
    // Not "revenue.gross from gross_sales".
    expect(summarizeReportProjection(exactRange, mapping)?.entries).toEqual([
      { label: "sales", sourceColumn: "total sales" },
      { label: "orders", sourceColumn: "total orders" },
    ]);
  });

  it("says whether it is a series or one total", () => {
    expect(summarizeReportProjection(daily, mapping)?.shape).toBe("one figure for each day");
    expect(summarizeReportProjection(exactRange, mapping)?.shape).toBe(
      "one figure for the whole period",
    );
  });

  it("warns about gaps only where a period can be absent", () => {
    // A single total covers the whole declared period or fails, so there is
    // nothing to warn about.
    expect(summarizeReportProjection(daily, mapping)?.mayHaveGaps).toBe(true);
    expect(summarizeReportProjection(exactRange, mapping)?.mayHaveGaps).toBe(false);
  });

  it("says what the import will be checked against", () => {
    const fromSheet = {
      ...exactRange,
      controlTotals: [
        { outputKey: "gross_revenue", source: "sheet_totals_row", toleranceMinorUnits: 0 },
      ],
    };
    const fromStatement = {
      ...exactRange,
      controlTotals: [
        {
          outputKey: "gross_revenue",
          source: "operator_stated",
          statedTotalMinorUnits: "8900",
          statedSource: "Keeta commission invoice, January 2026",
          toleranceMinorUnits: 0,
        },
      ],
    };

    expect(summarizeReportProjection(fromSheet, mapping)?.checkedAgainst).toBe(
      "the total the file states about itself",
    );
    expect(summarizeReportProjection(fromStatement, mapping)?.checkedAgainst).toBe(
      "Keeta commission invoice, January 2026",
    );
    expect(summarizeReportProjection(exactRange, mapping)?.checkedAgainst).toBeNull();
  });

  it("still names the figures when the mapping cannot be read", () => {
    // A summary with no column names is worth more than no summary: the
    // operator still learns what would be recorded.
    const summary = summarizeReportProjection(exactRange, { broken: true });

    expect(summary?.entries).toEqual([
      { label: "sales", sourceColumn: null },
      { label: "orders", sourceColumn: null },
    ]);
  });

  it("returns nothing rather than guessing at a declaration it cannot read", () => {
    expect(summarizeReportProjection({ nonsense: true }, mapping)).toBeNull();
  });
});
