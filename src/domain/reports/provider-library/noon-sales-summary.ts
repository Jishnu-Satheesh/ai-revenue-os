import { reportContractDocumentSchema } from "@/domain/reports/contracts";
import { reportProjectionDocumentSchema } from "@/domain/reports/projection";
import type { ProviderReportDefinition } from "@/domain/reports/provider-library/types";

/**
 * Noon's sales export: one figure per column for the whole period.
 *
 * The only report in the client's set that is genuinely a single period total
 * rather than a series, so it is the only one that projects into the
 * exact-range ledger.
 *
 * The layout is unusual and the row numbers below are not a mistake. Row one
 * names the columns, row two carries a paragraph explaining each one, row three
 * repeats those paragraphs as rich text, and row four holds the figures. Data
 * therefore starts at row four, and rows two and three are never read.
 *
 * Average order value is a ratio and is not projected. It is sales divided by
 * orders, both of which are here, and ADR 0027 keeps derived figures out of the
 * declaration language on purpose: a ratio recomputed from evidence can be
 * checked, and a ratio copied from a provider cannot.
 */
export const noonSalesSummary: ProviderReportDefinition = {
  key: "noon.sales.period",
  provider: "Noon",
  reportType: "sales_period_summary",
  summary: "Sales and successful orders for the whole reporting period, from Noon's sales export.",
  draftedFrom: "Noon-report-jan-feb-2026.xlsx",
  contract: reportContractDocumentSchema.parse({
    schemaVersion: 1,
    currency: "AED",
    outletGrain: "branch",
    sheets: [
      {
        normalizedSheetName: "sales_data",
        headerRow: 1,
        dataStartRow: 4,
        allowFormula: false,
        allowMergedCells: false,
        fields: [
          {
            canonicalField: "sales",
            sourceHeader: "sales",
            parser: "money",
            financialSign: "positive",
            required: true,
          },
          {
            canonicalField: "successful_orders",
            sourceHeader: "successful_orders",
            parser: "integer",
            required: true,
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
        normalizedSheetName: "sales_data",
        canonicalField: "sales",
        metricKey: "revenue.gross",
        valueKind: "money",
        aggregation: "sum",
      },
      {
        key: "orders",
        normalizedSheetName: "sales_data",
        canonicalField: "successful_orders",
        metricKey: "transactions.count",
        valueKind: "count",
        aggregation: "sum",
      },
    ],
    controlTotals: [],
  }),
};
