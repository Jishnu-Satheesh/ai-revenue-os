import { describe, expect, it } from "vitest";

import type { ReportContractDocument } from "@/domain/reports/contracts";
import { createReportProjectionResultDigest } from "@/domain/reports/document-digest";
import {
  projectExactRangeMetrics,
  projectPeriodGrainMetrics,
  reportProjectionDocumentSchema,
  type ReportProjectionDocument,
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

const categoricalContract: ReportContractDocument = {
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
          canonicalField: "reason_code",
          sourceHeader: "reason_code",
          parser: "text",
          required: false,
        },
      ],
    },
  ],
  controls: [],
  unmappedFieldDisposition: "reviewed_ignore",
} as unknown as ReportContractDocument;

/**
 * The CSV export of a report whose XLSX writes the second reason into an
 * injected cell. Same fact, one cell, a separator between them.
 */
function categoricalFixture({
  valueSeparator,
  cell,
}: {
  valueSeparator: string | undefined;
  cell: string;
}) {
  const document = reportProjectionDocumentSchema.parse({
    schemaVersion: 1,
    outputKind: "period_grain",
    grain: "day",
    periodKey: { normalizedSheetName: "sheet1", canonicalField: "period_date" },
    outputs: [
      {
        key: "closed_days_by_reason",
        normalizedSheetName: "sheet1",
        canonicalField: "reason_code",
        metricKey: "operations.closed_days",
        valueKind: "count",
        aggregation: "sum",
        categorical: {
          dimensionKey: "reason_code",
          allowedValues: ["CHECK_IN_REQUIRED", "UNREACHABLE"],
          collectInjectedValues: false,
          ...(valueSeparator === undefined ? {} : { valueSeparator }),
        },
      },
    ],
    controlTotals: [],
  }) as Extract<ReportProjectionDocument, { outputKind: "period_grain" }>;

  return {
    contract: categoricalContract,
    document,
    declaredCurrency: "AED",
    sheets: [
      { normalizedSheetName: "sheet1", rows: [["Date", "Reason Code"], ["2026-01-01", cell]] },
    ],
  };
}

describe("a categorical cell carrying two labels", () => {
  // The CSV export of a report whose XLSX writes the second reason into an
  // injected cell. Same fact, one cell, a separator between them.
  it("counts the first declared label when a separator is declared", () => {
    const result = projectPeriodGrainMetrics(
      categoricalFixture({ valueSeparator: ";", cell: "CHECK_IN_REQUIRED;UNREACHABLE" }),
    );
    const counted = result.observations.filter(
      (o) => o.dimensions?.reason_code === "CHECK_IN_REQUIRED",
    );
    expect(counted).toHaveLength(1);
    expect(result.observations.some((o) => o.dimensions?.reason_code === "UNREACHABLE")).toBe(
      false,
    );
  });

  it("refuses the joined value when no separator is declared", () => {
    expect(() =>
      projectPeriodGrainMetrics(
        categoricalFixture({ valueSeparator: undefined, cell: "CHECK_IN_REQUIRED;UNREACHABLE" }),
      ),
    ).toThrow(/CATEGORICAL_VALUE_NOT_DECLARED/);
  });

  it("reads an unjoined value unchanged when a separator is declared", () => {
    const result = projectPeriodGrainMetrics(
      categoricalFixture({ valueSeparator: ";", cell: "UNREACHABLE" }),
    );
    expect(result.observations.some((o) => o.dimensions?.reason_code === "UNREACHABLE")).toBe(
      true,
    );
  });

  it("still refuses a first value that is not declared", () => {
    expect(() =>
      projectPeriodGrainMetrics(
        categoricalFixture({ valueSeparator: ";", cell: "CLOSED;UNREACHABLE" }),
      ),
    ).toThrow(/CATEGORICAL_VALUE_NOT_DECLARED/);
  });

  it("treats a cell that is only a separator as absent", () => {
    const result = projectPeriodGrainMetrics(categoricalFixture({ valueSeparator: ";", cell: ";" }));
    expect(
      result.observations.filter((o) => o.dimensions?.reason_code !== undefined),
    ).toHaveLength(0);
  });

  it("counts the second label when the first slot is empty", () => {
    // An empty leading slot lists nothing, so the first *listed* reason is
    // whatever comes after it -- not undeclared, merely in second position.
    const result = projectPeriodGrainMetrics(
      categoricalFixture({ valueSeparator: ";", cell: ";UNREACHABLE" }),
    );
    expect(result.observations.some((o) => o.dimensions?.reason_code === "UNREACHABLE")).toBe(
      true,
    );
  });

  it("treats a cell of only separators as absent", () => {
    const result = projectPeriodGrainMetrics(
      categoricalFixture({ valueSeparator: ";", cell: ";;" }),
    );
    expect(
      result.observations.filter((o) => o.dimensions?.reason_code !== undefined),
    ).toHaveLength(0);
  });
});
