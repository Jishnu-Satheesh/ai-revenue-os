import { reportContractDocumentSchema } from "@/domain/reports/contracts";
import { reportProjectionDocumentSchema } from "@/domain/reports/projection";
import type { ProviderReportDefinition } from "@/domain/reports/provider-library/types";

/**
 * Talabat's vendor performance export: one row per day, fifty-six named
 * columns.
 *
 * Four things about this file drive the shape below.
 *
 * The worksheet is named after the export range, so a contract keyed on its
 * name would recognise the report once and never again. It is read by position.
 *
 * The provider writes a row for every day in the range and leaves the figures
 * blank on days it has nothing to report -- thirty-nine of the fifty-nine days
 * in the drafting download. Those days stay absent rather than becoming zeroes,
 * so the value fields are not required. The date is, because a row that cannot
 * be dated cannot be filed anywhere.
 *
 * Some rows are ragged. When a day closed for two causes the provider writes
 * the second unavailability reason directly after the first, and every later
 * cell of that row sits two places further right than the header says --
 * eleven of fifty-nine rows in the drafting export. Reading those rows by
 * header name alone would bind the wrong cells silently, on precisely the days
 * that carry the most operational information, so the sheet declares where the
 * displacement starts and the projector reads the overflow off each row.
 *
 * One column is categorical rather than numeric: the day's unavailability
 * reasons. The projection counts the days carrying each declared label into
 * dimension-tagged observations, because "39 days closed for check-in" is
 * counted evidence while prose in a cell is not.
 *
 * What is deliberately left unprojected: the daily average preparation time.
 * Summing daily averages across days produces a number that means nothing, the
 * ledger stores sums only, and a mean-of-averages is an arithmetic claim this
 * slice does not make. The column stays bound so its shape stays validated;
 * a window figure for it waits for a detector that can state its method.
 */
export const talabatPerformance: ProviderReportDefinition = {
  key: "talabat.performance.daily",
  provider: "Talabat",
  reportType: "performance_daily",
  summary:
    "Daily sales, funnel, cancellations, availability and customer mix per outlet, from Talabat's vendor performance report.",
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
        // Days with a second unavailability reason carry two injected cells
        // from this column onward.
        raggedRows: { injectedFromColumnIndex: 22 },
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
            canonicalField: "online_sales",
            sourceHeader: "online_sales",
            parser: "money",
            financialSign: "positive",
            required: false,
          },
          {
            canonicalField: "cash_sales",
            sourceHeader: "cash_sales",
            parser: "money",
            financialSign: "positive",
            required: false,
          },
          {
            canonicalField: "delivery_sales",
            sourceHeader: "delivery_sales",
            parser: "money",
            financialSign: "positive",
            required: false,
          },
          {
            canonicalField: "pickup_sales",
            sourceHeader: "pickup_sales",
            parser: "money",
            financialSign: "positive",
            required: false,
          },
          {
            canonicalField: "items_count",
            sourceHeader: "items_count",
            parser: "integer",
            required: false,
          },
          {
            // Fractional minutes are what the provider writes -- `355.6` --
            // so the quantity is kept exact rather than rounded into a lie.
            canonicalField: "unavailable_minutes",
            sourceHeader: "unavailable_time_duration_minutes",
            parser: "decimal",
            required: false,
          },
          {
            canonicalField: "scheduled_open_minutes",
            sourceHeader: "scheduled_open_time_minutes",
            parser: "decimal",
            required: false,
          },
          {
            canonicalField: "unavailability_reason",
            sourceHeader: "unavailable_time_reason",
            parser: "text",
            required: false,
          },
          {
            canonicalField: "orders_count",
            sourceHeader: "orders_count",
            parser: "integer",
            required: false,
          },
          {
            canonicalField: "cancelled_orders",
            sourceHeader: "cancelled_orders",
            parser: "integer",
            required: false,
          },
          {
            canonicalField: "avoidable_cancellation_orders",
            sourceHeader: "orders_with_avoidable_cancellations",
            parser: "integer",
            required: false,
          },
          {
            canonicalField: "rejection_revenue_loss",
            sourceHeader: "revenue_loss_from_rejections",
            parser: "money",
            financialSign: "positive",
            required: false,
          },
          {
            canonicalField: "delivery_orders",
            sourceHeader: "delivery_orders",
            parser: "integer",
            required: false,
          },
          {
            canonicalField: "pickup_orders",
            sourceHeader: "pickup_orders",
            parser: "integer",
            required: false,
          },
          {
            canonicalField: "preparation_time_minutes",
            sourceHeader: "average_preparation_time_minutes",
            parser: "decimal",
            required: false,
          },
          {
            canonicalField: "new_customer_orders",
            sourceHeader: "orders_from_new_customers",
            parser: "integer",
            required: false,
          },
          {
            canonicalField: "returning_customer_orders",
            sourceHeader: "orders_from_returning_customers",
            parser: "integer",
            required: false,
          },
          {
            canonicalField: "impressions",
            sourceHeader: "impressions",
            parser: "integer",
            required: false,
          },
          {
            canonicalField: "menu_views",
            sourceHeader: "viewed_your_menu",
            parser: "integer",
            required: false,
          },
          {
            canonicalField: "cart_additions",
            sourceHeader: "added_items_to_cart",
            parser: "integer",
            required: false,
          },
          {
            canonicalField: "placed_orders",
            sourceHeader: "placed_an_order",
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
        key: "online_revenue",
        normalizedSheetName: "performance",
        canonicalField: "online_sales",
        metricKey: "revenue.online_sales",
        valueKind: "money",
        aggregation: "sum",
      },
      {
        key: "cash_revenue",
        normalizedSheetName: "performance",
        canonicalField: "cash_sales",
        metricKey: "revenue.cash_sales",
        valueKind: "money",
        aggregation: "sum",
      },
      {
        key: "delivery_revenue",
        normalizedSheetName: "performance",
        canonicalField: "delivery_sales",
        metricKey: "revenue.delivery_sales",
        valueKind: "money",
        aggregation: "sum",
      },
      {
        key: "pickup_revenue",
        normalizedSheetName: "performance",
        canonicalField: "pickup_sales",
        metricKey: "revenue.pickup_sales",
        valueKind: "money",
        aggregation: "sum",
      },
      {
        key: "rejection_loss",
        normalizedSheetName: "performance",
        canonicalField: "rejection_revenue_loss",
        metricKey: "revenue.rejection_loss",
        valueKind: "money",
        aggregation: "sum",
      },
      {
        key: "items",
        normalizedSheetName: "performance",
        canonicalField: "items_count",
        metricKey: "units.count",
        valueKind: "count",
        aggregation: "sum",
      },
      {
        key: "closed_minutes",
        normalizedSheetName: "performance",
        canonicalField: "unavailable_minutes",
        metricKey: "operations.closed_minutes",
        valueKind: "count",
        aggregation: "sum",
      },
      {
        key: "scheduled_minutes",
        normalizedSheetName: "performance",
        canonicalField: "scheduled_open_minutes",
        metricKey: "operations.scheduled_minutes",
        valueKind: "count",
        aggregation: "sum",
      },
      {
        // The provider labels whole closed days. Its own summary counts each
        // day once, by the first-listed reason -- the second cause rides in
        // the cells a ragged row injects, and collecting those would double
        // six days across two labels and break the reconciliation to what
        // Talabat itself reports.
        key: "closed_days_by_reason",
        normalizedSheetName: "performance",
        canonicalField: "unavailability_reason",
        metricKey: "operations.closed_days",
        valueKind: "count",
        aggregation: "sum",
        categorical: {
          dimensionKey: "reason_code",
          allowedValues: ["CHECK_IN_REQUIRED", "UNREACHABLE"],
          collectInjectedValues: false,
        },
      },
      {
        key: "orders",
        normalizedSheetName: "performance",
        canonicalField: "orders_count",
        metricKey: "order.total_count",
        valueKind: "count",
        aggregation: "sum",
      },
      {
        key: "cancelled_orders",
        normalizedSheetName: "performance",
        canonicalField: "cancelled_orders",
        metricKey: "order.cancelled_count",
        valueKind: "count",
        aggregation: "sum",
      },
      {
        key: "avoidable_cancellations",
        normalizedSheetName: "performance",
        canonicalField: "avoidable_cancellation_orders",
        metricKey: "order.avoidable_cancellation_count",
        valueKind: "count",
        aggregation: "sum",
      },
      {
        key: "new_customer_orders",
        normalizedSheetName: "performance",
        canonicalField: "new_customer_orders",
        metricKey: "customer.new_order_count",
        valueKind: "count",
        aggregation: "sum",
      },
      {
        key: "returning_customer_orders",
        normalizedSheetName: "performance",
        canonicalField: "returning_customer_orders",
        metricKey: "customer.returning_order_count",
        valueKind: "count",
        aggregation: "sum",
      },
      {
        key: "impressions",
        normalizedSheetName: "performance",
        canonicalField: "impressions",
        metricKey: "listing.impressions",
        valueKind: "count",
        aggregation: "sum",
      },
      {
        key: "menu_views",
        normalizedSheetName: "performance",
        canonicalField: "menu_views",
        metricKey: "listing.menu_views",
        valueKind: "count",
        aggregation: "sum",
      },
      {
        key: "cart_additions",
        normalizedSheetName: "performance",
        canonicalField: "cart_additions",
        metricKey: "listing.cart_additions",
        valueKind: "count",
        aggregation: "sum",
      },
      {
        key: "placed_orders",
        normalizedSheetName: "performance",
        canonicalField: "placed_orders",
        metricKey: "listing.placed_orders",
        valueKind: "count",
        aggregation: "sum",
      },
    ],
    // Talabat states no total anywhere in the file and issues no statement that
    // repeats one, so there is nothing honest to reconcile against.
    controlTotals: [],
  }),
};
