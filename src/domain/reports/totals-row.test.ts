import { describe, expect, it } from "vitest";

import type { ReportContractDocument } from "@/domain/reports/contracts";
import { reportContractDocumentSchema } from "@/domain/reports/contracts";
import {
  projectExactRangeMetrics,
  ReportControlTotalMismatch,
  ReportProjectionError,
  reportProjectionDocumentSchema,
  type ReportProjectionDocument,
} from "@/domain/reports/projection";
import { findTotalsRow } from "@/domain/reports/totals-row";

/**
 * Shaped exactly after the pilot client's EatEasily branch-wise sales export,
 * which Smile also serves under its own name: the literal word `Total` sits in
 * the POS ID column, and the row it labels is the *first* data row rather than
 * the last.
 */
const contract = reportContractDocumentSchema.parse({
  schemaVersion: 1,
  currency: "AED",
  outletGrain: "branch",
  sheets: [
    {
      normalizedSheetName: "sales_report",
      headerRow: 1,
      dataStartRow: 2,
      allowFormula: false,
      allowMergedCells: false,
      totalsRow: { canonicalField: "pos_id", label: "Total" },
      fields: [
        { canonicalField: "pos_id", sourceHeader: "pos_id", parser: "text", required: false },
        {
          canonicalField: "total_sales",
          sourceHeader: "total_sales",
          parser: "money",
          required: true,
          financialSign: "positive",
        },
      ],
    },
  ],
  controls: [],
  unmappedFieldDisposition: "reviewed_ignore",
}) as ReportContractDocument;

const HEADER = ["POS ID", "Total Sales"];

function declaration(controlTotals: unknown[] = []): ReportProjectionDocument {
  return reportProjectionDocumentSchema.parse({
    schemaVersion: 1,
    outputKind: "exact_range",
    outputs: [
      {
        key: "gross_revenue",
        normalizedSheetName: "sales_report",
        canonicalField: "total_sales",
        metricKey: "revenue.gross",
        valueKind: "money",
        aggregation: "sum",
      },
    ],
    controlTotals,
  });
}

function project(rows: unknown[][], document = declaration()) {
  return projectExactRangeMetrics({
    contract,
    document,
    declaredCurrency: "AED",
    sheets: [{ normalizedSheetName: "sales_report", rows: [HEADER, ...rows] }],
  });
}

describe("a report that states its own total", () => {
  it("sums the data and leaves the total out of it", () => {
    // Without this the figure comes out 178.00 — every EatEasily number exactly
    // doubled, and the import looks entirely successful while doing it.
    const result = project([
      ["Total", 89],
      ["POS-1", 70],
      ["POS-2", 19],
    ]);

    expect(result.outputs[0]?.valueNumerator).toBe("8900");
    expect(result.outputs[0]?.contributorCount).toBe(2);
  });

  it("finds the total wherever the provider put it, not only at the bottom", () => {
    const first = project([
      ["Total", 89],
      ["POS-1", 89],
    ]);
    const last = project([
      ["POS-1", 89],
      ["Total", 89],
    ]);

    expect(last.outputs[0]?.valueNumerator).toBe(first.outputs[0]?.valueNumerator);
  });

  it("checks the data against the total the file itself states", () => {
    const result = project(
      [
        ["Total", 89],
        ["POS-1", 70],
        ["POS-2", 19],
      ],
      declaration([
        { outputKey: "gross_revenue", source: "sheet_totals_row", toleranceMinorUnits: 0 },
      ]),
    );

    expect(result.controlTotals).toEqual([
      {
        outputKey: "gross_revenue",
        statedMinorUnits: "8900",
        projectedMinorUnits: "8900",
        differenceMinorUnits: "0",
        toleranceMinorUnits: 0,
        statedSource: "sheet totals row",
      },
    ]);
  });

  it("refuses the import when the rows disagree with the stated total", () => {
    expect(() =>
      project(
        [
          ["Total", 89],
          ["POS-1", 70],
        ],
        declaration([
          { outputKey: "gross_revenue", source: "sheet_totals_row", toleranceMinorUnits: 0 },
        ]),
      ),
    ).toThrow(ReportControlTotalMismatch);
  });
});

describe("when the totals row cannot be pinned down", () => {
  it("stops rather than summing the total in with the data", () => {
    // The export changed shape, or this is not the file the contract was
    // approved for. Either way, guessing past it doubles the figures.
    expect(() => project([["POS-1", 70]])).toThrow(ReportProjectionError);
  });

  it("stops when the label matches more than one row", () => {
    // Picking the first, the last, or the largest would be a guess dressed as
    // a rule.
    expect(() =>
      project([
        ["Total", 89],
        ["Total", 89],
        ["POS-1", 70],
      ]),
    ).toThrow(ReportProjectionError);
  });

  it("reports which problem it is", () => {
    try {
      project([["POS-1", 70]]);
      expect.unreachable("a missing totals row should have stopped the import");
    } catch (error) {
      expect((error as ReportProjectionError).code).toBe("TOTALS_ROW_NOT_RESOLVED");
    }
  });
});

describe("locating the row on its own", () => {
  const rule = contract.sheets[0];
  const fieldColumns = new Map([
    ["pos_id", 0],
    ["total_sales", 1],
  ]);

  it("says nothing is declared when nothing is", () => {
    expect(
      findTotalsRow({ rule: { ...rule, totalsRow: undefined }, rows: [HEADER], fieldColumns }),
    ).toEqual({ outcome: "none_declared" });
  });

  it("matches the label the way headers are matched, not by exact bytes", () => {
    // The provider renders it as `Total`, ` total `, or `TOTAL` depending on
    // the report, and none of those are a different row.
    for (const written of ["Total", " total ", "TOTAL"]) {
      expect(findTotalsRow({ rule, rows: [HEADER, [written, 89]], fieldColumns })).toEqual({
        outcome: "found",
        rowIndex: 1,
      });
    }
  });

  it("never mistakes a figure for the label", () => {
    expect(findTotalsRow({ rule, rows: [HEADER, [123, 89]], fieldColumns })).toEqual({
      outcome: "missing",
    });
  });
});

describe("what a contract may say about its totals row", () => {
  it("refuses a label placed in a field the sheet does not bind", () => {
    expect(() =>
      reportContractDocumentSchema.parse({
        schemaVersion: 1,
        currency: "AED",
        outletGrain: "branch",
        sheets: [
          {
            normalizedSheetName: "sales_report",
            headerRow: 1,
            dataStartRow: 2,
            allowFormula: false,
            allowMergedCells: false,
            totalsRow: { canonicalField: "not_bound", label: "Total" },
            fields: [
              { canonicalField: "pos_id", sourceHeader: "pos_id", parser: "text", required: false },
            ],
          },
        ],
        controls: [],
        unmappedFieldDisposition: "reviewed_ignore",
      }),
    ).toThrow();
  });

  it("refuses a sheet-sourced total that also states a figure by hand", () => {
    expect(() =>
      declaration([
        {
          outputKey: "gross_revenue",
          source: "sheet_totals_row",
          statedTotalMinorUnits: "8900",
          statedSource: "an invoice",
          toleranceMinorUnits: 0,
        },
      ]),
    ).toThrow();
  });

  it("refuses an operator-stated total with no figure", () => {
    expect(() =>
      declaration([
        { outputKey: "gross_revenue", source: "operator_stated", toleranceMinorUnits: 0 },
      ]),
    ).toThrow();
  });
});
