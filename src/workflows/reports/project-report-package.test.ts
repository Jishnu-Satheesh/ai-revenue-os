import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { runReportPackageProjection } from "@/workflows/reports/project-report-package";

const packageRow = {
  id: "22222222-2222-4222-8222-222222222222",
  organization_id: "11111111-1111-4111-8111-111111111111",
  storage_path: "org/channel/package/1/original/report.csv",
  storage_object_id: "storage-object",
  storage_object_version: "v1",
  declared_content_length: 21,
  declared_content_type: "text/csv",
  content_sha256: "608909f266aa59897b287917f028f64094301b770beb3f71a67751e273fdf1f2",
  declared_currency: "AED",
  file_kind: "csv",
} as const;

const contract = {
  mapping_document: {
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
  },
};

const projection = {
  projection_document: {
    schemaVersion: 1,
    outputKind: "exact_range",
    outputs: [
      {
        key: "gross_revenue",
        normalizedSheetName: "csv",
        canonicalField: "net_sales",
        metricKey: "revenue.gross",
        valueKind: "money",
        aggregation: "sum",
      },
    ],
  },
};

describe("governed report package projection", () => {
  it("projects a private CSV into safe aggregate evidence", async () => {
    const completed: unknown[] = [];
    const input = Buffer.from("net_sales\n12.34\n0.66\n");
    const result = await runReportPackageProjection(
      {
        organizationId: packageRow.organization_id,
        packageId: packageRow.id,
        contractVersionId: "33333333-3333-4333-8333-333333333333",
        projectionVersionId: "44444444-4444-4444-8444-444444444444",
        projectionRunId: "55555555-5555-4555-8555-555555555555",
        correlationId: "66666666-6666-4666-8666-666666666666",
        idempotencyKey: "report-projection-private-csv-test",
      },
      {
        claim: async () => ({
          outcome: "acquired",
          reportPackage: packageRow,
          contractVersion: contract,
          projectionVersion: projection,
          metricDefinitions: [{ id: "77777777-7777-4777-8777-777777777777", key: "revenue.gross", value_kind: "money" }],
        }),
        objectStore: {
          stat: async () => ({ id: "storage-object", metadata: { size: 21, mimetype: "text/csv" } }),
          download: async () => input,
        },
        complete: async (value) => {
          completed.push(value);
        },
        fail: async () => {
          throw new Error("must not fail");
        },
      },
    );

    expect(result.outcome).toBe("projected");
    expect(completed).toEqual([
      expect.objectContaining({
        result: expect.objectContaining({ status: "projected" }),
        outputs: [
          expect.objectContaining({
            key: "gross_revenue",
            valueNumerator: "1300",
            currency: "AED",
            sourceColumnOrdinal: 1,
          }),
        ],
      }),
    ]);
    expect(JSON.stringify(completed)).not.toContain("12.34");
  });

  it("does not download an idempotent completed replay", async () => {
    const result = await runReportPackageProjection(
      {
        organizationId: packageRow.organization_id,
        packageId: packageRow.id,
        contractVersionId: "33333333-3333-4333-8333-333333333333",
        projectionVersionId: "44444444-4444-4444-8444-444444444444",
        projectionRunId: "55555555-5555-4555-8555-555555555555",
        correlationId: "66666666-6666-4666-8666-666666666666",
        idempotencyKey: "report-projection-replay-safe-test",
      },
      {
        claim: async () => ({ outcome: "completed" }),
        objectStore: {
          stat: async () => {
            throw new Error("must not stat");
          },
          download: async () => {
            throw new Error("must not download");
          },
        },
        complete: async () => {
          throw new Error("must not complete");
        },
        fail: async () => {
          throw new Error("must not fail");
        },
      },
    );
    expect(result.outcome).toBe("completed");
  });

  it("projects an approved XLSX field without returning worksheet values", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Settlement");
    worksheet.addRow(["net_sales", "private_customer"]);
    worksheet.addRow([12.34, "customer-42"]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const completions: unknown[] = [];
    const result = await runReportPackageProjection(
      {
        organizationId: packageRow.organization_id, packageId: packageRow.id,
        contractVersionId: "33333333-3333-4333-8333-333333333333", projectionVersionId: "44444444-4444-4444-8444-444444444444",
        projectionRunId: "55555555-5555-4555-8555-555555555555", correlationId: "66666666-6666-4666-8666-666666666666", idempotencyKey: "report-projection-private-xlsx-test",
      },
      {
        claim: async () => ({ outcome: "acquired", reportPackage: { ...packageRow, file_kind: "xlsx" as const, declared_content_length: buffer.byteLength, content_sha256: (await import("node:crypto")).createHash("sha256").update(buffer).digest("hex"), declared_content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, contractVersion: { mapping_document: { ...contract.mapping_document, sheets: [{ ...contract.mapping_document.sheets[0], normalizedSheetName: "settlement" }] } }, projectionVersion: { projection_document: { ...projection.projection_document, outputs: [{ ...projection.projection_document.outputs[0], normalizedSheetName: "settlement" }] } }, metricDefinitions: [{ id: "77777777-7777-4777-8777-777777777777", key: "revenue.gross", value_kind: "money" }] }),
        objectStore: { stat: async () => ({ id: "storage-object", metadata: { size: buffer.byteLength, mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } }), download: async () => buffer },
        complete: async (value) => { completions.push(value); }, fail: async () => { throw new Error("must not fail"); },
      },
    );
    expect(result.outcome).toBe("projected");
    expect(JSON.stringify(completions)).not.toContain("customer-42");
  });

  async function runWith(
    projectionDocument: unknown,
    options: { input?: Buffer; mappingDocument?: unknown } = {},
  ) {
    const input = options.input ?? Buffer.from("net_sales\n12.34\n0.66\n");
    const failures: { code: string }[] = [];
    const completions: unknown[] = [];
    const result = await runReportPackageProjection(
      {
        organizationId: packageRow.organization_id,
        packageId: packageRow.id,
        contractVersionId: "33333333-3333-4333-8333-333333333333",
        projectionVersionId: "44444444-4444-4444-8444-444444444444",
        projectionRunId: "55555555-5555-4555-8555-555555555555",
        correlationId: "66666666-6666-4666-8666-666666666666",
        idempotencyKey: "report-projection-guard-test",
      },
      {
        claim: async () => ({
          outcome: "acquired",
          reportPackage: {
            ...packageRow,
            declared_content_length: input.byteLength,
            content_sha256: (await import("node:crypto")).createHash("sha256").update(input).digest("hex"),
          },
          contractVersion: { mapping_document: options.mappingDocument ?? contract.mapping_document },
          projectionVersion: { projection_document: projectionDocument },
          metricDefinitions: [
            { id: "77777777-7777-4777-8777-777777777777", key: "revenue.gross", value_kind: "money" },
          ],
        }),
        objectStore: {
          stat: async () => ({ id: "storage-object", metadata: { size: input.byteLength, mimetype: "text/csv" } }),
          download: async () => input,
        },
        complete: async (value) => {
          completions.push(value);
        },
        fail: async (value) => {
          failures.push({ code: value.code });
        },
      },
    );
    return { result, failures, completions };
  }

  it("refuses a period-grain declaration rather than summing it as one total", async () => {
    // The daily write path does not exist yet. Projecting a month of rows into
    // a single exact-range figure would look like a successful import and be
    // wrong about the shape of every number in it.
    const { result, failures } = await runWith(
      {
        schemaVersion: 1,
        outputKind: "period_grain",
        grain: "day",
        periodKey: { normalizedSheetName: "csv", canonicalField: "period_date" },
        outputs: [
          {
            key: "gross_revenue",
            normalizedSheetName: "csv",
            canonicalField: "net_sales",
            metricKey: "revenue.gross",
            valueKind: "money",
            aggregation: "sum",
          },
        ],
      },
      {
        input: Buffer.from("date,net_sales\n2026-01-01,12.34\n2026-01-02,0.66\n"),
        mappingDocument: {
          ...contract.mapping_document,
          sheets: [
            {
              ...contract.mapping_document.sheets[0],
              fields: [
                { canonicalField: "period_date", sourceHeader: "date", parser: "local_date", required: true },
                ...contract.mapping_document.sheets[0].fields,
              ],
            },
          ],
        },
      },
    );

    expect(result.outcome).toBe("failed");
    expect(failures).toEqual([{ code: "PROJECTION_OUTPUT_KIND_UNSUPPORTED" }]);
  });

  it("reports a control total mismatch as itself, not as a generic failure", async () => {
    const { result, failures } = await runWith({
      ...projection.projection_document,
      controlTotals: [
        {
          outputKey: "gross_revenue",
          statedTotalMinorUnits: "9999",
          toleranceMinorUnits: 0,
          statedSource: "provider settlement statement",
        },
      ],
    });

    expect(result.outcome).toBe("failed");
    expect(failures).toEqual([{ code: "CONTROL_TOTAL_MISMATCH" }]);
  });

  it("projects normally when the rows do reach the stated total", async () => {
    const { result, failures } = await runWith({
      ...projection.projection_document,
      controlTotals: [
        {
          outputKey: "gross_revenue",
          statedTotalMinorUnits: "1300",
          toleranceMinorUnits: 0,
          statedSource: "provider settlement statement",
        },
      ],
    });

    expect(failures).toEqual([]);
    expect(result.outcome).toBe("projected");
  });
});
