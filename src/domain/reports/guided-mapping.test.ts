import { describe, expect, it } from "vitest";

import {
  buildGuidedContractDocument,
  buildGuidedProjectionDocument,
  GuidedProjectionUndecidable,
  guidedReportMappingSchema,
} from "@/domain/reports/guided-mapping";
import { reportContractDocumentSchema } from "@/domain/reports/contracts";
import { projectExactRangeMetrics, projectPeriodGrainMetrics } from "@/domain/reports/projection";

function answers(overrides: Record<string, unknown> = {}) {
  return guidedReportMappingSchema.parse({
    normalizedSheetName: "sales_report",
    headerRow: 1,
    periodColumn: { sourceHeader: "order_date", encoding: "iso_date" },
    salesColumn: "total_sales",
    ordersColumn: "total_orders",
    ...overrides,
  });
}

const build = (overrides: Record<string, unknown> = {}) =>
  buildGuidedContractDocument({ answers: answers(overrides), declaredCurrency: "AED" });

describe("assembling a contract from an operator's answers", () => {
  it("binds each named column to the figure it was pointed at", () => {
    const sheet = build().sheets[0];

    expect(sheet.fields.map((field) => [field.canonicalField, field.sourceHeader])).toEqual([
      ["period_date", "order_date"],
      ["gross_sales", "total_sales"],
      ["order_count", "total_orders"],
    ]);
    expect(sheet.fields[0]?.dateEncoding).toBe("iso_date");
    expect(sheet.fields[1]?.financialSign).toBe("positive");
  });

  it("leaves out a figure the file does not carry", () => {
    const sheet = build({ ordersColumn: undefined }).sheets[0];

    expect(sheet.fields.map((field) => field.canonicalField)).toEqual([
      "period_date",
      "gross_sales",
    ]);
  });

  it("expects gaps in a daily series and none in a period total", () => {
    // A provider writing a row per day leaves figures blank on days it has
    // nothing to say about. A single total for the period is unknowable if any
    // row is silent, so there every row must carry a value.
    expect(build().sheets[0].fields[1]?.required).toBe(false);
    expect(build({ periodColumn: undefined }).sheets[0].fields[0]?.required).toBe(true);
  });

  it("carries the provider's own way of writing 'no data'", () => {
    const sheet = build({ absentMarkers: ["-"] }).sheets[0];

    expect(sheet.fields[1]?.absentMarkers).toEqual(["-"]);
  });

  it("records a totals row and the column its label sits in", () => {
    const sheet = build({ totalsRow: { sourceHeader: "pos_id", label: "Total" } }).sheets[0];

    expect(sheet.totalsRow).toEqual({ canonicalField: "row_label", label: "Total" });
    expect(sheet.fields.at(-1)).toMatchObject({ canonicalField: "row_label", parser: "text" });
  });

  it("reads its data from the row after the headings", () => {
    expect(build({ headerRow: 3 }).sheets[0].dataStartRow).toBe(4);
  });
});

describe("what an operator cannot answer", () => {
  it("refuses a mapping that would record nothing", () => {
    expect(() => answers({ salesColumn: undefined, ordersColumn: undefined })).toThrow();
  });

  it("refuses one column claimed as two different figures", () => {
    expect(() => answers({ salesColumn: "total", ordersColumn: "total" })).toThrow();
  });

  it("refuses the date column doubling as a figure", () => {
    expect(() => answers({ salesColumn: "order_date" })).toThrow();
  });

  it("refuses a totals label in a column that carries a figure", () => {
    // The cell would have to be read as a word and as an amount at once.
    expect(() =>
      answers({ totalsRow: { sourceHeader: "total_sales", label: "Total" } }),
    ).toThrow();
  });
});

describe("the declaration that follows from the approved contract", () => {
  it("projects a daily series when a date column was named", () => {
    const document = buildGuidedProjectionDocument(build());

    expect(document.outputKind).toBe("period_grain");
    expect(document.outputs.map((output) => output.metricKey)).toEqual([
      "revenue.gross",
      "transactions.count",
    ]);
  });

  it("projects one period total when no date column was named", () => {
    expect(buildGuidedProjectionDocument(build({ periodColumn: undefined })).outputKind).toBe(
      "exact_range",
    );
  });

  it("checks the import against the total the sheet states", () => {
    const document = buildGuidedProjectionDocument(
      build({ totalsRow: { sourceHeader: "pos_id", label: "Total" } }),
    );

    expect(document.controlTotals).toEqual([
      { outputKey: "gross_revenue", source: "sheet_totals_row", toleranceMinorUnits: 0 },
    ]);
  });

  it("states no total to check when the sheet states none", () => {
    expect(buildGuidedProjectionDocument(build()).controlTotals).toEqual([]);
  });
});

describe("figures for a mapping this path did not write", () => {
  // A contract written before the guided path existed uses whatever field
  // names the person chose. Reading what each column *is* rather than what it
  // is called is what lets those keep working.
  const legacy = (fields: unknown[]) =>
    reportContractDocumentSchema.parse({
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
          fields,
        },
      ],
      controls: [],
      unmappedFieldDisposition: "reviewed_ignore",
    });

  it("records both figures from names it has never seen", () => {
    const document = buildGuidedProjectionDocument(
      legacy([
        { canonicalField: "gross_sales", sourceHeader: "gross_sales", parser: "money", financialSign: "positive", required: true },
        { canonicalField: "successful_orders", sourceHeader: "successful_orders", parser: "integer", required: true },
      ]),
    );

    expect(document.outputKind).toBe("exact_range");
    expect(document.outputs.map((output) => [output.canonicalField, output.metricKey])).toEqual([
      ["gross_sales", "revenue.gross"],
      ["successful_orders", "transactions.count"],
    ]);
  });

  it("refuses rather than guessing which of two money columns is the sales", () => {
    // Proposing one of them would read half the file and look complete.
    expect(() =>
      buildGuidedProjectionDocument(
        legacy([
          { canonicalField: "gross_sales", sourceHeader: "gross_sales", parser: "money", financialSign: "positive", required: true },
          { canonicalField: "net_sales", sourceHeader: "net_sales", parser: "money", financialSign: "positive", required: true },
        ]),
      ),
    ).toThrow(GuidedProjectionUndecidable);
  });

  it("refuses a mapping with no figure in it at all", () => {
    expect(() =>
      buildGuidedProjectionDocument(
        legacy([{ canonicalField: "outlet", sourceHeader: "outlet", parser: "text", required: true }]),
      ),
    ).toThrow(GuidedProjectionUndecidable);
  });

  it("dates a series only when every row must carry a date", () => {
    const optionalDate = legacy([
      { canonicalField: "seen_on", sourceHeader: "seen_on", parser: "local_date", required: false },
      { canonicalField: "gross_sales", sourceHeader: "gross_sales", parser: "money", financialSign: "positive", required: true },
    ]);

    expect(buildGuidedProjectionDocument(optionalDate).outputKind).toBe("exact_range");
  });
});

describe("the pair actually reads a file", () => {
  // The real proof: the two documents an operator's answers produced have to
  // work together against rows shaped like the file they were describing.
  const HEADER = ["Order Date", "Total Sales", "Total Orders", "POS ID"];

  it("reads a daily series, leaving the days the provider skipped absent", () => {
    const contract = build({ absentMarkers: ["-"] });
    const document = buildGuidedProjectionDocument(contract);
    if (document.outputKind !== "period_grain") throw new Error("expected a daily series");

    const result = projectPeriodGrainMetrics({
      contract,
      document,
      declaredCurrency: "AED",
      sheets: [
        {
          normalizedSheetName: "sales_report",
          rows: [HEADER, ["2026-08-01", 70, 2, ""], ["2026-08-02", "-", "-", ""]],
        },
      ],
    });

    expect(result.observations).toHaveLength(2);
    expect(result.observations[0]).toMatchObject({ periodStart: "2026-08-01", valueNumerator: "7000" });
    expect(result.absentRowCount).toBe(2);
  });

  it("reads a period total, setting aside the row the provider totalled", () => {
    const contract = build({
      periodColumn: undefined,
      totalsRow: { sourceHeader: "pos_id", label: "Total" },
    });
    const document = buildGuidedProjectionDocument(contract);
    if (document.outputKind !== "exact_range") throw new Error("expected a period total");

    const result = projectExactRangeMetrics({
      contract,
      document,
      declaredCurrency: "AED",
      sheets: [
        {
          normalizedSheetName: "sales_report",
          rows: [HEADER, ["", 89, 3, "Total"], ["", 70, 2, "POS-1"], ["", 19, 1, "POS-2"]],
        },
      ],
    });

    expect(result.outputs[0]?.valueNumerator).toBe("8900");
    expect(result.controlTotals[0]).toMatchObject({
      statedMinorUnits: "8900",
      differenceMinorUnits: "0",
    });
  });
});
