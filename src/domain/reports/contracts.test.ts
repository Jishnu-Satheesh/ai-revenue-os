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
});
