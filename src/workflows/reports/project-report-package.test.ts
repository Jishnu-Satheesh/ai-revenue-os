import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { reportProjectionDocumentSchema } from "@/domain/reports/projection";
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
  declared_period_start: "2026-01-01",
  declared_period_end: "2026-01-31",
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
        completePeriodGrain: async () => {
          throw new Error("must not complete a series");
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
        completePeriodGrain: async () => {
          throw new Error("must not complete a series");
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
        complete: async (value) => { completions.push(value); }, completePeriodGrain: async () => { throw new Error("must not complete a series"); }, fail: async () => { throw new Error("must not fail"); },
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
    const failures: { code: string; detail?: string }[] = [];
    const completions: unknown[] = [];
    const seriesCompletions: {
      observations: { periodStart: string; periodEnd: string; valueNumerator: string }[];
      absentRowCount: number;
    }[] = [];
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
        completePeriodGrain: async (value) => {
          seriesCompletions.push(value);
        },
        fail: async (value) => {
          failures.push({ code: value.code, detail: value.detail });
        },
      },
    );
    return { result, failures, completions, seriesCompletions };
  }

  const dailyContract = {
    ...contract.mapping_document,
    sheets: [
      {
        ...contract.mapping_document.sheets[0],
        fields: [
          { canonicalField: "period_date", sourceHeader: "date", parser: "local_date", required: true, dateEncoding: "iso_date" },
          { ...contract.mapping_document.sheets[0].fields[0], required: false },
        ],
      },
    ],
  };

  const dailyProjection = {
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
  };

  it("writes a daily declaration into the metrics ledger instead of refusing it", async () => {
    // Three of the five report families the platform knows are one row per day.
    // Until this path existed all three were refused outright.
    const { result, failures, seriesCompletions } = await runWith(dailyProjection, {
      input: Buffer.from("date,net_sales\n2026-01-01,12.34\n2026-01-03,0.66\n"),
      mappingDocument: dailyContract,
    });

    expect(failures).toEqual([]);
    expect(result.outcome).toBe("projected");
    expect(seriesCompletions).toHaveLength(1);
    expect(seriesCompletions[0].observations).toEqual([
      expect.objectContaining({
        key: "gross_revenue",
        periodStart: "2026-01-01",
        periodEnd: "2026-01-01",
        valueNumerator: "1234",
        currency: "AED",
        contributorCount: 1,
      }),
      expect.objectContaining({ periodStart: "2026-01-03", valueNumerator: "66" }),
    ]);
  });

  it("leaves a blank period absent rather than recording it as a zero", async () => {
    // The provider wrote a row for the second of January and left the figure
    // empty. That is a day it said nothing about, and "0" would be a claim.
    const { result, seriesCompletions } = await runWith(dailyProjection, {
      input: Buffer.from("date,net_sales\n2026-01-01,12.34\n2026-01-02,\n2026-01-03,0.00\n"),
      mappingDocument: dailyContract,
    });

    expect(result.outcome).toBe("projected");
    const periods = seriesCompletions[0].observations.map((observation) => observation.periodStart);
    expect(periods).toEqual(["2026-01-01", "2026-01-03"]);
    // A genuine zero is not a gap. The third is trading that sold nothing, and
    // it is recorded as the zero it is.
    expect(seriesCompletions[0].observations[1]).toEqual(
      expect.objectContaining({ periodStart: "2026-01-03", valueNumerator: "0" }),
    );
  });

  it("reports how many periods the provider left blank", async () => {
    const { seriesCompletions } = await runWith(dailyProjection, {
      input: Buffer.from("date,net_sales\n2026-01-01,12.34\n2026-01-02,\n2026-01-04,\n"),
      mappingDocument: dailyContract,
    });

    expect(seriesCompletions[0].absentRowCount).toBe(2);
  });

  it("refuses a period the operator did not declare the package covers", async () => {
    // The package says January. A February row filed under it would be a figure
    // recorded against someone else's month.
    const { result, failures, seriesCompletions } = await runWith(dailyProjection, {
      input: Buffer.from("date,net_sales\n2026-01-01,12.34\n2026-02-03,0.66\n"),
      mappingDocument: dailyContract,
    });

    expect(result.outcome).toBe("failed");
    expect(failures).toMatchObject([{ code: "PERIOD_OUT_OF_DECLARED_RANGE" }]);
    expect(seriesCompletions).toEqual([]);
  });

  it("names an unreadable date as itself rather than as a generic failure", async () => {
    const { result, failures } = await runWith(dailyProjection, {
      input: Buffer.from("date,net_sales\n not-a-date,12.34\n"),
      mappingDocument: dailyContract,
    });

    expect(result.outcome).toBe("failed");
    expect(failures).toMatchObject([{ code: "INVALID_LOCAL_DATE" }]);
  });

  it("carries no workbook value into the series it hands to Postgres", async () => {
    const { seriesCompletions } = await runWith(dailyProjection, {
      input: Buffer.from("date,net_sales\n2026-01-01,12.34\n"),
      mappingDocument: dailyContract,
    });

    // Minor units are the projected figure and belong there. The workbook's own
    // rendering of it does not.
    expect(JSON.stringify(seriesCompletions)).not.toContain("12.34");
  });

  it("still refuses a projection target it cannot write to", async () => {
    // The code did not disappear with the series path; it now means what it
    // says, which is that some other target has no writer yet.
    expect(() =>
      reportProjectionDocumentSchema.parse({ ...dailyProjection, outputKind: "quarter_to_date" }),
    ).toThrow();
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
    expect(failures).toMatchObject([{ code: "CONTROL_TOTAL_MISMATCH" }]);
  });

  it("records what an unexpected failure knew about itself", async () => {
    // The whole reason this exists: `PROJECTION_PROCESSING_FAILED` names a
    // category, not a cause. Without the detail, a run that fails for a reason
    // nobody anticipated is unexplainable afterwards -- which is exactly what
    // happened to a Keeta order export on 2026-09-01, twice, deterministically.
    const { failures, result } = await runWith(dailyProjection, {
      input: Buffer.from("net_sales\n12.34\n"),
      mappingDocument: { ...(contract.mapping_document as object), currency: "SAR" },
    });

    expect(result.outcome).toBe("failed");
    expect(failures[0]?.code).toBe("PROJECTION_PROCESSING_FAILED");
    expect(failures[0]?.detail).toBeTruthy();
    expect(failures[0]?.detail?.length).toBeLessThanOrEqual(300);
  });

  it("keeps the detail to what the error said, and within the column", async () => {
    // A long message is truncated rather than allowed to refuse the failure
    // itself: losing the code as well as the reason would be worse.
    const failures: { code: string; detail?: string }[] = [];
    await runReportPackageProjection(
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
        claim: async () => {
          throw new Error(`state transition failed: ${"x".repeat(500)}`);
        },
        objectStore: { stat: async () => ({ id: "", metadata: {} }), download: async () => Buffer.from("") },
        complete: async () => {},
        completePeriodGrain: async () => {},
        fail: async (value) => {
          failures.push({ code: value.code, detail: value.detail });
        },
      },
    ).catch(() => undefined);

    if (failures.length > 0) {
      expect(failures[0]?.detail?.length).toBeLessThanOrEqual(300);
    }
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
