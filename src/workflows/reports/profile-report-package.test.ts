import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

import {
  inspectXlsxArchive,
  profileCsvBuffer,
  profileXlsxBuffer,
  runReportPackageProfiling,
} from "@/workflows/reports/profile-report-package";
import { REPORT_STRUCTURE_VERSION } from "@/domain/reports/contracts";
import { createReportStructureFingerprint } from "@/domain/reports/document-digest";
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
    admitted_under_admission_id: null,
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

  it("never mistakes a CSV data row for a header candidate", async () => {
    const sheets = await profileCsvBuffer(Buffer.from("Order Date,Total Sales\n2026-08-01,89.00\n"));

    expect(sheets[0]?.headerCandidateDigests).toEqual([
      expect.objectContaining({ rowPosition: 1, fieldCount: 2, digest: expect.any(String) }),
    ]);
    expect(sheets[0]?.headerCandidates).toEqual([
      { rowPosition: 1, normalizedHeaders: ["order_date", "total_sales"] },
    ]);
  });

  it("profiles the Talabat CSV shape to the same fingerprint as its XLSX twin", async () => {
    // The June 2026 CSV reached staging with five header candidates: the real
    // 56-column header plus four numeric data rows the profiler mistook for
    // headers, so it could never match the XLSX admission. These are its
    // stored column names, verbatim -- schema, never values.
    const talabatHeaders = [
      "date",
      "restaurant_id",
      "outlet_name",
      "successful_orders",
      "gross_sales",
      "online_sales",
      "cash_sales",
      "delivery_sales",
      "pickup_sales",
      "orders_count",
      "cancelled_orders",
      "online_orders",
      "cash_orders",
      "delivery_orders",
      "pickup_orders",
      "pro_orders",
      "pro_revenue",
      "items_count",
      "unavailable_time_duration_minutes",
      "unavailable_time_duration_rate",
      "scheduled_open_time_minutes",
      "unavailable_time_reason",
      "unavailable_time_duration_count",
      "orders_with_avoidable_cancellations",
      "avoidable_cancellation_rate",
      "revenue_loss_from_rejections",
      "avoidable_cancellation_reason",
      "avoidable_cancellation_count",
      "sales_loss",
      "average_preparation_time_minutes",
      "orders_marked_as_ready",
      "orders_marked_rate",
      "total_awt_duration_minutes",
      "orders_with_awt",
      "order_with_awt_fee",
      "total_fee_applied",
      "orders_in_bucket1_5_minutes",
      "orders_with_fees_in_bucket1_5_minutes",
      "orders_in_bucket2_5_mins_and_10_mins",
      "orders_with_fees_in_bucket2_5_mins_and_10_mins",
      "orders_in_bucket3_10_mins",
      "orders_with_fees_in_bucket3_10_mins",
      "total_customer_complaints_received",
      "customer_complaint_rate",
      "customer_complaint_reason",
      "customer_complaint_contacts",
      "own_delivery_contacts_count",
      "vendor_delivery_contacts_counts",
      "orders_from_new_customers",
      "orders_from_new_customers_rate",
      "orders_from_returning_customers",
      "orders_from_returning_customers_rate",
      "impressions",
      "viewed_your_menu",
      "added_items_to_cart",
      "placed_an_order",
    ];
    // Sparse numeric rows like the real export: a date plus a handful of
    // figures, seven populated cells each.
    const csvDataRow = (date: string, seed: number): string => {
      const cells = new Array<string>(talabatHeaders.length).fill("");
      cells[0] = date;
      cells[1] = String(seed);
      cells[4] = (seed * 10 + 0.5).toFixed(2);
      cells[5] = (seed * 6 + 0.25).toFixed(2);
      cells[9] = String(seed % 5);
      cells[17] = String(seed % 3);
      cells[52] = String(seed * 40);
      return cells.join(",");
    };
    const csv = [
      talabatHeaders.join(","),
      csvDataRow("2026-06-01", 3),
      csvDataRow("2026-06-02", 5),
    ].join("\n");

    const csvSheets = await profileCsvBuffer(Buffer.from(`${csv}\n`, "utf8"));

    expect(csvSheets[0]?.headerCandidateDigests).toEqual([
      expect.objectContaining({ rowPosition: 1, fieldCount: 56, digest: expect.any(String) }),
    ]);
    expect(csvSheets[0]?.headerCandidates).toEqual([
      { rowPosition: 1, normalizedHeaders: talabatHeaders },
    ]);
    // The row-1 digest the June package stored on staging. The fixed CSV
    // profile converges back to it.
    expect(csvSheets[0]?.headerCandidateDigests[0]?.digest).toBe(
      "d39a9b175ee6f4e7853c558a6b3cc7dc8b6b5d096fc8b3d55f6690828d8917b3",
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("June 2026");
    sheet.addRow(talabatHeaders);
    for (const [date, seed] of [
      ["2026-06-01", 3],
      ["2026-06-02", 5],
    ] as const) {
      const row: unknown[] = new Array<unknown>(talabatHeaders.length).fill(null);
      row[0] = new Date(`${date}T00:00:00.000Z`);
      row[1] = seed;
      row[4] = seed * 10 + 0.5;
      row[5] = seed * 6 + 0.25;
      row[9] = seed % 5;
      row[17] = seed % 3;
      row[52] = seed * 40;
      sheet.addRow(row);
    }

    const xlsxSheets = await profileXlsxBuffer(Buffer.from(await workbook.xlsx.writeBuffer()));

    expect(xlsxSheets[0]?.headerCandidateDigests).toEqual([
      expect.objectContaining({ rowPosition: 1, fieldCount: 56, digest: expect.any(String) }),
    ]);
    expect(csvSheets[0]?.headerCandidateDigests[0]?.digest).toBe(
      xlsxSheets[0]?.headerCandidateDigests[0]?.digest,
    );
    const structureOf = (sheets: typeof csvSheets): string =>
      createReportStructureFingerprint({
        structureVersion: REPORT_STRUCTURE_VERSION,
        outletGrain: "branch",
        parserVersion: 1,
        sheets: sheets.map((candidate, index) => ({
          position: index + 1,
          headerCandidateDigests: candidate.headerCandidateDigests.map((digest) => ({
            rowPosition: digest.rowPosition,
            fieldCount: digest.fieldCount,
            digest: digest.digest,
          })),
          hasFormula: candidate.hasFormula,
          hasMergedCells: candidate.hasMergedCells,
          hasRepeatedHeader: candidate.hasRepeatedHeader,
        })),
      });
    expect(structureOf(csvSheets)).toBe(structureOf(xlsxSheets));
  });
});
