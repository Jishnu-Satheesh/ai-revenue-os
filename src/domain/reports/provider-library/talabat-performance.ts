import { reportContractDocumentSchema } from "@/domain/reports/contracts";
import { reportProjectionDocumentSchema } from "@/domain/reports/projection";
import type { ProviderReportDefinition } from "@/domain/reports/provider-library/types";

/**
 * Talabat's vendor performance export: one row per day, fifty-six columns.
 *
 * Two things about this file drive the shape below.
 *
 * The worksheet is named after the export range, so a contract keyed on its
 * name would recognise the report once and never again. It is read by position.
 *
 * The provider writes a row for every day in the range and leaves the figures
 * blank on days it has nothing to report — thirty-one of the fifty-nine days in
 * the drafting download. Those days stay absent rather than becoming zeroes, so
 * the value fields are not required. The date is, because a row that cannot be
 * dated cannot be filed anywhere.
 *
 * Only revenue and orders are bound. The other fifty-three columns are real and
 * useful, and none of them has a metric definition to land in yet; binding them
 * as validated-but-unprojected noise would make the contract harder to read
 * without making anything measurable.
 */
export const talabatPerformance: ProviderReportDefinition = {
  key: "talabat.performance.daily",
  provider: "Talabat",
  reportType: "performance_daily",
  summary: "Daily sales and orders per outlet, from Talabat's vendor performance report.",
  draftedFrom: "Talabat-Jan-Feb-2026-Performance-Report.xlsx",
  contract: reportContractDocumentSchema.parse({
    schemaVersion: 1,
    currency: "AED",
    outletGrain: "branch",
    sheets: [
      {
        normalizedSheetName: "performance",
        sheetLocator: { kind: "position", position: 1 },
        headerRow: 1,
        dataStartRow: 2,
        allowFormula: false,
        allowMergedCells: false,
        fields: [
          {
            canonicalField: "period_date",
            sourceHeader: "date",
            parser: "local_date",
            // A spreadsheet date cell, which reaches the reader as the raw
            // serial `46023` because cell styles are deliberately ignored.
            dateEncoding: "excel_serial",
            required: true,
          },
          {
            canonicalField: "gross_sales",
            sourceHeader: "gross_sales",
            parser: "money",
            financialSign: "positive",
            required: false,
          },
          {
            canonicalField: "successful_orders",
            sourceHeader: "successful_orders",
            parser: "integer",
            required: false,
          },
        ],
      },
    ],
    controls: [],
    unmappedFieldDisposition: "reviewed_ignore",
    unmappedSheetDisposition: "reviewed_ignore",
  }),
  projection: reportProjectionDocumentSchema.parse({
    schemaVersion: 1,
    outputKind: "period_grain",
    grain: "day",
    periodKey: { normalizedSheetName: "performance", canonicalField: "period_date" },
    outputs: [
      {
        key: "gross_revenue",
        normalizedSheetName: "performance",
        canonicalField: "gross_sales",
        metricKey: "revenue.gross",
        valueKind: "money",
        aggregation: "sum",
      },
      {
        key: "orders",
        normalizedSheetName: "performance",
        canonicalField: "successful_orders",
        metricKey: "transactions.count",
        valueKind: "count",
        aggregation: "sum",
      },
    ],
    // Talabat states no total anywhere in the file and issues no statement that
    // repeats one, so there is nothing honest to reconcile against.
    controlTotals: [],
  }),
};
