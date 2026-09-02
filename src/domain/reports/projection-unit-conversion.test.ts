import { describe, expect, it } from "vitest";

import type { ReportContractDocument } from "@/domain/reports/contracts";
import {
  projectPeriodGrainMetrics,
  reportProjectionDocumentSchema,
  type ReportProjectionDocument,
} from "@/domain/reports/projection";

/**
 * A provider measuring in one unit and the registry recording in another.
 *
 * Keeta reports open and closed time in hours; `operations.closed_minutes` and
 * `operations.scheduled_minutes` are what the availability detector reads, and
 * storing hours under a key that says minutes would be a lie with a units
 * label on it. So the declaration names the conversion.
 *
 * It is a named conversion and not a multiplier on purpose. A free `scale: 60`
 * says nothing about why, cannot be checked, and is one typo away from being an
 * arbitrary expression -- which this declaration language deliberately does not
 * have. An operator approving `hours to minutes` is approving something they
 * can read.
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
          canonicalField: "open_hours",
          sourceHeader: "open_hours",
          parser: "decimal",
          absentMarkers: ["-"],
          required: false,
        },
        {
          canonicalField: "platform_closed_hours",
          sourceHeader: "platform_closed_hours",
          parser: "decimal",
          absentMarkers: ["-"],
          required: false,
        },
        {
          canonicalField: "manual_closed_hours",
          sourceHeader: "manual_closed_hours",
          parser: "decimal",
          absentMarkers: ["-"],
          required: false,
        },
        {
          canonicalField: "gross_sales",
          sourceHeader: "gross_sales",
          parser: "money",
          financialSign: "positive",
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
        key: "scheduled",
        normalizedSheetName: "sheet1",
        canonicalField: "open_hours",
        metricKey: "operations.scheduled_minutes",
        valueKind: "count",
        aggregation: "sum",
        ...output,
      },
    ],
    controlTotals: [],
  });
}

const HEADER = [
  "Date",
  "Open Hours",
  "Platform Closed Hours",
  "Manual Closed Hours",
  "Gross Sales",
];

function project(rows: unknown[][], document: ReportProjectionDocument) {
  return projectPeriodGrainMetrics({
    contract,
    document: document as Extract<ReportProjectionDocument, { outputKind: "period_grain" }>,
    declaredCurrency: "AED",
    sheets: [{ normalizedSheetName: "sheet1", rows: [HEADER, ...rows] }],
  });
}

describe("declaring a unit the registry does not record in", () => {
  it("accepts the conversions the registry actually needs", () => {
    expect(() => declaration({ convert: "hours_to_minutes" })).not.toThrow();
  });

  it("refuses a conversion nobody defined", () => {
    // The point of naming conversions is that the list is closed. An unknown
    // one is a refusal, never a passthrough.
    expect(() => declaration({ convert: "hours_to_furlongs" })).toThrow();
  });

  it("refuses to convert money", () => {
    // Hours into minutes is a duration idea. A currency has no business here,
    // and multiplying money by sixty is never what anyone meant.
    expect(() =>
      declaration({
        canonicalField: "gross_sales",
        metricKey: "revenue.gross",
        valueKind: "money",
        convert: "hours_to_minutes",
      }),
    ).toThrow();
  });
});

describe("projecting a figure the provider measured in another unit", () => {
  it("records minutes when the provider wrote hours", () => {
    const result = project([["2026-01-01", 24]], declaration({ convert: "hours_to_minutes" }));

    expect(result.observations.map((row) => row.valueNumerator)).toEqual(["1440"]);
  });

  it("converts a fractional hour exactly, with no rounding", () => {
    // Keeta writes durations to one decimal place. A tenth of an hour is six
    // whole minutes, and the arithmetic has to land there rather than near it.
    const result = project([["2026-01-01", 23.5]], declaration({ convert: "hours_to_minutes" }));

    expect(result.observations.map((row) => row.valueNumerator)).toEqual(["1410"]);
  });

  it("adds the columns first and converts the total once", () => {
    // Closed time is the platform's own closures plus the ones the store made.
    // Converting each part and adding, or adding and converting, must agree --
    // and the order matters the moment a part is fractional.
    const result = project(
      [["2026-01-01", 0, 1.5, 2]],
      declaration({
        canonicalField: "platform_closed_hours",
        metricKey: "operations.closed_minutes",
        sumWith: ["manual_closed_hours"],
        convert: "hours_to_minutes",
      }),
    );

    expect(result.observations.map((row) => row.valueNumerator)).toEqual(["210"]);
  });

  it("keeps a day absent when a contributing column says nothing", () => {
    const result = project(
      [
        ["2026-01-01", 0, "-", 2],
        ["2026-01-02", 0, 1, 1],
      ],
      declaration({
        canonicalField: "platform_closed_hours",
        metricKey: "operations.closed_minutes",
        sumWith: ["manual_closed_hours"],
        convert: "hours_to_minutes",
      }),
    );

    expect(result.observations.map((row) => row.periodStart)).toEqual(["2026-01-02"]);
    expect(result.observations.map((row) => row.valueNumerator)).toEqual(["120"]);
  });

  it("leaves an unconverted output exactly as it was", () => {
    const result = project([["2026-01-01", 24]], declaration({}));

    expect(result.observations.map((row) => row.valueNumerator)).toEqual(["24"]);
  });
});
