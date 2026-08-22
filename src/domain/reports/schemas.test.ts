import { describe, expect, it } from "vitest";

import {
  decideReportContractSchema,
  proposeReportContractSchema,
  reportFileKindFromFilename,
  reportPackageUploadIntentSchema,
} from "@/domain/reports/schemas";
import { REPORT_PACKAGE_LIMITS, reportPackageStoragePath } from "@/domain/reports/types";

const valid = {
  channelId: "10000000-0000-4000-8000-000000000001",
  branchId: "10000000-0000-4000-8000-000000000002",
  reportType: "Marketplace settlement",
  periodStart: "2026-08-01",
  periodEnd: "2026-08-07",
  currency: "aed",
  originalFilename: "settlement.xlsx",
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  contentLength: REPORT_PACKAGE_LIMITS.maxCompressedBytes,
  idempotencyKey: "report-upload-intent-0001",
};

describe("governed report-package intake schema", () => {
  it("requires explicit declared context and normalizes currency", () => {
    expect(reportPackageUploadIntentSchema.parse(valid).currency).toBe("AED");
  });

  it("rejects a period that runs backwards", () => {
    expect(
      reportPackageUploadIntentSchema.safeParse({ ...valid, periodEnd: "2026-07-31" }).success,
    ).toBe(false);
  });

  it("rejects a file above the exact compressed boundary", () => {
    expect(
      reportPackageUploadIntentSchema.safeParse({
        ...valid,
        contentLength: REPORT_PACKAGE_LIMITS.maxCompressedBytes + 1,
      }).success,
    ).toBe(false);
  });

  it("rejects mismatched extension and MIME type", () => {
    expect(
      reportPackageUploadIntentSchema.safeParse({ ...valid, originalFilename: "settlement.csv" })
        .success,
    ).toBe(false);
  });

  it("uses a generated tenant path and never the supplied filename", () => {
    expect(
      reportPackageStoragePath({
        organizationId: valid.channelId,
        channelId: valid.channelId,
        packageId: valid.branchId,
        fileKind: reportFileKindFromFilename(valid.originalFilename),
      }),
    ).toBe(`${valid.channelId}/${valid.channelId}/${valid.branchId}/1/original/report.xlsx`);
  });
});

describe("governed report contract request schemas", () => {
  const document = {
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
            canonicalField: "net_sales",
            sourceHeader: "net_sales",
            parser: "money",
            required: true,
            financialSign: "positive",
          },
        ],
      },
    ],
    controls: [],
    unmappedFieldDisposition: "reviewed_ignore",
  };

  it("accepts a human proposal only with a bounded mapping document and replay key", () => {
    expect(
      proposeReportContractSchema.parse({
        mappingDocument: document,
        idempotencyKey: "report-contract-proposal-0001",
      }),
    ).toEqual({ mappingDocument: document, idempotencyKey: "report-contract-proposal-0001" });
  });

  it("requires a reason when an owner rejects a proposal", () => {
    expect(
      decideReportContractSchema.safeParse({
        decision: "rejected",
        idempotencyKey: "report-contract-decision-0001",
      }).success,
    ).toBe(false);
  });
});
