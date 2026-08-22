import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

import {
  inspectXlsxArchive,
  profileCsvBuffer,
  profileXlsxBuffer,
  runReportPackageProfiling,
} from "@/workflows/reports/profile-report-package";
import type { ReportPackageRow } from "@/modules/reports/application/ports";

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

describe("governed report package profiling", () => {
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
});
