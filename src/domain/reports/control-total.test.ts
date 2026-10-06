import { describe, expect, it } from "vitest";

import type { ReportContractDocument } from "@/domain/reports/contracts";
import {
  projectExactRangeMetrics,
  projectPeriodGrainMetrics,
  ReportControlTotalMismatch,
  reportProjectionDocumentSchema,
  type ReportProjectionDocument,
} from "@/domain/reports/projection";

/**
 * Shaped after the pilot client's Keeta billing report: a row per day, and a
 * total for the month that appears nowhere in the workbook — Keeta states it on
 * a separate commission invoice, which is where the operator reads it from.
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
          canonicalField: "gross_sales",
          sourceHeader: "gross_sales",
          parser: "money",
          required: true,
          financialSign: "positive",
        },
        {
          canonicalField: "successful_orders",
          sourceHeader: "successful_orders",
          parser: "integer",
          required: true,
        },
      ],
    },
  ],
  controls: [],
  unmappedFieldDisposition: "reviewed_ignore",
} as unknown as ReportContractDocument;

const revenueOutput = {
  key: "gross_revenue",
  normalizedSheetName: "sheet1",
  canonicalField: "gross_sales",
  metricKey: "revenue.gross",
  valueKind: "money",
  aggregation: "sum",
};

const ordersOutput = {
  key: "orders",
  normalizedSheetName: "sheet1",
  canonicalField: "successful_orders",
  metricKey: "transactions.count",
  valueKind: "count",
  aggregation: "sum",
};

const statedTotal = (overrides: Record<string, unknown> = {}) => ({
  outputKey: "gross_revenue",
  statedTotalMinorUnits: "8900",
  toleranceMinorUnits: 0,
  statedSource: "Keeta commission invoice, January 2026",
  ...overrides,
});

function exactRange(overrides: Record<string, unknown> = {}): ReportProjectionDocument {
  return reportProjectionDocumentSchema.parse({
    schemaVersion: 1,
    outputKind: "exact_range",
    outputs: [revenueOutput],
    controlTotals: [statedTotal()],
    ...overrides,
  });
}

function periodGrain(overrides: Record<string, unknown> = {}): ReportProjectionDocument {
  return reportProjectionDocumentSchema.parse({
    schemaVersion: 1,
    outputKind: "period_grain",
    grain: "day",
    periodKey: {
      normalizedSheetName: "sheet1",
      canonicalField: "period_date",
    },
    outputs: [revenueOutput],
    controlTotals: [statedTotal()],
    ...overrides,
  });
}

const HEADER = ["Date", "Gross Sales", "Successful Orders"];

function sheets(rows: unknown[][]) {
  return [{ normalizedSheetName: "sheet1", rows: [HEADER, ...rows] }];
}

function projectRange(rows: unknown[][], document = exactRange()) {
  return projectExactRangeMetrics({
    contract,
    document,
    declaredCurrency: "AED",
    sheets: sheets(rows),
  });
}

function projectDaily(rows: unknown[][], document = periodGrain()) {
  return projectPeriodGrainMetrics({
    contract,
    document: document as Extract<ReportProjectionDocument, { outputKind: "period_grain" }>,
    declaredCurrency: "AED",
    sheets: sheets(rows),
  });
}

describe("checking an import against the total the provider states", () => {
  it("admits a file whose rows reach the stated total exactly", () => {
    const result = projectRange([
      ["2026-01-01", 70, 2],
      ["2026-01-02", 19, 1],
    ]);

    expect(result.outputs[0]?.valueNumerator).toBe("8900");
    expect(result.controlTotals).toEqual([
      {
        outputKey: "gross_revenue",
        statedMinorUnits: "8900",
        projectedMinorUnits: "8900",
        differenceMinorUnits: "0",
        toleranceMinorUnits: 0,
        statedSource: "Keeta commission invoice, January 2026",
      },
    ]);
  });

  it("refuses a file that comes up short of the stated total", () => {
    // The day the operator forgot to include. Silently admitting this is how a
    // margin gets calculated against revenue that was never there.
    expect(() => projectRange([["2026-01-01", 70, 2]])).toThrow(ReportControlTotalMismatch);
  });

  it("says by how much, not merely that something is wrong", () => {
    try {
      projectRange([["2026-01-01", 70, 2]]);
      expect.unreachable("the short file should have been refused");
    } catch (error) {
      expect(error).toBeInstanceOf(ReportControlTotalMismatch);
      const mismatch = error as ReportControlTotalMismatch;
      expect(mismatch.projectedMinorUnits).toBe("7000");
      expect(mismatch.statedMinorUnits).toBe("8900");
      expect(mismatch.differenceMinorUnits).toBe("-1900");
      expect(mismatch.outputKey).toBe("gross_revenue");
    }
  });

  it("refuses a file that overshoots too, not only one that falls short", () => {
    // An overshoot is usually a duplicated day or a totals row read as data.
    try {
      projectRange([
        ["2026-01-01", 70, 2],
        ["2026-01-02", 19, 1],
        ["2026-01-02", 19, 1],
      ]);
      expect.unreachable("the duplicated day should have been refused");
    } catch (error) {
      expect((error as ReportControlTotalMismatch).differenceMinorUnits).toBe("1900");
    }
  });

  it("allows a stated tolerance for rounding, and no more", () => {
    const withinTolerance = exactRange({
      controlTotals: [statedTotal({ statedTotalMinorUnits: "8901", toleranceMinorUnits: 1 })],
    });
    const rows: unknown[][] = [
      ["2026-01-01", 70, 2],
      ["2026-01-02", 19, 1],
    ];

    expect(projectRange(rows, withinTolerance).controlTotals[0]?.differenceMinorUnits).toBe("-1");
    expect(() =>
      projectRange(
        rows,
        exactRange({
          controlTotals: [statedTotal({ statedTotalMinorUnits: "8902", toleranceMinorUnits: 1 })],
        }),
      ),
    ).toThrow(ReportControlTotalMismatch);
  });

  it("treats a file that produced no figure at all as the whole amount missing", () => {
    // Absent is not zero anywhere else in this engine, but a stated total is a
    // claim that the file carries figures. Silence against a stated 89.00 is a
    // gap of 89.00, and the import is refused.
    try {
      projectDaily([["2026-01-01", null, null]]);
      expect.unreachable("a file with no figures should have been refused");
    } catch (error) {
      expect((error as ReportControlTotalMismatch).differenceMinorUnits).toBe("-8900");
    }
  });

  it("checks a daily series against the whole period the provider invoiced", () => {
    // Keeta invoices a month; the file it came from carries a row per day. The
    // check is the sum across every period, not one period at a time.
    const result = projectDaily([
      ["2026-01-01", 70, 2],
      ["2026-01-02", 19, 1],
    ]);

    expect(result.observations).toHaveLength(2);
    expect(result.controlTotals[0]?.projectedMinorUnits).toBe("8900");
  });

  it("leaves an import with no stated total exactly as it was", () => {
    const result = projectRange([["2026-01-01", 70, 2]], exactRange({ controlTotals: undefined }));

    expect(result.controlTotals).toEqual([]);
    expect(result.outputs[0]?.valueNumerator).toBe("7000");
  });
});

describe("what a stated total may not say", () => {
  it("refuses a total for an output the declaration does not emit", () => {
    expect(() => exactRange({ controlTotals: [statedTotal({ outputKey: "invented" })] })).toThrow();
  });

  it("refuses a total against a count, because ADR 0029 admits money only", () => {
    expect(() =>
      exactRange({
        outputs: [revenueOutput, ordersOutput],
        controlTotals: [statedTotal({ outputKey: "orders" })],
      }),
    ).toThrow();
  });

  it("refuses two totals for one output, which could only disagree", () => {
    expect(() =>
      exactRange({
        controlTotals: [statedTotal(), statedTotal({ statedTotalMinorUnits: "9000" })],
      }),
    ).toThrow();
  });

  it("refuses a total that is not whole minor units", () => {
    expect(() =>
      exactRange({ controlTotals: [statedTotal({ statedTotalMinorUnits: "89.00" })] }),
    ).toThrow();
  });

  it("refuses a negative tolerance", () => {
    expect(() =>
      exactRange({ controlTotals: [statedTotal({ toleranceMinorUnits: -1 })] }),
    ).toThrow();
  });

  it("refuses a total with no named source, because an unattributed figure is not evidence", () => {
    expect(() => exactRange({ controlTotals: [statedTotal({ statedSource: "" })] })).toThrow();
  });
});
