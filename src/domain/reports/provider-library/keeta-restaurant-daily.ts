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
 * Revenue is not projected here: this export's money columns are promotion
 * expense, commission and delivery fee, all costs, and its revenue lives in the
 * billing report instead. Commission and delivery fee stay bound for validation
 * until the economics vocabulary is separately approved.
 *
 * The funnel's last stage is the one figure this export splits in two, so it is
 * declared as `order_customers_in_restaurant` summed with
 * `order_customers_out_of_restaurant`. `checkout_customers` would have fitted a
 * single column and overstated the stage, because it counts people who reached
 * checkout and never ordered.
 *
 * `cancelled_orders` is a count with no fault attached: Keeta never says whose
 * fault a cancellation was, so it is recorded as `order.cancelled_count` and
 * never as an avoidable one.
 */
export const keetaRestaurantDaily: ProviderReportDefinition = {
  key: "keeta.restaurant.daily",
  provider: "Keeta",
  reportType: "restaurant_daily",
  summary:
    "Daily orders, promotion expense and funnel counts, from Keeta's restaurant data export.",
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
          {
            canonicalField: "restaurant_visitors",
            sourceHeader: "restaurant_visitors",
            parser: "integer",
            absentMarkers: ["-"],
            required: false,
          },
          {
            canonicalField: "add_to_cart_customers",
            sourceHeader: "add_to_cart_customers",
            parser: "integer",
            absentMarkers: ["-"],
            required: false,
          },
          {
            canonicalField: "total_orders",
            sourceHeader: "total_orders",
            parser: "integer",
            absentMarkers: ["-"],
            required: false,
          },
          {
            canonicalField: "cancelled_orders",
            sourceHeader: "cancelled_orders",
            parser: "integer",
            absentMarkers: ["-"],
            required: false,
          },
          {
            canonicalField: "order_customers_in_restaurant",
            sourceHeader: "order_customers_in_restaurant",
            parser: "integer",
            absentMarkers: ["-"],
            required: false,
          },
          {
            canonicalField: "order_customers_out_of_restaurant",
            sourceHeader: "order_customers_out_of_restaurant",
            parser: "integer",
            absentMarkers: ["-"],
            required: false,
          },
          // Durations, written in hours to one decimal place.
          {
            canonicalField: "total_open_duration_h",
            sourceHeader: "total_open_duration_h",
            parser: "decimal",
            absentMarkers: ["-"],
            required: false,
          },
          {
            canonicalField: "platform_closure_duration_h",
            sourceHeader: "platform_closure_duration_h",
            parser: "decimal",
            absentMarkers: ["-"],
            required: false,
          },
          {
            canonicalField: "manual_closure_duration_h",
            sourceHeader: "manual_closure_duration_h",
            parser: "decimal",
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
      {
        key: "listing_menu_views",
        normalizedSheetName: "sheet_0",
        canonicalField: "restaurant_visitors",
        metricKey: "listing.menu_views",
        valueKind: "count",
        aggregation: "sum",
      },
      {
        key: "listing_cart_additions",
        normalizedSheetName: "sheet_0",
        canonicalField: "add_to_cart_customers",
        metricKey: "listing.cart_additions",
        valueKind: "count",
        aggregation: "sum",
      },
      {
        key: "orders_total",
        normalizedSheetName: "sheet_0",
        canonicalField: "total_orders",
        metricKey: "order.total_count",
        valueKind: "count",
        aggregation: "sum",
      },
      {
        key: "orders_cancelled",
        normalizedSheetName: "sheet_0",
        canonicalField: "cancelled_orders",
        metricKey: "order.cancelled_count",
        valueKind: "count",
        aggregation: "sum",
      },
      {
        key: "operations_scheduled_minutes",
        normalizedSheetName: "sheet_0",
        canonicalField: "total_open_duration_h",
        metricKey: "operations.scheduled_minutes",
        valueKind: "count",
        aggregation: "sum",
        convert: "hours_to_minutes",
      },
      {
        key: "operations_closed_minutes",
        normalizedSheetName: "sheet_0",
        canonicalField: "platform_closure_duration_h",
        // Closed time is what the platform shut plus what the store shut. One
        // without the other is not the day's closure.
        sumWith: ["manual_closure_duration_h"],
        metricKey: "operations.closed_minutes",
        valueKind: "count",
        aggregation: "sum",
        convert: "hours_to_minutes",
      },
      {
        key: "listing_placed_orders",
        normalizedSheetName: "sheet_0",
        canonicalField: "order_customers_in_restaurant",
        // Keeta splits the funnel's last stage in two, and neither half is the
        // stage. `checkout_customers` would fit in one column and overstate it,
        // because it counts people who reached checkout and never ordered.
        sumWith: ["order_customers_out_of_restaurant"],
        metricKey: "listing.placed_orders",
        valueKind: "count",
        aggregation: "sum",
      },
    ],
    controlTotals: [],
  }),
};
