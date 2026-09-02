import { describe, expect, it } from "vitest";

import { reportContractDocumentSchema } from "@/domain/reports/contracts";
import { createReportSchemaFingerprint } from "@/domain/reports/document-digest";

const contract = {
  schemaVersion: 1,
  currency: "AED",
  outletGrain: "branch",
  sheets: [
    {
      normalizedSheetName: "settlement_summary",
      headerRow: 2,
      dataStartRow: 3,
      allowFormula: false,
      allowMergedCells: false,
      fields: [
        {
          canonicalField: "net_sales",
          sourceHeader: "net_sales",
          parser: "money",
          required: true,
          financialSign: "positive",
        },
      ],
    },
  ],
  controls: [
    {
      key: "row_count",
      kind: "row_count",
      normalizedSheetName: "settlement_summary",
      tolerance: 0,
    },
  ],
  unmappedFieldDisposition: "reviewed_ignore",
};

describe("governed report contract document", () => {
  it("accepts only the bounded declarative mapping language", () => {
    expect(reportContractDocumentSchema.parse(contract)).toEqual(contract);
  });

  it("refuses arbitrary executable or regular-expression fields", () => {
    expect(
      reportContractDocumentSchema.safeParse({
        ...contract,
        sheets: [{ ...contract.sheets[0], script: "return workbook" }],
      }).success,
    ).toBe(false);
    expect(
      reportContractDocumentSchema.safeParse({
        ...contract,
        sheets: [
          {
            ...contract.sheets[0],
            fields: [{ ...contract.sheets[0].fields[0], parser: "text", regex: ".*" }],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires an explicit financial sign for money fields", () => {
    expect(
      reportContractDocumentSchema.safeParse({
        ...contract,
        sheets: [
          {
            ...contract.sheets[0],
            fields: [{ ...contract.sheets[0].fields[0], financialSign: undefined }],
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("report schema fingerprint", () => {
  it("changes with structural evidence but not file values or filenames", () => {
    const base = {
      reportType: "Settlement",
      currency: "AED",
      outletGrain: "branch" as const,
      parserVersion: 1,
      fingerprintVersion: 1,
      sheets: [
        {
          position: 1,
          normalizedSheetName: "settlement_summary",
          headerCandidateDigests: [
            {
              rowPosition: 2,
              fieldCount: 2,
              digest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              normalizedHeaderDigests: [
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
              ],
            },
          ],
          hasFormula: false,
          hasMergedCells: false,
          hasRepeatedHeader: false,
        },
      ],
    };

    expect(createReportSchemaFingerprint(base)).toBe(createReportSchemaFingerprint({ ...base }));
    expect(
      createReportSchemaFingerprint({
        ...base,
        sheets: [{ ...base.sheets[0], hasFormula: true }],
      }),
    ).not.toBe(createReportSchemaFingerprint(base));
  });

  describe("a sheet whose records are its columns", () => {
    function transposed(overrides: Record<string, unknown> = {}) {
      return {
        ...contract,
        controls: [],
        sheets: [
          {
            ...contract.sheets[0],
            recordOrientation: "period_columns",
            periodHeaderRow: 4,
            ...overrides,
          },
        ],
      };
    }

    it("accepts a rotated sheet that says which row names its periods", () => {
      expect(reportContractDocumentSchema.safeParse(transposed()).success).toBe(true);
    });

    it("refuses a rotated sheet that does not", () => {
      // A column heading has no heading of its own. Without this there is
      // nothing to date a figure by.
      const document = transposed();
      const sheet: Record<string, unknown> = { ...document.sheets[0] };
      delete sheet.periodHeaderRow;

      expect(reportContractDocumentSchema.safeParse({ ...document, sheets: [sheet] }).success).toBe(
        false,
      );
    });

    it("refuses a period header row on a sheet that is not rotated", () => {
      expect(
        reportContractDocumentSchema.safeParse(transposed({ recordOrientation: "rows" })).success,
      ).toBe(false);
    });

    it("refuses a totals row or ragged rows on a rotated sheet", () => {
      // Both describe a shape the sheet has before it is rotated, and neither
      // survives the rotation with its meaning intact.
      expect(
        reportContractDocumentSchema.safeParse(
          transposed({ totalsRow: { canonicalField: "net_sales", label: "Total" } }),
        ).success,
      ).toBe(false);
      expect(
        reportContractDocumentSchema.safeParse(
          transposed({ raggedRows: { injectedFromColumnIndex: 2 } }),
        ).success,
      ).toBe(false);
    });

    it("refuses a counting control over a rotated sheet", () => {
      // The profile counted the sheet the way it arrived. Twenty-four accounts
      // over four months profiles as twenty-four rows and validates as four, so
      // the control would fail every time while nothing was wrong.
      const document = transposed();
      expect(
        reportContractDocumentSchema.safeParse({
          ...document,
          controls: [
            {
              key: "row_count",
              kind: "row_count",
              normalizedSheetName: document.sheets[0].normalizedSheetName,
              tolerance: 0,
            },
          ],
        }).success,
      ).toBe(false);
    });
  });

  describe("how a provider writes a number", () => {
    function withField(field: Record<string, unknown>) {
      return {
        ...contract,
        controls: [],
        sheets: [
          { ...contract.sheets[0], fields: [{ ...contract.sheets[0].fields[0], ...field }] },
        ],
      };
    }

    it("accepts a grouped numeric column", () => {
      expect(
        reportContractDocumentSchema.safeParse(withField({ numberFormat: "grouped" })).success,
      ).toBe(true);
    });

    it("refuses a number format on a column that holds no number", () => {
      expect(
        reportContractDocumentSchema.safeParse(
          withField({ parser: "text", financialSign: undefined, numberFormat: "grouped" }),
        ).success,
      ).toBe(false);
    });
  });
});
