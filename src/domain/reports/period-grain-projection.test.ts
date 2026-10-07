import { describe, expect, it } from "vitest";

import type { ReportContractDocument } from "@/domain/reports/contracts";
import {
  projectPeriodGrainMetrics,
  reportProjectionDocumentSchema,
  ReportProjectionError,
  type ReportProjectionDocument,
} from "@/domain/reports/projection";

/**
 * Shaped after the pilot client's Talabat performance export: one row per day,
 * an ISO date in the first column, and a mix of days that traded, days that
 * genuinely sold nothing, and days the provider said nothing about.
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

function declaration(overrides: Record<string, unknown> = {}): ReportProjectionDocument {
  return reportProjectionDocumentSchema.parse({
    schemaVersion: 1,
    outputKind: "period_grain",
    grain: "day",
    periodKey: {
      normalizedSheetName: "sheet1",
      canonicalField: "period_date",
    },
    outputs: [
      {
        key: "gross_revenue",
        normalizedSheetName: "sheet1",
        canonicalField: "gross_sales",
        metricKey: "revenue.gross",
        valueKind: "money",
        aggregation: "sum",
      },
      {
        key: "orders",
        normalizedSheetName: "sheet1",
        canonicalField: "successful_orders",
        metricKey: "transactions.count",
        valueKind: "count",
        aggregation: "sum",
      },
    ],
    ...overrides,
  });
}

const HEADER = ["Date", "Gross Sales", "Successful Orders"];

function project(rows: unknown[][], document = declaration()) {
  return projectPeriodGrainMetrics({
    contract,
    document: document as Extract<ReportProjectionDocument, { outputKind: "period_grain" }>,
    declaredCurrency: "AED",
    sheets: [{ normalizedSheetName: "sheet1", rows: [HEADER, ...rows] }],
  });
}

describe("projecting a file that carries one row per day", () => {
  it("emits one observation per metric per day", () => {
    const result = project([
      ["2026-01-01", 70, 2],
      ["2026-01-02", 19, 1],
    ]);

    expect(result.observations).toHaveLength(4);
    expect(result.observations[0]).toMatchObject({
      key: "gross_revenue",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-01",
      valueNumerator: "7000",
      currency: "AED",
    });
  });

  it("keeps a genuine zero day as a zero", () => {
    // The client's own file records 2026-01-11 as no successful orders with
    // zero sales, against one cancelled order. That is a fact about the day.
    const result = project([["2026-01-11", 0, 0]]);

    expect(result.observations.map((row) => row.valueNumerator)).toEqual(["0", "0"]);
  });

  it("leaves a blank day absent rather than calling it zero", () => {
    // 2026-01-03 in the real export: the provider said nothing. Recording a
    // zero would invent a day of no trading that nobody reported.
    const result = project([
      ["2026-01-02", 19, 1],
      ["2026-01-03", null, null],
    ]);

    expect(result.observations.map((row) => row.periodStart)).toEqual(["2026-01-02", "2026-01-02"]);
    expect(result.absentRowCount).toBe(2);
  });

  it("reports one metric and omits another when only one is blank", () => {
    const result = project([["2026-01-03", null, 4]]);

    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({ key: "orders", valueNumerator: "4" });
  });

  it("ignores a wholly empty trailing row", () => {
    const result = project([
      ["2026-01-01", 70, 2],
      [null, null, null],
    ]);

    expect(result.observations).toHaveLength(2);
    expect(result.absentRowCount).toBe(0);
  });

  it("carries no currency on a count", () => {
    const orders = project([["2026-01-01", 70, 2]]).observations.find(
      (row) => row.key === "orders",
    );

    expect(orders?.currency).toBeNull();
  });
});

describe("rolling days up to a coarser grain", () => {
  it("sums a week and dates it from its Monday", () => {
    const result = project(
      [
        ["2026-01-26", 10, 1],
        ["2026-01-27", 20, 2],
        ["2026-02-01", 30, 3],
      ],
      declaration({ grain: "week" }),
    );
    const revenue = result.observations.filter((row) => row.key === "gross_revenue");

    expect(revenue).toHaveLength(1);
    expect(revenue[0]).toMatchObject({
      periodStart: "2026-01-26",
      periodEnd: "2026-02-01",
      valueNumerator: "6000",
      contributorCount: 3,
    });
  });

  it("sums a month and ends it on its real last day", () => {
    const result = project(
      [
        ["2026-02-01", 10, 1],
        ["2026-02-28", 20, 2],
      ],
      declaration({ grain: "month" }),
    );
    const revenue = result.observations.find((row) => row.key === "gross_revenue");

    expect(revenue).toMatchObject({
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
      valueNumerator: "3000",
    });
  });

  it("sums two rows that fall on the same day rather than emitting both", () => {
    const result = project([
      ["2026-01-01", 70, 2],
      ["2026-01-01", 30, 1],
    ]);
    const revenue = result.observations.filter((row) => row.key === "gross_revenue");

    expect(revenue).toHaveLength(1);
    expect(revenue[0]?.valueNumerator).toBe("10000");
    expect(revenue[0]?.contributorCount).toBe(2);
  });
});

describe("a provider that leaves days blank", () => {
  it("projects a field the contract does not require on every row", () => {
    // Talabat's export carries a row for all fifty-nine days and leaves the
    // figures blank on the days it has nothing to say about. Demanding a
    // required field here would make the provider's own normal export
    // unmappable, which is the opposite of what "required" is protecting.
    const optional = {
      ...contract,
      sheets: [
        {
          ...contract.sheets[0],
          fields: contract.sheets[0].fields.map((field) =>
            field.canonicalField === "gross_sales" ? { ...field, required: false } : field,
          ),
        },
      ],
    } as unknown as ReportContractDocument;

    const result = projectPeriodGrainMetrics({
      contract: optional,
      document: declaration() as Extract<ReportProjectionDocument, { outputKind: "period_grain" }>,
      declaredCurrency: "AED",
      sheets: [
        {
          normalizedSheetName: "sheet1",
          rows: [HEADER, ["2026-01-01", 70, 2], ["2026-01-02", null, 1]],
        },
      ],
    });

    expect(result.observations.filter((row) => row.key === "gross_revenue")).toHaveLength(1);
    expect(result.absentRowCount).toBe(1);
  });

  it("reads the date the way the contract says this provider writes it", () => {
    // Keeta's billing report writes `1 Jan 2026`, and the encoding lives on the
    // contract field so validation and projection cannot disagree about it.
    const keeta = {
      ...contract,
      sheets: [
        {
          ...contract.sheets[0],
          fields: contract.sheets[0].fields.map((field) =>
            field.canonicalField === "period_date"
              ? { ...field, dateEncoding: "text_date" }
              : field,
          ),
        },
      ],
    } as unknown as ReportContractDocument;

    const result = projectPeriodGrainMetrics({
      contract: keeta,
      document: declaration() as Extract<ReportProjectionDocument, { outputKind: "period_grain" }>,
      declaredCurrency: "AED",
      sheets: [{ normalizedSheetName: "sheet1", rows: [HEADER, ["1 Jan 2026", 70, 2]] }],
    });

    expect(result.observations[0]?.periodStart).toBe("2026-01-01");
  });
});

describe("what the declaration refuses to express", () => {
  it("will not take the date from a different sheet than the values", () => {
    expect(() =>
      declaration({
        periodKey: {
          normalizedSheetName: "other",
          canonicalField: "period_date",
        },
      }),
    ).toThrow();
  });

  it("will not project the date column as a value as well", () => {
    expect(() =>
      declaration({
        outputs: [
          {
            key: "gross_revenue",
            normalizedSheetName: "sheet1",
            canonicalField: "period_date",
            metricKey: "revenue.gross",
            valueKind: "money",
            aggregation: "sum",
          },
        ],
      }),
    ).toThrow();
  });

  it("still refuses anything that is not a sum", () => {
    expect(() =>
      declaration({
        outputs: [
          {
            key: "aov",
            normalizedSheetName: "sheet1",
            canonicalField: "gross_sales",
            metricKey: "revenue.gross",
            valueKind: "money",
            aggregation: "mean",
          },
        ],
      }),
    ).toThrow();
  });

  it("fails on a row whose date cannot be read, rather than dropping it", () => {
    // A row silently discarded is a figure quietly missing from a total.
    expect(() => project([["not a date", 70, 2]])).toThrow(ReportProjectionError);
  });
});

describe("a provider that measures minutes in fractions", () => {
  // Talabat's September export writes scheduled time as `1139.9833333333333`
  // minutes and closed time with the same fractional precision. Counts are
  // recorded as whole units, so each emitted figure rounds to the nearest
  // minute rather than refusing the import. See ADR 0078.
  const minutesContract = {
    ...contract,
    sheets: [
      {
        ...contract.sheets[0],
        fields: [
          ...contract.sheets[0].fields,
          {
            canonicalField: "unavailable_minutes",
            sourceHeader: "unavailable_minutes",
            parser: "decimal",
            required: false,
          },
        ],
      },
    ],
  } as unknown as ReportContractDocument;
  const minutesHeader = ["Date", "Gross Sales", "Successful Orders", "Unavailable Minutes"];
  function projectMinutes(rows: unknown[][], grain = "day") {
    return projectPeriodGrainMetrics({
      contract: minutesContract,
      document: declaration({
        grain,
        outputs: [
          {
            key: "closed_minutes",
            normalizedSheetName: "sheet1",
            canonicalField: "unavailable_minutes",
            metricKey: "operations.closed_minutes",
            valueKind: "count",
            aggregation: "sum",
          },
        ],
      }) as Extract<ReportProjectionDocument, { outputKind: "period_grain" }>,
      declaredCurrency: "AED",
      sheets: [{ normalizedSheetName: "sheet1", rows: [minutesHeader, ...rows] }],
    });
  }

  it("rounds fractional minutes to the nearest whole minute", () => {
    const result = projectMinutes([
      ["2026-09-06", 68, 2, 6.4],
      ["2026-09-11", 0, 0, 279.71666666666664],
      ["2026-09-28", 0, 0, 1139.9833333333333],
    ]);
    const minutes = result.observations.filter((row) => row.key === "closed_minutes");

    expect(minutes.map((row) => `${row.periodStart}:${row.valueNumerator}`)).toEqual([
      "2026-09-06:6",
      "2026-09-11:280",
      "2026-09-28:1140",
    ]);
  });

  it("rounds halves up", () => {
    const result = projectMinutes([["2026-09-01", 50, 3, 2.5]]);
    const minutes = result.observations.find((row) => row.key === "closed_minutes");

    expect(minutes?.valueNumerator).toBe("3");
  });

  it("sums the day first and rounds the total, not the parts", () => {
    // Two rows on one day of 0.4 each are 0.8 of a minute together: rounding
    // the parts would record nothing while the day carries almost a minute.
    const result = projectMinutes(
      [
        ["2026-09-01", 50, 3, 0.4],
        ["2026-09-01", 40, 1, 0.4],
      ],
      "month",
    );
    const minutes = result.observations.find((row) => row.key === "closed_minutes");

    expect(minutes?.valueNumerator).toBe("1");
    expect(minutes?.contributorCount).toBe(2);
  });

  it("leaves whole-minute days exactly as reported", () => {
    const result = projectMinutes([["2026-09-22", 126, 6, 0]]);
    const minutes = result.observations.find((row) => row.key === "closed_minutes");

    expect(minutes?.valueNumerator).toBe("0");
  });
});

describe("determinism", () => {
  it("orders observations by period then key, whatever order the rows arrive in", () => {
    const rows = [
      ["2026-01-03", 30, 3],
      ["2026-01-01", 10, 1],
      ["2026-01-02", 20, 2],
    ];
    const forwards = project(rows);
    const backwards = project([...rows].reverse());

    expect(backwards.observations).toEqual(forwards.observations);
    expect(forwards.observations.map((row) => `${row.periodStart}:${row.key}`)).toEqual([
      "2026-01-01:gross_revenue",
      "2026-01-01:orders",
      "2026-01-02:gross_revenue",
      "2026-01-02:orders",
      "2026-01-03:gross_revenue",
      "2026-01-03:orders",
    ]);
  });
});
