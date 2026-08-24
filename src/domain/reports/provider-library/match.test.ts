import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { eatEasilyBranchSales } from "@/domain/reports/provider-library/eateasily-branch-sales";
import {
  matchProviderDefinition,
  matchProviderDefinitions,
  type ProfiledSheet,
} from "@/domain/reports/provider-library/match";
import { talabatPerformance } from "@/domain/reports/provider-library/talabat-performance";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function sheet(overrides: Partial<ProfiledSheet> = {}): ProfiledSheet {
  return {
    normalizedSheetName: "sales_report",
    sheetPosition: 1,
    hasFormula: false,
    hasMergedCells: false,
    headerCandidateDigests: [
      {
        rowPosition: 1,
        normalizedHeaderDigests: ["pos_id", "total_sales", "total_orders", "total_commission"].map(digest),
      },
    ],
    ...overrides,
  };
}

const definition = eatEasilyBranchSales;

function match(sheets: ProfiledSheet[], declaredCurrency = "AED") {
  return matchProviderDefinition({ definition, declaredCurrency, sheets });
}

describe("recognising a file from its profile", () => {
  it("matches when every column the definition binds was profiled", () => {
    expect(match([sheet()]).outcome).toBe("matched");
  });

  it("says which column was missing rather than only that it failed", () => {
    // An operator told "not recognised" learns nothing. One told the file has
    // no Total Sales column can look at their export and see why.
    const short = sheet({
      headerCandidateDigests: [{ rowPosition: 1, normalizedHeaderDigests: [digest("pos_id")] }],
    });

    expect(match([short])).toMatchObject({
      outcome: "no_match",
      mismatch: { reason: "column_missing", sourceHeader: "total_sales" },
    });
  });

  it("refuses a file whose header sits on a different row", () => {
    const shifted = sheet({
      headerCandidateDigests: [
        { rowPosition: 2, normalizedHeaderDigests: ["pos_id", "total_sales"].map(digest) },
      ],
    });

    expect(match([shifted])).toMatchObject({
      outcome: "no_match",
      mismatch: { reason: "header_row_not_profiled", headerRow: 1 },
    });
  });

  it("refuses a currency the definition was not written for", () => {
    expect(match([sheet()], "SAR")).toMatchObject({
      outcome: "no_match",
      mismatch: { reason: "currency_differs" },
    });
  });

  it("refuses a file carrying formulas the definition does not allow", () => {
    expect(match([sheet({ hasFormula: true })])).toMatchObject({
      outcome: "no_match",
      mismatch: { reason: "formula_not_allowed" },
    });
  });

  it("tolerates extra sheets when the definition says it reviewed and ignored them", () => {
    // Every real workbook has some. EatEasily ships an empty second tab.
    const extra = sheet({ normalizedSheetName: "worksheet", sheetPosition: 2, headerCandidateDigests: [] });

    expect(match([sheet(), extra]).outcome).toBe("matched");
  });

  it("never claims a file with fewer sheets than the definition describes", () => {
    expect(match([])).toMatchObject({
      outcome: "no_match",
      mismatch: { reason: "more_sheets_declared_than_profiled" },
    });
  });
});

describe("a definition that finds its sheet by position", () => {
  const talabatSheet: ProfiledSheet = {
    // Named after a month that is not the one the definition was drafted from.
    normalizedSheetName: "talabat_may_2026_performance_re",
    sheetPosition: 1,
    hasFormula: false,
    hasMergedCells: false,
    headerCandidateDigests: [
      {
        rowPosition: 1,
        normalizedHeaderDigests: [
          ...new Set(
            talabatPerformance.contract.sheets[0].fields.map((field) => field.sourceHeader),
          ),
        ]
          .concat(["successful_orders"])
          .map(digest),
      },
    ],
  };

  it("recognises next month's export, whose sheet has a different name", () => {
    expect(
      matchProviderDefinition({
        definition: talabatPerformance,
        declaredCurrency: "AED",
        sheets: [talabatSheet],
      }).outcome,
    ).toBe("matched");
  });

  it("looks at the declared position and not merely the first sheet it finds", () => {
    expect(
      matchProviderDefinition({
        definition: talabatPerformance,
        declaredCurrency: "AED",
        sheets: [{ ...talabatSheet, sheetPosition: 2 }],
      }),
    ).toMatchObject({ outcome: "no_match", mismatch: { reason: "sheet_missing" } });
  });
});

describe("offering an operator what their file might be", () => {
  it("returns every family that fits, and picks none of them", () => {
    // Several can fit, and choosing on the operator's behalf would sooner or
    // later choose wrong without anyone noticing.
    const matched = matchProviderDefinitions({
      declaredCurrency: "AED",
      sheets: [sheet()],
      definitions: [definition, talabatPerformance],
    });

    expect(matched.map((entry) => entry.key)).toEqual([definition.key]);
  });

  it("returns nothing rather than a guess when nothing fits", () => {
    expect(
      matchProviderDefinitions({
        declaredCurrency: "AED",
        sheets: [sheet({ headerCandidateDigests: [] })],
      }),
    ).toEqual([]);
  });
});
