import { describe, expect, it } from "vitest";

import {
  createReportProjectionResultDigest,
  projectExactRangeMetrics,
  reportProjectionDocumentSchema,
} from "@/domain/reports/projection";

const contract = {
  schemaVersion: 1 as const,
  currency: "AED",
  outletGrain: "branch" as const,
  sheets: [
    {
      normalizedSheetName: "settlement",
      headerRow: 1,
      dataStartRow: 2,
      allowFormula: false,
      allowMergedCells: false,
      fields: [
        {
          canonicalField: "net_sales",
          sourceHeader: "net_sales",
          parser: "money" as const,
          required: true,
          financialSign: "positive" as const,
        },
        {
          canonicalField: "order_count",
          sourceHeader: "order_count",
          parser: "integer" as const,
          required: true,
        },
      ],
    },
  ],
  controls: [],
  unmappedFieldDisposition: "reviewed_ignore" as const,
};

const declaration = {
  schemaVersion: 1,
  outputKind: "exact_range",
  outputs: [
    {
      key: "gross_revenue",
      normalizedSheetName: "settlement",
      canonicalField: "net_sales",
      metricKey: "revenue.gross",
      valueKind: "money",
      aggregation: "sum",
    },
    {
      key: "transactions",
      normalizedSheetName: "settlement",
      canonicalField: "order_count",
      metricKey: "transactions.count",
      valueKind: "count",
      aggregation: "sum",
    },
  ],
};

describe("governed exact-range report projection", () => {
  it("aggregates approved money and count fields without returning workbook values", () => {
    const document = reportProjectionDocumentSchema.parse(declaration);
    const result = projectExactRangeMetrics({
      contract,
      document,
      declaredCurrency: "AED",
      sheets: [
        {
          normalizedSheetName: "settlement",
          rows: [
            ["net_sales", "order_count", "customer_reference"],
            ["12.34", "2", "private-order-42"],
            ["0.66", "1", "private-order-84"],
          ],
        },
      ],
    });

    expect(result.outputs).toEqual([
      {
        key: "gross_revenue",
        metricKey: "revenue.gross",
        valueKind: "money",
        valueNumerator: "1300",
        currency: "AED",
        normalizedSheetName: "settlement",
        canonicalField: "net_sales",
        firstDataRow: 2,
        lastDataRow: 3,
        contributorCount: 2,
      },
      {
        key: "transactions",
        metricKey: "transactions.count",
        valueKind: "count",
        valueNumerator: "3",
        currency: null,
        normalizedSheetName: "settlement",
        canonicalField: "order_count",
        firstDataRow: 2,
        lastDataRow: 3,
        contributorCount: 2,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("private-order-42");
    expect(JSON.stringify(result)).not.toContain("private-order-84");
  });

  it("rejects a declaration that maps a money field to a count metric output", () => {
    const document = reportProjectionDocumentSchema.parse({
      ...declaration,
      outputs: [{ ...declaration.outputs[0], valueKind: "count" }],
    });

    expect(() =>
      projectExactRangeMetrics({
        contract,
        document,
        declaredCurrency: "AED",
        sheets: [{ normalizedSheetName: "settlement", rows: [["net_sales"], ["12.34"]] }],
      }),
    ).toThrow("PROJECTION_FIELD_VALUE_KIND_MISMATCH");
  });

  it("rejects invalid money rather than coercing it", () => {
    const document = reportProjectionDocumentSchema.parse({
      ...declaration,
      outputs: [declaration.outputs[0]],
    });

    expect(() =>
      projectExactRangeMetrics({
        contract,
        document,
        declaredCurrency: "AED",
        sheets: [{ normalizedSheetName: "settlement", rows: [["net_sales"], ["12,34"]] }],
      }),
    ).toThrow("INVALID_MONEY");
  });

  it("has a deterministic digest for equivalent safe aggregate results", () => {
    const document = reportProjectionDocumentSchema.parse(declaration);
    const first = projectExactRangeMetrics({
      contract,
      document,
      declaredCurrency: "AED",
      sheets: [{ normalizedSheetName: "settlement", rows: [["net_sales", "order_count"], ["13.00", "3"]] }],
    });
    const second = projectExactRangeMetrics({
      contract,
      document,
      declaredCurrency: "AED",
      sheets: [{ normalizedSheetName: "settlement", rows: [["net_sales", "order_count"], ["13.00", "3"]] }],
    });

    expect(createReportProjectionResultDigest(first)).toBe(
      createReportProjectionResultDigest(second),
    );
  });
});
