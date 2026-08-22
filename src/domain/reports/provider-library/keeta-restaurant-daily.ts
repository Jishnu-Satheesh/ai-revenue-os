import { reportContractDocumentSchema } from "@/domain/reports/contracts";
import { reportProjectionDocumentSchema } from "@/domain/reports/projection";
import type { ProviderReportDefinition } from "@/domain/reports/provider-library/types";

/**
 * Keeta's restaurant data export: one row per day, thirty-two columns.
 *
 * This is the file that made provider-declared absence necessary. Keeta writes
 * `-` in the orders column on a day with no orders, beside a column that still
 * counted the customers who looked at the menu. That is absence, not zero, and
 * nothing but the contract can say so.
 *
 * The sheet is named `0` in every Keeta data export, so the name distinguishes
 * nothing and the headers do all the work. It is still matched by name, because
 * `0` is at least stable — unlike Talabat's, it does not carry the month.
 *
 * Only orders are projected. This export's money columns are promotion expense,
 * commission and delivery fee, all costs, and its revenue lives in the billing
 * report instead.
 */
export const keetaRestaurantDaily: ProviderReportDefinition = {
  key: "keeta.restaurant.daily",
  provider: "Keeta",
  reportType: "restaurant_daily",
  summary: "Daily orders, promotion expense and funnel counts, from Keeta's restaurant data export.",
  draftedFrom: "Keeta/Keeta-Jan-Feb-2026-Resturant-Data.xlsx",
  contract: reportContractDocumentSchema.parse({
    schemaVersion: 1,
    currency: "AED",
    outletGrain: "branch",
    sheets: [
      {
        normalizedSheetName: "sheet_0",
        headerRow: 1,
        dataStartRow: 2,
        allowFormula: false,
        allowMergedCells: false,
        fields: [
          {
            canonicalField: "period_date",
            sourceHeader: "date",
            parser: "local_date",
            // Written as the integer `20260228`.
            dateEncoding: "compact_date",
            required: true,
          },
          {
            canonicalField: "valid_orders",
            sourceHeader: "valid_orders",
            parser: "integer",
            absentMarkers: ["-"],
            required: false,
          },
          {
            canonicalField: "promotion_expense",
            sourceHeader: "promotion_expense",
            parser: "money",
            financialSign: "positive",
            absentMarkers: ["-"],
            required: false,
          },
          {
            canonicalField: "customer_exposure",
            sourceHeader: "customer_exposure",
            parser: "integer",
            absentMarkers: ["-"],
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
    periodKey: { normalizedSheetName: "sheet_0", canonicalField: "period_date" },
    outputs: [
      {
        key: "orders",
        normalizedSheetName: "sheet_0",
        canonicalField: "valid_orders",
        metricKey: "transactions.count",
        valueKind: "count",
        aggregation: "sum",
      },
      {
        key: "promotion_funding",
        normalizedSheetName: "sheet_0",
        canonicalField: "promotion_expense",
        metricKey: "promotion.funding",
        valueKind: "money",
        aggregation: "sum",
      },
      {
        key: "listing_impressions",
        normalizedSheetName: "sheet_0",
        canonicalField: "customer_exposure",
        metricKey: "listing.impressions",
        valueKind: "count",
        aggregation: "sum",
      },
    ],
    controlTotals: [],
  }),
};
