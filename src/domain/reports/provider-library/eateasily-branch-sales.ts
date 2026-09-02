import { reportContractDocumentSchema } from "@/domain/reports/contracts";
import { reportProjectionDocumentSchema } from "@/domain/reports/projection";
import type { ProviderReportDefinition } from "@/domain/reports/provider-library/types";

/**
 * The branch-wise sales report EatEasily and Smile both export.
 *
 * One platform under two names, and the two downloads are structurally
 * identical: the same sheets, the same nine headings, the same layout. One
 * definition serves both channels, and the channel is declared on the upload
 * rather than inferred from the file, so nothing has to tell them apart.
 *
 * The file states its own total, in a row whose POS ID cell reads `Total`. In
 * the drafting download that row is the *first* data row, not the last. It is
 * set aside rather than summed — adding it to the rows it totals would double
 * every figure — and it is then the honest thing to check the import against,
 * so the projection reconciles to it with no tolerance.
 *
 * Total Orders is required, and that is an assumption worth naming. The
 * provider leaves it blank on the totals row, but the totals row is set aside
 * before anything is checked, so every row that is actually read should carry
 * it. If August's real export proves otherwise the import will stop with
 * "required field missing", which is the right way to find out — far better
 * than quietly importing revenue with no orders beside it, which would leave
 * the channel permanently short of what the economics needs.
 *
 * Commission is bound for validation but not projected. It is a cost, and
 * EatEasily states it excluding VAT while Keeta's invoice includes it, so the
 * two are not comparable until the cost model records which basis each uses.
 */
export const eatEasilyBranchSales: ProviderReportDefinition = {
  key: "eateasily.branch_sales.period",
  provider: "EatEasily and Smile",
  reportType: "branch_sales_summary",
  summary: "Sales, orders and commission per branch for the reporting period.",
  draftedFrom: "EatEasily-Smile/Jan_feb_2026_branch_wise_EatEasily.xlsx",
  contract: reportContractDocumentSchema.parse({
    schemaVersion: 1,
    currency: "AED",
    outletGrain: "branch",
    sheets: [
      {
        normalizedSheetName: "sales_report",
        headerRow: 1,
        dataStartRow: 2,
        allowFormula: false,
        allowMergedCells: false,
        totalsRow: { canonicalField: "pos_id", label: "Total" },
        fields: [
          { canonicalField: "pos_id", sourceHeader: "pos_id", parser: "text", required: false },
          {
            canonicalField: "total_sales",
            sourceHeader: "total_sales",
            parser: "money",
            financialSign: "positive",
            required: true,
          },
          {
            canonicalField: "total_orders",
            sourceHeader: "total_orders",
            parser: "integer",
            required: true,
          },
          {
            canonicalField: "total_commission",
            sourceHeader: "total_commission",
            parser: "money",
            financialSign: "positive",
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
    outputKind: "exact_range",
    outputs: [
      {
        key: "gross_revenue",
        normalizedSheetName: "sales_report",
        canonicalField: "total_sales",
        metricKey: "revenue.gross",
        valueKind: "money",
        aggregation: "sum",
      },
      {
        key: "orders",
        normalizedSheetName: "sales_report",
        canonicalField: "total_orders",
        metricKey: "transactions.count",
        valueKind: "count",
        aggregation: "sum",
      },
    ],
    controlTotals: [
      { outputKey: "gross_revenue", source: "sheet_totals_row", toleranceMinorUnits: 0 },
    ],
  }),
};
