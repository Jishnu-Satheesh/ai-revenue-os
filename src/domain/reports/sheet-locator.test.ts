import { describe, expect, it } from "vitest";

import { reportContractDocumentSchema } from "@/domain/reports/contracts";
import { projectExactRangeMetrics, reportProjectionDocumentSchema } from "@/domain/reports/projection";
import { selectContractSheet } from "@/domain/reports/sheet-locator";

const sheets = [
  { normalizedSheetName: "talabat_jan_feb_2026_performanc" },
  { normalizedSheetName: "notes" },
];

describe("finding the sheet a contract describes", () => {
  it("matches by name when nothing else is declared", () => {
    expect(selectContractSheet({ normalizedSheetName: "notes" }, sheets)).toBe(sheets[1]);
    expect(selectContractSheet({ normalizedSheetName: "absent" }, sheets)).toBeUndefined();
  });

  it("matches by position whatever the provider called the sheet", () => {
    // Talabat names the worksheet after the export range, so January's download
    // and March's do not share a name. The contract that was approved against
    // one has to keep working on the other.
    const rule = { normalizedSheetName: "performance", sheetLocator: { kind: "position", position: 1 } } as const;

    expect(selectContractSheet(rule, sheets)).toBe(sheets[0]);
    expect(selectContractSheet(rule, [{ normalizedSheetName: "talabat_mar_2026_performance" }])).toEqual({
      normalizedSheetName: "talabat_mar_2026_performance",
    });
  });

  it("finds nothing rather than the wrong tab when the position is not there", () => {
    const rule = { normalizedSheetName: "performance", sheetLocator: { kind: "position", position: 4 } } as const;

    expect(selectContractSheet(rule, sheets)).toBeUndefined();
  });
});

const contract = reportContractDocumentSchema.parse({
  schemaVersion: 1,
  currency: "AED",
  outletGrain: "branch",
  sheets: [
    {
      normalizedSheetName: "performance",
      sheetLocator: { kind: "position", position: 1 },
      headerRow: 1,
      dataStartRow: 2,
      allowFormula: false,
      allowMergedCells: false,
      fields: [
        {
          canonicalField: "gross_sales",
          sourceHeader: "gross_sales",
          parser: "money",
          required: true,
          financialSign: "positive",
        },
      ],
    },
  ],
  controls: [],
  unmappedFieldDisposition: "reviewed_ignore",
});

describe("projecting through a positional locator", () => {
  it("reads the file even though its sheet is named after a different month", () => {
    const document = reportProjectionDocumentSchema.parse({
      schemaVersion: 1,
      outputKind: "exact_range",
      outputs: [
        {
          key: "gross_revenue",
          normalizedSheetName: "performance",
          canonicalField: "gross_sales",
          metricKey: "revenue.gross",
          valueKind: "money",
          aggregation: "sum",
        },
      ],
    });

    const result = projectExactRangeMetrics({
      contract,
      document,
      declaredCurrency: "AED",
      sheets: [
        { normalizedSheetName: "talabat_mar_2026_performance_re", rows: [["Gross Sales"], [70], [19]] },
      ],
    });

    expect(result.outputs[0]?.valueNumerator).toBe("8900");
  });
});

describe("what a contract may say about positions", () => {
  it("refuses two sheets read from the same position", () => {
    expect(() =>
      reportContractDocumentSchema.parse({
        ...contract,
        sheets: [
          contract.sheets[0],
          { ...contract.sheets[0], normalizedSheetName: "second" },
        ],
      }),
    ).toThrow();
  });
});
