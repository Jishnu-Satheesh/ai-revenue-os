import { reportContractDocumentSchema } from "@/domain/reports/contracts";
import { reportProjectionDocumentSchema } from "@/domain/reports/projection";
import type { ProviderReportDefinition } from "@/domain/reports/provider-library/types";

/**
 * Keeta's billing report, `Billing data summary` sheet: one row per day.
 *
 * The workbook has four sheets and this is the one that carries money per day.
 * `Invoice Details` settles by billing cycle rather than by day, `Order Summary`
 * is order-level, and `Explanation` is a glossary.
 *
 * The header is three rows deep. Rows one and two are merged group labels —
 * `Total revenue`, `Commission` — and row three is the only row that names the
 * columns, so that is the header and the data starts at row four.
 *
 * Sales revenue here is the original item price including VAT.
 *
 * Commission stays bound and unprojected, but no longer for the reason this
 * file used to give. `cost.commission` exists now. The reason is narrower and
 * firmer: Keeta's order export already writes this same figure per day, and the
 * two files agree to the fils on a real export. Projecting it twice would put
 * two sources under one metric for one period and hand an operator an overlap
 * to settle between a number and itself.
 *
 * Bank charges and POS machine fees are different: nothing else states them.
 * Reconciled against a client's own statement of account, they are roughly a
 * quarter of what the marketplace invoiced over the window -- enough that
 * without them the platform reports a channel costing about half what it does.
 *
 * Both are written as deductions, because that is what they are: Keeta
 * subtracts them from what it pays. The declaration says
 * `signConvention: "deduction_as_cost"` so they land as costs rather than as
 * negative costs, which is the same figure said backwards and does not sum
 * with the commission the order export writes as a positive.
 *
 * The POS fee arrives in weekly lumps rather than daily, so most days carry a
 * plain zero and a few carry the charge. Summing per day is a fact about those
 * days; spreading a month's charge across its days would invent figures Keeta
 * never stated.
 */
export const keetaBillingSummary: ProviderReportDefinition = {
  key: "keeta.billing.summary.daily",
  provider: "Keeta",
  reportType: "billing_summary_daily",
  summary: "Daily sales revenue and commission, from Keeta's billing report.",
  draftedFrom: "Keeta/billing_report_2026_jan.xlsx",
  contract: reportContractDocumentSchema.parse({
    schemaVersion: 1,
    currency: "AED",
    outletGrain: "branch",
    sheets: [
      {
        normalizedSheetName: "billing_data_summary",
        headerRow: 3,
        dataStartRow: 4,
        allowFormula: false,
        allowMergedCells: true,
        fields: [
          {
            canonicalField: "period_date",
            sourceHeader: "transaction_date",
            parser: "local_date",
            // Written as `1 Jan 2026`.
            dateEncoding: "text_date",
            required: true,
          },
          {
            canonicalField: "sales_revenue",
            sourceHeader: "total_original_item_price_vat_included",
            parser: "money",
            financialSign: "positive",
            required: true,
          },
          {
            canonicalField: "order_commission",
            sourceHeader: "total_commission_vat_included",
            parser: "money",
            // Keeta writes what it takes as a negative, which is the sign this
            // column genuinely carries. Recording it as positive would invert a
            // cost into earnings the moment anything summed it.
            financialSign: "negative",
            required: true,
          },
          {
            canonicalField: "bank_fee",
            sourceHeader: "total_bank_fee_vat_included",
            parser: "money",
            financialSign: "negative",
            required: true,
          },
          {
            canonicalField: "pos_machine_fee",
            sourceHeader: "pos_machine_fee_vat_included",
            parser: "money",
            // Written as a deduction on the four days it is charged and as a
            // plain zero on the rest, never blank and never positive.
            financialSign: "negative",
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
    outputKind: "period_grain",
    grain: "day",
    periodKey: { normalizedSheetName: "billing_data_summary", canonicalField: "period_date" },
    outputs: [
      {
        key: "gross_revenue",
        normalizedSheetName: "billing_data_summary",
        canonicalField: "sales_revenue",
        metricKey: "revenue.gross",
        valueKind: "money",
        aggregation: "sum",
      },
      {
        key: "payment_processing",
        normalizedSheetName: "billing_data_summary",
        canonicalField: "bank_fee",
        metricKey: "cost.payment_processing",
        valueKind: "money",
        aggregation: "sum",
        signConvention: "deduction_as_cost",
      },
      {
        key: "equipment_fee",
        normalizedSheetName: "billing_data_summary",
        canonicalField: "pos_machine_fee",
        metricKey: "cost.equipment_fee",
        valueKind: "money",
        aggregation: "sum",
        signConvention: "deduction_as_cost",
      },
    ],
    // Keeta does state a month's credit sales, on the commission invoice that
    // arrives beside this workbook. That figure is read by the operator at
    // approval time, not checked in here, because it changes every month while
    // this definition does not.
    controlTotals: [],
  }),
};
