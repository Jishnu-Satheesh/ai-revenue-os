import { describe, expect, it } from "vitest";

import type { ReportContractDocument } from "@/domain/reports/contracts";
import {
  projectPeriodGrainMetrics,
  reportProjectionDocumentSchema,
  type ReportProjectionDocument,
} from "@/domain/reports/projection";

/**
 * A provider writing a cost as something it took away.
 *
 * `financialSign` asserts what the file contains and changes nothing about it,
 * which is right for validation and wrong for a cost. Keeta writes commission
 * as a positive in its order export and as a negative in its billing report,
 * and one metric cannot hold both and still be summable.
 *
 * So the declaration says which convention the recorded figure follows, and
 * says it in a word an operator can read rather than as a sign flip buried in
 * a projector. It is admitted only on a column the contract already declares
 * negative, which is what stops it inverting a revenue column into a cost.
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
          canonicalField: "bank_fee",
          sourceHeader: "bank_fee",
          parser: "money",
          financialSign: "negative",
          required: true,
        },
        {
          canonicalField: "pos_fee",
          sourceHeader: "pos_fee",
          parser: "money",
          financialSign: "negative",
          required: true,
        },
        {
          canonicalField: "gross_sales",
          sourceHeader: "gross_sales",
          parser: "money",
          financialSign: "positive",
          required: true,
        },
        {
          canonicalField: "order_count",
          sourceHeader: "order_count",
          parser: "integer",
          required: true,
        },
      ],
    },
  ],
  controls: [],
  unmappedFieldDisposition: "reviewed_ignore",
} as unknown as ReportContractDocument;

function declaration(
  output: Record<string, unknown>,
  controlTotals: unknown[] = [],
): ReportProjectionDocument {
  return reportProjectionDocumentSchema.parse({
    schemaVersion: 1,
    outputKind: "period_grain",
    grain: "day",
    periodKey: { normalizedSheetName: "sheet1", canonicalField: "period_date" },
    outputs: [
      {
        key: "payment_processing",
        normalizedSheetName: "sheet1",
        canonicalField: "bank_fee",
        metricKey: "cost.payment_processing",
        valueKind: "money",
        aggregation: "sum",
        ...output,
      },
    ],
    controlTotals,
  });
}

const HEADER = ["Date", "Bank Fee", "POS Fee", "Gross Sales", "Order Count"];

function project(rows: unknown[][], document: ReportProjectionDocument) {
  return projectPeriodGrainMetrics({
    contract,
    document: document as Extract<ReportProjectionDocument, { outputKind: "period_grain" }>,
    declaredCurrency: "AED",
    sheets: [{ normalizedSheetName: "sheet1", rows: [HEADER, ...rows] }],
  });
}

describe("declaring whose sign convention a figure follows", () => {
  it("accepts a deduction recorded as the cost it was", () => {
    expect(() => declaration({ signConvention: "deduction_as_cost" })).not.toThrow();
  });

  it("accepts saying so explicitly that nothing is being restated", () => {
    expect(() => declaration({ signConvention: "as_reported" })).not.toThrow();
  });

  it("refuses a convention nobody defined", () => {
    // The list is closed, so an unknown name refuses the document rather than
    // passing the provider's own sign through under a name that denies it.
    expect(() => declaration({ signConvention: "absolute_value" })).toThrow();
  });

  it("refuses to restate a count, which is not a deduction of anything", () => {
    expect(() =>
      declaration({
        canonicalField: "order_count",
        metricKey: "transactions.count",
        valueKind: "count",
        signConvention: "deduction_as_cost",
      }),
    ).toThrow();
  });

  it("refuses to restate a column the contract does not call a deduction", () => {
    // Without this, the convention is a sign flip any output could claim, and
    // a revenue column could be recorded as a cost.
    expect(() =>
      project(
        [["2026-01-01", -1, -1, 100, 1]],
        declaration({
          canonicalField: "gross_sales",
          metricKey: "revenue.gross",
          signConvention: "deduction_as_cost",
        }),
      ),
    ).toThrow("PROJECTION_SIGN_CONVENTION_MISMATCH");
  });
});

describe("projecting a figure the provider wrote as a deduction", () => {
  it("records the cost rather than a negative cost", () => {
    const result = project(
      [["2026-01-01", -2.89, 0, 170.5, 4]],
      declaration({ signConvention: "deduction_as_cost" }),
    );

    expect(result.observations.map((row) => row.valueNumerator)).toEqual(["289"]);
  });

  it("leaves a figure alone when nothing says to restate it", () => {
    const result = project([["2026-01-01", -2.89, 0, 170.5, 4]], declaration({}));

    expect(result.observations.map((row) => row.valueNumerator)).toEqual(["-289"]);
  });

  it("keeps a zero a zero rather than turning it into a negative zero", () => {
    // The POS fee is charged on four days of the month and written as a plain
    // zero on the rest. A restated zero has to stay a zero.
    const result = project(
      [["2026-01-01", 0, 0, 170.5, 4]],
      declaration({ signConvention: "deduction_as_cost" }),
    );

    expect(result.observations.map((row) => row.valueNumerator)).toEqual(["0"]);
  });

  it("restates every row before adding, so a day's total is in one convention", () => {
    const result = project(
      [
        ["2026-01-01", -2.89, 0, 100, 1],
        ["2026-01-01", -1.34, 0, 100, 1],
      ],
      declaration({ signConvention: "deduction_as_cost" }),
    );

    expect(result.observations.map((row) => row.valueNumerator)).toEqual(["423"]);
    expect(result.observations.map((row) => row.contributorCount)).toEqual([2]);
  });

  it("restates each contributing column of a summed output", () => {
    // Keeta's platform fee is more than one deduction. Adding a restated bank
    // fee to an unrestated POS fee would subtract one cost from the other.
    const result = project(
      [["2026-01-01", -2.89, -50, 100, 1]],
      declaration({ signConvention: "deduction_as_cost", sumWith: ["pos_fee"] }),
    );

    expect(result.observations.map((row) => row.valueNumerator)).toEqual(["5289"]);
  });

  it("checks the operator's stated total in the convention it recorded", () => {
    // An operator reading AED 4.23 of bank charges off Keeta's statement states
    // 423, not -423. The check has to compare like with like or every restated
    // output fails reconciliation on the sign alone.
    const document = declaration({ signConvention: "deduction_as_cost" }, [
      {
        outputKey: "payment_processing",
        source: "operator_stated",
        statedTotalMinorUnits: "423",
        statedSource: "Keeta statement of account, bank charges line",
        toleranceMinorUnits: 0,
      },
    ]);

    expect(() =>
      project(
        [
          ["2026-01-01", -2.89, 0, 100, 1],
          ["2026-01-02", -1.34, 0, 100, 1],
        ],
        document,
      ),
    ).not.toThrow();
  });
});
