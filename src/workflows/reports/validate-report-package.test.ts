import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import type { ReportContractDocument } from "@/domain/reports/contracts";
import {
  createValidationResultDigest,
  runReportPackageValidation,
  validateCsvBuffer,
  validateXlsxBuffer,
} from "@/workflows/reports/validate-report-package";

const contract: ReportContractDocument = {
  schemaVersion: 1,
  currency: "AED",
  outletGrain: "branch",
  sheets: [
    {
      normalizedSheetName: "csv",
      headerRow: 1,
      dataStartRow: 2,
      allowFormula: false,
      allowMergedCells: false,
      fields: [
        {
          canonicalField: "order_id",
          sourceHeader: "order_id",
          parser: "integer",
          required: true,
        },
        {
          canonicalField: "order_date",
          sourceHeader: "order_date",
          parser: "local_date",
          required: true,
        },
        {
          canonicalField: "net_sales",
          sourceHeader: "net_sales",
          parser: "money",
          required: true,
          financialSign: "positive",
        },
        {
          canonicalField: "commission_rate",
          sourceHeader: "commission_rate",
          parser: "percentage",
          required: false,
        },
      ],
    },
  ],
  controls: [
    { key: "row_count", kind: "row_count", normalizedSheetName: "csv", tolerance: 0 },
    {
      key: "cell_count",
      kind: "populated_cell_count",
      normalizedSheetName: "csv",
      tolerance: 0,
    },
  ],
  unmappedFieldDisposition: "reviewed_ignore",
};

const profile = [
  {
    normalizedSheetName: "csv",
    rowCount: 3,
    populatedCellCount: 11,
    hasFormula: false,
    hasMergedCells: false,
  },
];

describe("deterministic report validation", () => {
  it("validates a declared CSV contract without retaining values", async () => {
    const result = await validateCsvBuffer(
      Buffer.from(
        "order_id,order_date,net_sales,commission_rate\n1001,2026-08-01,125.50,12.5%\n1002,2026-08-02,90.00,\n",
      ),
      contract,
      profile,
    );

    expect(result.status).toBe("validated");
    expect(result.sheetResults).toEqual([
      expect.objectContaining({
        normalizedSheetName: "csv",
        parsedFieldSuccessCount: 7,
        parsedFieldFailureCount: 0,
        errorCodes: [],
        warningCodes: ["OPTIONAL_FIELD_MISSING"],
      }),
    ]);
    expect(result.controlResults).toEqual([
      expect.objectContaining({ key: "row_count", passed: true, expectedCount: 3, actualCount: 3 }),
      expect.objectContaining({
        key: "cell_count",
        passed: true,
        expectedCount: 11,
        actualCount: 11,
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("125.50");
    expect(JSON.stringify(result)).not.toContain("1001");
  });

  it("fails required headers and values with typed parser codes", async () => {
    const missingHeader = await validateCsvBuffer(
      Buffer.from("order_id,order_date,commission_rate\n1,2026-08-01,15%\n"),
      contract,
      [{ ...profile[0], rowCount: 2, populatedCellCount: 6 }],
    );
    expect(missingHeader.status).toBe("failed");
    expect(missingHeader.errorCodes).toContain("REQUIRED_SOURCE_HEADER_MISSING");

    const invalidValues = await validateCsvBuffer(
      Buffer.from("order_id,order_date,net_sales,commission_rate\n1.5,not-a-date,bad,wat\n"),
      contract,
      [{ ...profile[0], rowCount: 2, populatedCellCount: 8 }],
    );
    expect(invalidValues.errorCodes).toEqual(
      expect.arrayContaining([
        "INVALID_INTEGER",
        "INVALID_LOCAL_DATE",
        "INVALID_MONEY",
        "INVALID_PERCENTAGE",
      ]),
    );

    const invalidDecimal = await validateCsvBuffer(
      Buffer.from(
        "order_id,order_date,net_sales,commission_rate,subtotal\n1,2026-08-01,1,10%,not-a-number\n",
      ),
      {
        ...contract,
        sheets: [
          {
            ...contract.sheets[0],
            fields: [
              ...contract.sheets[0].fields,
              {
                canonicalField: "subtotal",
                sourceHeader: "subtotal",
                parser: "decimal",
                required: true,
              },
            ],
          },
        ],
      },
      [{ ...profile[0], rowCount: 2, populatedCellCount: 10 }],
    );
    expect(invalidDecimal.errorCodes).toContain("INVALID_DECIMAL");
  });

  it("distinguishes an optional sheet warning from a required sheet failure", async () => {
    const optionalSheet = await validateCsvBuffer(
      Buffer.from("order_id,order_date,net_sales,commission_rate\n1,2026-08-01,1,10%\n"),
      {
        ...contract,
        sheets: [
          ...contract.sheets,
          {
            ...contract.sheets[0],
            normalizedSheetName: "optional_notes",
            fields: [
              { canonicalField: "note", sourceHeader: "note", parser: "text", required: false },
            ],
          },
        ],
      },
      [{ ...profile[0], rowCount: 2, populatedCellCount: 8 }],
    );
    expect(optionalSheet.status).toBe("partially_validated");
    expect(optionalSheet.warningCodes).toContain("OPTIONAL_SHEET_MISSING");

    const requiredSheet = await validateCsvBuffer(
      Buffer.from("order_id,order_date,net_sales,commission_rate\n1,2026-08-01,1,10%\n"),
      {
        ...contract,
        sheets: [
          ...contract.sheets,
          {
            ...contract.sheets[0],
            normalizedSheetName: "required_notes",
            fields: [
              { canonicalField: "note", sourceHeader: "note", parser: "text", required: true },
            ],
          },
        ],
      },
      [{ ...profile[0], rowCount: 2, populatedCellCount: 8 }],
    );
    expect(requiredSheet.status).toBe("failed");
    expect(requiredSheet.errorCodes).toContain("REQUIRED_SHEET_MISSING");
  });

  it("fails count controls and makes the result digest stable", async () => {
    const result = await validateCsvBuffer(
      Buffer.from("order_id,order_date,net_sales,commission_rate\n1,2026-08-01,10,10%\n"),
      contract,
      profile,
    );

    expect(result.status).toBe("failed");
    expect(result.errorCodes).toContain("CONTROL_MISMATCH");
    expect(createValidationResultDigest(result)).toBe(createValidationResultDigest({ ...result }));
    expect(createValidationResultDigest(result)).not.toBe(
      createValidationResultDigest({ ...result, errorCodes: ["INVALID_MONEY"] }),
    );
  });

  it("enforces the approved financial sign for money fields", async () => {
    const result = await validateCsvBuffer(
      Buffer.from("order_id,order_date,net_sales,commission_rate\n1,2026-08-01,-10,10%\n"),
      contract,
      [{ ...profile[0], rowCount: 2, populatedCellCount: 8 }],
    );
    expect(result.status).toBe("failed");
    expect(result.errorCodes).toContain("INVALID_MONEY");
  });

  it("rejects formula and merged-cell policy without storing formula text", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Summary");
    sheet.addRow(["order_id", "order_date", "net_sales", "commission_rate"]);
    sheet.addRow([1, "2026-08-01", { formula: "1+2", result: 3 }, "10%"]);
    sheet.mergeCells("A1:A2");
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const xlsxContract: ReportContractDocument = {
      ...contract,
      sheets: [{ ...contract.sheets[0], normalizedSheetName: "summary" }],
      controls: [],
    };
    const result = await validateXlsxBuffer(buffer, xlsxContract, [
      {
        normalizedSheetName: "summary",
        rowCount: 2,
        populatedCellCount: 7,
        hasFormula: true,
        hasMergedCells: true,
      },
    ]);

    expect(result.status).toBe("failed");
    expect(result.errorCodes).toEqual(
      expect.arrayContaining(["FORMULA_REJECTED", "MERGED_CELLS_REJECTED"]),
    );
    expect(JSON.stringify(result)).not.toContain("1+2");
  });

  it("does not download a completed replay", async () => {
    const result = await runReportPackageValidation(
      {
        organizationId: "11111111-1111-4111-8111-111111111111",
        packageId: "22222222-2222-4222-8222-222222222222",
        contractVersionId: "33333333-3333-4333-8333-333333333333",
        validationRunId: "44444444-4444-4444-8444-444444444444",
        correlationId: "55555555-5555-4555-8555-555555555555",
        idempotencyKey: "report-validation-test-replay",
      },
      {
        claim: async () => ({ outcome: "completed" }),
        objectStore: {
          stat: async () => {
            throw new Error("must not stat replay");
          },
          download: async () => {
            throw new Error("must not download replay");
          },
        },
        complete: async () => {
          throw new Error("must not complete replay");
        },
        fail: async () => {
          throw new Error("must not fail replay");
        },
      },
    );
    expect(result).toEqual({ outcome: "completed" });
  });
});
