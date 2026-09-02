import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

import {
  inspectXlsxArchive,
  profileCsvBuffer,
  profileXlsxBuffer,
  runReportPackageProfiling,
} from "@/workflows/reports/profile-report-package";
import type { ReportProfilingDependencies } from "@/workflows/reports/profile-report-package";
import type { ReportPackageRow } from "@/modules/reports/application/ports";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000002";
const PACKAGE_ID = "10000000-0000-4000-8000-000000000001";

function reportPackage(): ReportPackageRow {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    organization_id: "10000000-0000-4000-8000-000000000002",
    channel_id: "10000000-0000-4000-8000-000000000003",
    branch_id: "10000000-0000-4000-8000-000000000004",
    report_type: "Settlement",
    declared_period_start: "2026-08-01",
    declared_period_end: "2026-08-07",
    declared_currency: "AED",
    period_timezone: "Asia/Dubai",
    file_kind: "csv",
    original_filename: "report.csv",
    declared_content_type: "text/csv",
    declared_content_length: 8,
    storage_bucket_id: "governed-report-packages",
    storage_path:
      "10000000-0000-4000-8000-000000000002/10000000-0000-4000-8000-000000000003/10000000-0000-4000-8000-000000000001/1/original/report.csv",
    storage_object_id: "10000000-0000-4000-8000-000000000005",
    storage_object_version: null,
    content_sha256: null,
    parser_version: 1,
    fingerprint_version: 1,
    schema_fingerprint: null,
    structure_version: 1,
    structure_fingerprint: null,
    status: "uploaded",
    safe_failure_code: null,
    safe_failure_at: null,
    upload_expires_at: "2026-08-20T00:00:00.000Z",
    uploaded_at: "2026-08-20T00:00:00.000Z",
    profiled_at: null,
    retained_until: "2027-09-20T00:00:00.000Z",
    created_by: "10000000-0000-4000-8000-000000000006",
    correlation_id: "10000000-0000-4000-8000-000000000007",
    created_at: "2026-08-20T00:00:00.000Z",
    updated_at: "2026-08-20T00:00:00.000Z",
  };
}

/**
 * A profiling run whose worksheet name is the only thing that varies.
 *
 * The buffer is built inside `claim`, the one call every run makes first, so
 * its byte length is known before `stat` and `download` need to agree with it
 * -- ExcelJS's output size depends on the worksheet name, so it cannot be
 * precomputed outside an async call.
 */
function profilingDependencies(options: {
  sheetName: string;
  completions: Array<{ schemaFingerprint: string; structureFingerprint: string }>;
}): ReportProfilingDependencies {
  const contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  let buffer: Buffer | undefined;
  return {
    async claim() {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(options.sheetName);
      sheet.addRow(["date", "gross_sales", "successful_orders"]);
      sheet.addRow([new Date("2026-01-01T00:00:00.000Z"), 100, 5]);
      sheet.addRow([new Date("2026-01-02T00:00:00.000Z"), 120, 6]);
      buffer = Buffer.from(await workbook.xlsx.writeBuffer());
      return {
        outcome: "acquired",
        reportPackage: {
          ...reportPackage(),
          id: PACKAGE_ID,
          organization_id: ORGANIZATION_ID,
          file_kind: "xlsx",
          declared_content_type: contentType,
          original_filename: "report.xlsx",
          declared_content_length: buffer.byteLength,
        },
      };
    },
    objectStore: {
      async stat() {
        return {
          id: reportPackage().storage_object_id!,
          metadata: { size: buffer!.byteLength, mimetype: contentType },
        };
      },
      async download() {
        return buffer!;
      },
    },
    async complete(input) {
      options.completions.push({
        schemaFingerprint: input.schemaFingerprint,
        structureFingerprint: input.structureFingerprint,
      });
    },
    async fail() {
      throw new Error("profiling was expected to succeed");
    },
  };
}

describe("governed report package profiling", () => {
  it("records a structure fingerprint that ignores the worksheet name", async () => {
    const completions: Array<{ schemaFingerprint: string; structureFingerprint: string }> = [];
    const runFor = async (sheetName: string) => {
      await runReportPackageProfiling(
        { organizationId: ORGANIZATION_ID, packageId: PACKAGE_ID, idempotencyKey: "k".repeat(20) },
        profilingDependencies({ sheetName, completions }),
      );
    };

    await runFor("Talabat-Jan-Feb-2026-Performance-Report");
    await runFor("Mar-2026");

    expect(completions).toHaveLength(2);
    // The schema fingerprint is allowed to differ -- it identifies an exact
    // profiled shape, worksheet name included, and is recorded on rows that
    // outlive this code.
    expect(completions[0].schemaFingerprint).not.toBe(completions[1].schemaFingerprint);
    // A real digest, not an absent field the two runs happen to agree on --
    // `toBe` alone would still pass if `complete` were never given the field
    // at all, since `undefined === undefined`.
    expect(completions[0].structureFingerprint).toMatch(/^[a-f0-9]{64}$/);
    // The structure fingerprint is what reuse is keyed on, and these are the
    // same report.
    expect(completions[0].structureFingerprint).toBe(completions[1].structureFingerprint);
  });

  it("counts CSV rows and populated cells without retaining rows", async () => {
    await expect(profileCsvBuffer(Buffer.from("\ufeffa,b\n1,\n,2\n", "utf8"))).resolves.toEqual([
      expect.objectContaining({
        sheetName: "CSV",
        normalizedSheetName: "csv",
        rowCount: 3,
        populatedCellCount: 4,
        headerCandidateDigests: [
          expect.objectContaining({ rowPosition: 1, fieldCount: 2, digest: expect.any(String) }),
        ],
        hasFormula: false,
        hasMergedCells: false,
        hasRepeatedHeader: false,
      }),
    ]);
  });

  it("rejects unreadable XLSX bytes safely", async () => {
    await expect(inspectXlsxArchive(Buffer.from("not-a-zip"))).rejects.toMatchObject({
      code: "UNREADABLE_WORKBOOK",
    });
  });

  it("retains only a digest for the structural header row, never data values", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Talabat Performance");
    sheet.addRow([
      "date",
      "restaurant_id",
      "unavailable_time_reason",
      "avoidable_cancellation_reason",
      "gross_sales",
      "successful_orders",
    ]);
    for (let index = 1; index <= 24; index += 1) {
      sheet.addRow([
        new Date(`2026-01-${String(index).padStart(2, "0")}T00:00:00.000Z`),
        index,
        "check in required",
        "unreachable",
        100 + index,
        index,
      ]);
    }

    const profile = await profileXlsxBuffer(Buffer.from(await workbook.xlsx.writeBuffer()));

    expect(profile).toEqual([
      expect.objectContaining({
        normalizedSheetName: "talabat_performance",
        headerCandidateDigests: [
          expect.objectContaining({ rowPosition: 1, fieldCount: 6, digest: expect.any(String) }),
        ],
        hasRepeatedHeader: false,
      }),
    ]);
    expect(JSON.stringify(profile)).not.toContain("check in required");
    expect(JSON.stringify(profile)).not.toContain("unreachable");
  });

  it("fails closed when a claimed object identity has changed", async () => {
    const fail = vi.fn().mockResolvedValue(undefined);
    const result = await runReportPackageProfiling(
      {
        organizationId: reportPackage().organization_id,
        packageId: reportPackage().id,
        idempotencyKey: "report-profile:10000000-0000-4000-8000-000000000001",
      },
      {
        claim: vi.fn().mockResolvedValue({ outcome: "acquired", reportPackage: reportPackage() }),
        objectStore: {
          stat: vi.fn().mockResolvedValue({
            id: "10000000-0000-4000-8000-000000000099",
            metadata: { size: 8, mimetype: "text/csv" },
          }),
          download: vi.fn(),
        },
        complete: vi.fn(),
        fail,
      },
    );

    expect(result).toEqual({ outcome: "failed" });
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ code: "OBJECT_IDENTITY_CHANGED" }));
  });

  it("keeps the column names an operator would need to map an unknown export", async () => {
    // Only names, and only normalized ones. The values under them are never
    // read here, and a digest cannot be turned back into a column name — which
    // is exactly why the names have to be kept alongside it.
    const sheets = await profileCsvBuffer(
      Buffer.from("Order Date,Total Sales,Total Orders\n2026-08-01,89.00,3\n"),
    );

    expect(sheets[0]?.headerCandidates).toEqual([
      { rowPosition: 1, normalizedHeaders: ["order_date", "total_sales", "total_orders"] },
    ]);
    expect(sheets[0]?.headerCandidateDigests[0]?.normalizedHeaderDigests).toHaveLength(3);
    expect(JSON.stringify(sheets[0]?.headerCandidates)).not.toContain("89");
  });
});
