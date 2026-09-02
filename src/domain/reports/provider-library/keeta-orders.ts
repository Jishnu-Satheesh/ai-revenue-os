import { reportContractDocumentSchema } from "@/domain/reports/contracts";
import { reportProjectionDocumentSchema } from "@/domain/reports/projection";
import type { ProviderReportDefinition } from "@/domain/reports/provider-library/types";

/**
 * Keeta's order export: one row per order, twenty-five columns.
 *
 * The first governed report on this platform that states a cost. Everything
 * before it wrote revenue and volume, which is why the workspace's money
 * chapter has been saying its detectors "need cost inputs that no approved
 * report writes yet". Keeta charges commission per order and says so here.
 *
 * Order-level rows need no new machinery: the projector already accumulates per
 * period, so a day's orders sum into a day's figures with contributor counts
 * recorded. The sheet is named `0` and the date is the integer `20260223`, both
 * exactly as in Keeta's restaurant export.
 *
 * What is deliberately not read, and why each one matters:
 *
 * `Promotion expense` is already projected from the restaurant export as
 * `promotion.funding` for these same days. Reading it again here would put two
 * sources under one metric for one period and manufacture an overlap decision
 * for an operator to settle, for a figure that would not change.
 *
 * `Delivery fee` stays bound but unprojected. The export does not say whether
 * the customer paid it or the restaurant was charged it, and the two are
 * opposite facts. Calling it a cost would be a claim this file cannot support.
 *
 * `Reason for order cancellation` is almost always empty and its only value is
 * an image URL, not a reason, so it stays unread.
 *
 * `Cancellation type` carries the fault attribution and is now projected, via
 * the declared label map that translates Keeta's sentences into the approved
 * vocabulary. What it counts is orders Keeta attributed to a party, which is
 * not the same as the channel's cancelled-order count: a partially refunded
 * order carries an attribution while the provider still counts it as
 * fulfilled. The two figures are therefore not expected to agree, and the
 * metric is named for what it counts rather than for what it nearly is.
 *
 * `Review score` is three distinct values across the whole export, almost all
 * absent. A rating derived from that would be arithmetic dressed as insight.
 *
 * `Meal ready time (min)` is summed, unlike Talabat's preparation time which is
 * deliberately left unprojected. The difference is real: Talabat states a daily
 * *average*, and summing averages produces a number that means nothing. This
 * column states minutes for one order, so a day's total is a fact, and a true
 * mean can be derived from it and the day's order count rather than copied from
 * a provider's own rounding.
 */
export const keetaOrders: ProviderReportDefinition = {
  key: "keeta.orders.detail",
  provider: "Keeta",
  reportType: "orders_detail",
  summary:
    "Commission charged, marketplace promotion funding and preparation minutes, from Keeta's order export.",
  draftedFrom: "Keeta/Keeta-Jan-Feb-2026-Orders-Data.xlsx",
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
            // Written as the integer `20260223`, as in every Keeta export.
            dateEncoding: "compact_date",
            required: true,
          },
          {
            canonicalField: "commission",
            sourceHeader: "commission",
            parser: "money",
            financialSign: "positive",
            required: true,
          },
          {
            canonicalField: "keeta_promotion_subsidies",
            sourceHeader: "keeta_promotion_subsidies",
            parser: "money",
            financialSign: "positive",
            required: true,
          },
          {
            canonicalField: "meal_ready_time_min",
            sourceHeader: "meal_ready_time_min",
            parser: "decimal",
            required: true,
          },
          {
            // Bound so its shape stays validated, projected by nothing until
            // the export says who the fee was charged to.
            canonicalField: "delivery_fee",
            sourceHeader: "delivery_fee",
            parser: "money",
            financialSign: "positive",
            required: false,
          },
          {
            // Who cancelled the order, in Keeta's own words. Written `-` on
            // every order Keeta did not cancel, which is the absence of an
            // attribution rather than a party of its own.
            canonicalField: "cancellation_type",
            sourceHeader: "cancellation_type",
            parser: "text",
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
        key: "commission",
        normalizedSheetName: "sheet_0",
        canonicalField: "commission",
        metricKey: "cost.commission",
        valueKind: "money",
        aggregation: "sum",
      },
      {
        key: "promotion_provider_subsidy",
        normalizedSheetName: "sheet_0",
        canonicalField: "keeta_promotion_subsidies",
        metricKey: "promotion.provider_subsidy",
        valueKind: "money",
        aggregation: "sum",
      },
      {
        key: "preparation_minutes",
        normalizedSheetName: "sheet_0",
        canonicalField: "meal_ready_time_min",
        metricKey: "operations.preparation_minutes",
        valueKind: "count",
        aggregation: "sum",
      },
      {
        // One observation per party per day, counted from the sentences Keeta
        // writes in this column. The map is the translation an operator
        // approves; a fourth party would refuse the import rather than join
        // the breakdown unnamed.
        key: "cancellation_party",
        normalizedSheetName: "sheet_0",
        canonicalField: "cancellation_type",
        metricKey: "order.cancellation_attribution_count",
        valueKind: "count",
        aggregation: "sum",
        categorical: {
          dimensionKey: "cancelled_by",
          allowedValues: ["MERCHANT", "CUSTOMER_SERVICE", "PLATFORM"],
          labelMap: {
            "Cancelled by merchant": "MERCHANT",
            "Cancelled by customer service": "CUSTOMER_SERVICE",
            // Keeta's own cancellation. The parenthetical says the restaurant
            // was compensated; that is a payment this file does not state, so
            // only the party is read.
            "Cancelled by Keeta (compensation to restaurant)": "PLATFORM",
          },
          collectInjectedValues: false,
        },
      },
    ],
    controlTotals: [],
  }),
};
