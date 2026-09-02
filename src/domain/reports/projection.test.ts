import { describe, expect, it } from "vitest";

import type { ReportContractDocument } from "@/domain/reports/contracts";
import { createReportProjectionResultDigest } from "@/domain/reports/document-digest";
import {
  projectExactRangeMetrics,
  projectPeriodGrainMetrics,
  reportProjectionDocumentSchema,
  ReportCategoricalValueNotDeclared,
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
      sheets: [
        {
          normalizedSheetName: "settlement",
          rows: [
            ["net_sales", "order_count"],
            ["13.00", "3"],
          ],
        },
      ],
    });
    const second = projectExactRangeMetrics({
      contract,
      document,
      declaredCurrency: "AED",
      sheets: [
        {
          normalizedSheetName: "settlement",
          rows: [
            ["net_sales", "order_count"],
            ["13.00", "3"],
          ],
        },
      ],
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
      {
        normalizedSheetName: "sheet1",
        rows: [
          ["Date", "Reason Code"],
          ["2026-01-01", cell],
        ],
      },
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
    let thrown: unknown;
    try {
      projectPeriodGrainMetrics(
        categoricalFixture({ valueSeparator: undefined, cell: "CHECK_IN_REQUIRED;UNREACHABLE" }),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ReportCategoricalValueNotDeclared);
    const failure = thrown as ReportCategoricalValueNotDeclared;
    expect(failure.code).toBe("CATEGORICAL_VALUE_NOT_DECLARED");
    // With no separator declared, the whole cell is the one and only "first"
    // segment -- there is nothing to split, so the joined text is the value.
    expect(failure.value).toBe("CHECK_IN_REQUIRED;UNREACHABLE");
  });

  it("reads an unjoined value unchanged when a separator is declared", () => {
    const result = projectPeriodGrainMetrics(
      categoricalFixture({ valueSeparator: ";", cell: "UNREACHABLE" }),
    );
    expect(result.observations.some((o) => o.dimensions?.reason_code === "UNREACHABLE")).toBe(true);
  });

  it("still refuses a first value that is not declared", () => {
    let thrown: unknown;
    try {
      projectPeriodGrainMetrics(
        categoricalFixture({ valueSeparator: ";", cell: "CLOSED;UNREACHABLE" }),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ReportCategoricalValueNotDeclared);
    const failure = thrown as ReportCategoricalValueNotDeclared;
    expect(failure.code).toBe("CATEGORICAL_VALUE_NOT_DECLARED");
    // Only the first segment is the value, not the whole joined cell -- that
    // is what the field's declared vocabulary would have to admit.
    expect(failure.value).toBe("CLOSED");
  });

  it("treats a cell that is only a separator as absent", () => {
    const result = projectPeriodGrainMetrics(
      categoricalFixture({ valueSeparator: ";", cell: ";" }),
    );
    expect(result.observations.filter((o) => o.dimensions?.reason_code !== undefined)).toHaveLength(
      0,
    );
  });

  it("counts the second label when the first slot is empty", () => {
    // An empty leading slot lists nothing, so the first *listed* reason is
    // whatever comes after it -- not undeclared, merely in second position.
    const result = projectPeriodGrainMetrics(
      categoricalFixture({ valueSeparator: ";", cell: ";UNREACHABLE" }),
    );
    expect(result.observations.some((o) => o.dimensions?.reason_code === "UNREACHABLE")).toBe(true);
  });

  it("treats a cell of only separators as absent", () => {
    const result = projectPeriodGrainMetrics(
      categoricalFixture({ valueSeparator: ";", cell: ";;" }),
    );
    expect(result.observations.filter((o) => o.dimensions?.reason_code !== undefined)).toHaveLength(
      0,
    );
  });
});

/**
 * A cancellation-reason column mirroring Talabat's real one: one declared
 * label, `ITEM_UNAVAILABLE`, and an undeclared one a real March export
 * carried without warning. The key is named `avoidable_cancel_reason` to
 * match the live output that refused the client's file.
 */
const cancelReasonContract: ReportContractDocument = {
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
          canonicalField: "avoidable_cancellation_reason",
          sourceHeader: "avoidable_cancellation_reason",
          parser: "text",
          required: false,
        },
      ],
    },
  ],
  controls: [],
  unmappedFieldDisposition: "reviewed_ignore",
} as unknown as ReportContractDocument;

function cancelReasonDocument() {
  return reportProjectionDocumentSchema.parse({
    schemaVersion: 1,
    outputKind: "period_grain",
    grain: "day",
    periodKey: { normalizedSheetName: "sheet1", canonicalField: "period_date" },
    outputs: [
      {
        key: "avoidable_cancel_reason",
        normalizedSheetName: "sheet1",
        canonicalField: "avoidable_cancellation_reason",
        metricKey: "order.avoidable_cancellation_reason",
        valueKind: "count",
        aggregation: "sum",
        categorical: {
          dimensionKey: "reason_code",
          allowedValues: ["ITEM_UNAVAILABLE"],
          collectInjectedValues: false,
        },
      },
    ],
    controlTotals: [],
  }) as Extract<ReportProjectionDocument, { outputKind: "period_grain" }>;
}

/**
 * Every date in `periodKeys` carries the undeclared value; one extra day
 * ahead of them carries the one label the contract does declare, so a
 * regression that refused the whole column -- rather than the specific value
 * -- would not be caught by a fixture where every row was undeclared.
 */
function sheetsWithCancellationReason(undeclaredValue: string, periodKeys: readonly string[]) {
  return [
    {
      normalizedSheetName: "sheet1",
      rows: [
        ["Date", "Avoidable Cancellation Reason"],
        ["2026-03-01", "ITEM_UNAVAILABLE"],
        ...periodKeys.map((date) => [date, undeclaredValue]),
      ],
    },
  ];
}

describe("an undeclared categorical value", () => {
  it("names the label it refused and the days it appeared on", () => {
    // Talabat's March export carries the cancellation reason CLOSED, which the
    // approved figures do not declare. Refusing is right. Refusing without
    // saying what offended is what sent a live operator to the code.
    let thrown: unknown;
    try {
      projectPeriodGrainMetrics({
        contract: cancelReasonContract,
        document: cancelReasonDocument(),
        declaredCurrency: "AED",
        declaredPeriod: { periodStart: "2026-03-01", periodEnd: "2026-03-31" },
        sheets: sheetsWithCancellationReason("CLOSED", ["2026-03-04", "2026-03-11"]),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ReportCategoricalValueNotDeclared);
    const failure = thrown as ReportCategoricalValueNotDeclared;
    expect(failure.code).toBe("CATEGORICAL_VALUE_NOT_DECLARED");
    expect(failure.value).toBe("CLOSED");
    expect(failure.outputKey).toBe("avoidable_cancel_reason");
    expect(failure.periodKeys).toEqual(["2026-03-04", "2026-03-11"]);
    // failureDetail() joins name, code and message. Today all three are the code.
    expect(failure.message).toContain("CLOSED");
    expect(failure.message).toContain("avoidable_cancel_reason");
  });

  it("caps the days named in the message so the label and output key survive truncation", () => {
    // failureDetail() truncates the joined name/code/message to 300
    // characters. A month of offending dates would overflow that and could
    // push the label itself past the cut -- the one part an operator needs.
    const periodKeys = [
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
      "2026-03-10",
      "2026-03-11",
    ];
    let thrown: unknown;
    try {
      projectPeriodGrainMetrics({
        contract: cancelReasonContract,
        document: cancelReasonDocument(),
        declaredCurrency: "AED",
        declaredPeriod: { periodStart: "2026-03-01", periodEnd: "2026-03-31" },
        sheets: sheetsWithCancellationReason("CLOSED", periodKeys),
      });
    } catch (error) {
      thrown = error;
    }

    const failure = thrown as ReportCategoricalValueNotDeclared;
    expect(failure.periodKeys).toEqual(periodKeys);
    // The full, untruncated list of days is still on the error object -- only
    // the message shown to the operator is capped.
    expect(failure.message).toContain("avoidable_cancel_reason: CLOSED");
    expect(failure.message).not.toContain(periodKeys[9]);
    expect(failure.message).toContain("+2 more");
  });

  it("bounds an oversized undeclared value instead of trusting it", () => {
    // A declared label can never exceed 64 characters -- the document schema
    // enforces that on `allowedValues`. An *undeclared* value carries no such
    // guarantee: it is whatever text sat in that cell, and a mis-detected
    // ragged-row shift could feed an unrelated cell in at this position. This
    // is the one place that text becomes a persisted, operator-visible
    // record, so it is bounded here rather than trusted.
    const overlong = "X".repeat(120);
    let thrown: unknown;
    try {
      projectPeriodGrainMetrics({
        contract: cancelReasonContract,
        document: cancelReasonDocument(),
        declaredCurrency: "AED",
        declaredPeriod: { periodStart: "2026-03-01", periodEnd: "2026-03-31" },
        sheets: sheetsWithCancellationReason(overlong, ["2026-03-04"]),
      });
    } catch (error) {
      thrown = error;
    }

    const failure = thrown as ReportCategoricalValueNotDeclared;
    // 64 kept characters plus the trailing marker, never the full 120.
    expect(failure.value).toBe(`${"X".repeat(64)}…`);
    expect(failure.value.length).toBe(65);
    // The message is built from the bounded value, not the raw one.
    expect(failure.message).toContain(failure.value);
    expect(failure.message).not.toContain(overlong);
  });
});
