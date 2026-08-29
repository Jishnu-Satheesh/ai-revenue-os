import { describe, expect, it } from "vitest";

import type { ReportContractDocument } from "@/domain/reports/contracts";
import {
  projectPeriodGrainMetrics,
  reportProjectionDocumentSchema,
  ReportProjectionError,
  type ReportProjectionDocument,
} from "@/domain/reports/projection";

/**
 * One governed figure the provider reports across several columns.
 *
 * Keeta splits its placed orders into customers who ordered inside the
 * restaurant and customers who ordered outside it. Neither column is the
 * funnel's last stage; their sum is. Until an output could read more than one
 * column, the choice was to approximate the stage with `checkout_customers` --
 * which counts people who reached checkout and never ordered -- or to leave a
 * whole chapter empty over data the file already states.
 *
 * The rule that keeps it honest is that a sum is only as stated as its parts.
 * Where any contributing column says nothing for a day, the day is absent, not
 * smaller: a total missing one of its halves is unknown, and recording it would
 * quietly under-report the stage.
 */

const contract: ReportContractDocument = {
  schemaVersion: 1,
  currency: "AED",
  outletGrain: "branch",
  sheets: [
    {
      normalizedSheetName: "sheet1",
      headerRow: 1,
      dataStartRow: 2,
      allowFormula: false,
      allowMergedCells: false,
      fields: [
        {
          canonicalField: "period_date",
          sourceHeader: "date",
          parser: "local_date",
          required: true,
        },
        {
          canonicalField: "orders_in",
          sourceHeader: "orders_in",
          parser: "integer",
          absentMarkers: ["-"],
          required: false,
        },
        {
          canonicalField: "orders_out",
          sourceHeader: "orders_out",
          parser: "integer",
          absentMarkers: ["-"],
          required: false,
        },
        {
          canonicalField: "reason",
          sourceHeader: "reason",
          parser: "text",
          required: false,
        },
      ],
    },
  ],
  controls: [],
  unmappedFieldDisposition: "reviewed_ignore",
} as unknown as ReportContractDocument;

function declaration(output: Record<string, unknown>): ReportProjectionDocument {
  return reportProjectionDocumentSchema.parse({
    schemaVersion: 1,
    outputKind: "period_grain",
    grain: "day",
    periodKey: { normalizedSheetName: "sheet1", canonicalField: "period_date" },
    outputs: [
      {
        key: "placed_orders",
        normalizedSheetName: "sheet1",
        canonicalField: "orders_in",
        metricKey: "listing.placed_orders",
        valueKind: "count",
        aggregation: "sum",
        ...output,
      },
    ],
    controlTotals: [],
  });
}

const HEADER = ["Date", "Orders In", "Orders Out", "Reason"];

function project(rows: unknown[][], document: ReportProjectionDocument) {
  return projectPeriodGrainMetrics({
    contract,
    document: document as Extract<ReportProjectionDocument, { outputKind: "period_grain" }>,
    declaredCurrency: "AED",
    sheets: [{ normalizedSheetName: "sheet1", rows: [HEADER, ...rows] }],
  });
}

describe("declaring a figure that spans several columns", () => {
  it("accepts a bounded list of columns to add", () => {
    expect(() => declaration({ sumWith: ["orders_out"] })).not.toThrow();
  });

  it("refuses to add a column to itself", () => {
    // Naming the output's own column again would double the figure and look
    // like a clean import.
    expect(() => declaration({ sumWith: ["orders_in"] })).toThrow();
  });

  it("refuses a column named twice", () => {
    expect(() => declaration({ sumWith: ["orders_out", "orders_out"] })).toThrow();
  });

  it("refuses to add the column that dates the row", () => {
    expect(() => declaration({ sumWith: ["period_date"] })).toThrow();
  });

  it("refuses to add columns to a categorical output", () => {
    // A categorical output counts labels. There is no arithmetic to extend.
    expect(() =>
      declaration({
        canonicalField: "reason",
        sumWith: ["orders_out"],
        categorical: {
          dimensionKey: "reason_code",
          allowedValues: ["ITEM_UNAVAILABLE"],
          collectInjectedValues: false,
        },
      }),
    ).toThrow();
  });

  it("refuses an empty list rather than treating it as no list at all", () => {
    expect(() => declaration({ sumWith: [] })).toThrow();
  });
});

describe("projecting a figure that spans several columns", () => {
  it("adds every declared column into one observation for the day", () => {
    const result = project(
      [
        ["2026-01-01", 3, 4],
        ["2026-01-02", 10, 0],
      ],
      declaration({ sumWith: ["orders_out"] }),
    );

    expect(result.observations.map((row) => row.valueNumerator)).toEqual(["7", "10"]);
  });

  it("keeps a day absent when any one of its columns says nothing", () => {
    // The provider wrote a dash for orders placed outside the restaurant. The
    // day's total is unknown, not the inside figure on its own.
    const result = project(
      [
        ["2026-01-01", 3, "-"],
        ["2026-01-02", 5, 2],
      ],
      declaration({ sumWith: ["orders_out"] }),
    );

    expect(result.observations.map((row) => row.periodStart)).toEqual(["2026-01-02"]);
    expect(result.observations.map((row) => row.valueNumerator)).toEqual(["7"]);
  });

  it("keeps a genuine zero on both columns as a zero", () => {
    const result = project([["2026-01-01", 0, 0]], declaration({ sumWith: ["orders_out"] }));

    expect(result.observations.map((row) => row.valueNumerator)).toEqual(["0"]);
  });

  it("refuses a column the contract never bound", () => {
    expect(() =>
      project([["2026-01-01", 1, 2]], declaration({ sumWith: ["orders_sideways"] })),
    ).toThrow(ReportProjectionError);
  });

  it("still reads a single-column output exactly as before", () => {
    const result = project([["2026-01-01", 3, 4]], declaration({}));

    expect(result.observations.map((row) => row.valueNumerator)).toEqual(["3"]);
  });
});
