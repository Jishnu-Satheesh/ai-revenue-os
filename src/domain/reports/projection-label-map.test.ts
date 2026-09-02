import { describe, expect, it } from "vitest";

import type { ReportContractDocument } from "@/domain/reports/contracts";
import {
  projectPeriodGrainMetrics,
  reportProjectionDocumentSchema,
  type ReportProjectionDocument,
} from "@/domain/reports/projection";

/**
 * A provider that labels its rows in sentences.
 *
 * ADR 0034 stores a category as a dimension value on the numeric row, and a
 * dimension value has to be a stable key: something a detector groups on and a
 * chart compares across providers. Talabat already writes keys -- its closed
 * days say `CHECK_IN_REQUIRED`. Keeta writes English: `Cancelled by merchant`.
 *
 * The declared label map is the translation, approved with the rest of the
 * document rather than guessed at import time. What it must not do is loosen
 * the refusal: text the map does not carry still stops the import, because an
 * unmapped label is exactly how a provider's vocabulary changes underneath a
 * breakdown that will be read as complete.
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
          // Keeta writes `-` here on every order it did not cancel.
          canonicalField: "cancellation_type",
          sourceHeader: "cancellation_type",
          parser: "text",
          absentMarkers: ["-"],
          required: false,
        },
        {
          canonicalField: "reason_code",
          sourceHeader: "reason_code",
          parser: "text",
          required: false,
        },
        {
          canonicalField: "order_count",
          sourceHeader: "order_count",
          parser: "integer",
          required: false,
        },
      ],
    },
  ],
  controls: [],
  unmappedFieldDisposition: "reviewed_ignore",
} as unknown as ReportContractDocument;

const MERCHANT = "Cancelled by merchant";
const CUSTOMER_SERVICE = "Cancelled by customer service";
const PLATFORM = "Cancelled by Keeta (compensation to restaurant)";

function declaration(
  categorical: Record<string, unknown>,
  output: Record<string, unknown> = {},
): ReportProjectionDocument {
  return reportProjectionDocumentSchema.parse({
    schemaVersion: 1,
    outputKind: "period_grain",
    grain: "day",
    periodKey: { normalizedSheetName: "sheet1", canonicalField: "period_date" },
    outputs: [
      {
        key: "cancellation_party",
        normalizedSheetName: "sheet1",
        canonicalField: "cancellation_type",
        metricKey: "order.cancellation_attribution_count",
        valueKind: "count",
        aggregation: "sum",
        ...output,
        categorical: {
          dimensionKey: "cancelled_by",
          collectInjectedValues: false,
          ...categorical,
        },
      },
    ],
    controlTotals: [],
  });
}

const mapped = () =>
  declaration({
    allowedValues: ["MERCHANT", "CUSTOMER_SERVICE", "PLATFORM"],
    labelMap: {
      [MERCHANT]: "MERCHANT",
      [CUSTOMER_SERVICE]: "CUSTOMER_SERVICE",
      [PLATFORM]: "PLATFORM",
    },
  });

const HEADER = ["Date", "Cancellation Type", "Reason Code", "Order Count"];

function project(rows: unknown[][], document: ReportProjectionDocument) {
  return projectPeriodGrainMetrics({
    contract,
    document: document as Extract<ReportProjectionDocument, { outputKind: "period_grain" }>,
    declaredCurrency: "AED",
    sheets: [{ normalizedSheetName: "sheet1", rows: [HEADER, ...rows] }],
  });
}

describe("declaring what a provider's own words mean", () => {
  it("accepts a map that reaches every value the output allows", () => {
    expect(() => mapped()).not.toThrow();
  });

  it("refuses a label mapped to a code the output never declared", () => {
    // Otherwise the map is a second, unapproved vocabulary: the allowed list
    // says what an operator signed off and the map quietly writes something
    // else into the breakdown.
    expect(() =>
      declaration({
        allowedValues: ["MERCHANT"],
        labelMap: { [MERCHANT]: "MERCHANT", [CUSTOMER_SERVICE]: "CUSTOMER_SERVICE" },
      }),
    ).toThrow();
  });

  it("refuses a declared code that no label can ever produce", () => {
    // A category that cannot be written reads, in an approved document, as a
    // category that simply never occurred.
    expect(() =>
      declaration({
        allowedValues: ["MERCHANT", "CUSTOMER_SERVICE"],
        labelMap: { [MERCHANT]: "MERCHANT" },
      }),
    ).toThrow();
  });

  it("refuses two labels that differ only by case or spacing", () => {
    // Cells are matched with both ignored, so these are one rule with two
    // answers and which wins would depend on key order.
    expect(() =>
      declaration({
        allowedValues: ["MERCHANT"],
        labelMap: { [MERCHANT]: "MERCHANT", "  cancelled BY merchant ": "MERCHANT" },
      }),
    ).toThrow();
  });

  it("refuses a blank provider label", () => {
    expect(() =>
      declaration({ allowedValues: ["MERCHANT"], labelMap: { "   ": "MERCHANT" } }),
    ).toThrow();
  });

  it("refuses a mapped value that is not a code", () => {
    // The mapped value becomes a dimension key. Prose on both sides of the map
    // would defeat the point of having one.
    expect(() =>
      declaration({
        allowedValues: ["MERCHANT"],
        labelMap: { [MERCHANT]: "Cancelled by merchant" },
      }),
    ).toThrow();
  });

  it("still accepts a column that already writes codes, with no map at all", () => {
    // Talabat's closed-day reasons. Adding the capability must not require it.
    expect(() =>
      declaration({ allowedValues: ["CHECK_IN_REQUIRED", "UNREACHABLE"] }),
    ).not.toThrow();
  });
});

describe("projecting a column the provider writes in sentences", () => {
  it("counts each day's labels under the code the map declares", () => {
    const result = project(
      [
        ["2026-01-01", MERCHANT, null, 1],
        ["2026-01-01", MERCHANT, null, 1],
        ["2026-01-01", PLATFORM, null, 1],
      ],
      mapped(),
    );

    expect(
      result.observations.map((row) => [row.dimensions?.cancelled_by, row.valueNumerator]),
    ).toEqual([
      ["MERCHANT", "2"],
      ["PLATFORM", "1"],
    ]);
  });

  it("reads the provider's absent marker as no category at all", () => {
    // Keeta writes `-` on every completed order. Counting it would invent a
    // fourth party responsible for four in five orders.
    const result = project(
      [
        ["2026-01-01", "-", null, 1],
        ["2026-01-01", MERCHANT, null, 1],
      ],
      mapped(),
    );

    expect(
      result.observations.map((row) => [row.dimensions?.cancelled_by, row.valueNumerator]),
    ).toEqual([["MERCHANT", "1"]]);
  });

  it("says nothing for a day whose every row was absent", () => {
    const result = project([["2026-01-01", "-", null, 1]], mapped());

    expect(result.observations).toEqual([]);
  });

  it("matches a label whatever its casing and surrounding spaces", () => {
    const result = project([["2026-01-01", "  CANCELLED BY MERCHANT ", null, 1]], mapped());

    expect(result.observations.map((row) => row.dimensions?.cancelled_by)).toEqual(["MERCHANT"]);
  });

  it("refuses a label the map does not carry", () => {
    // The day a provider adds a category is the day the breakdown starts to
    // rot. Refusing turns that into a contract revision instead of silence.
    expect(() => project([["2026-01-01", "Cancelled by courier", null, 1]], mapped())).toThrow(
      "CATEGORICAL_VALUE_NOT_DECLARED",
    );
  });

  it("tags the observation with the declared dimension key", () => {
    const result = project([["2026-01-01", CUSTOMER_SERVICE, null, 1]], mapped());

    expect(result.observations[0]?.dimensions).toEqual({ cancelled_by: "CUSTOMER_SERVICE" });
    expect(result.observations[0]?.metricKey).toBe("order.cancellation_attribution_count");
  });

  it("still reads a coded column as its own code when no map is declared", () => {
    const result = project(
      [["2026-01-01", null, "item_unavailable", 1]],
      declaration({ allowedValues: ["ITEM_UNAVAILABLE"] }, { canonicalField: "reason_code" }),
    );

    expect(result.observations.map((row) => row.dimensions?.cancelled_by)).toEqual([
      "ITEM_UNAVAILABLE",
    ]);
  });
});
