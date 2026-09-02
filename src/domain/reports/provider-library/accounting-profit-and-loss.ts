import { reportContractDocumentSchema } from "@/domain/reports/contracts";
import { reportProjectionDocumentSchema } from "@/domain/reports/projection";
import type { ProviderReportDefinition } from "@/domain/reports/provider-library/types";

/**
 * The company's monthly profit and loss, from its accounting system.
 *
 * The first report here that is not a marketplace export, and the only one that
 * states what it costs to make the food. Every other file describes what a
 * channel sold and what the channel charged for selling it; this one carries
 * food, packaging and the marketplace commission the books actually recorded,
 * which is the whole reason the money chapter has been saying that what remains
 * after a marketplace's deductions is not profit.
 *
 * Two things about it are unlike anything else the platform reads.
 *
 * It is transposed. A statement puts one account on each row and one month in
 * each column heading, which is the mirror image of every provider export. The
 * sheet declares `recordOrientation: "period_columns"` and is rotated once on
 * the way in; after that it is read exactly like a spreadsheet. See ADR 0045.
 *
 * And it is a PDF, so its figures arrive as the text that was printed --
 * `1,234.56`, separators and all. `numberFormat: "grouped"` says so. Nothing
 * guesses: an undeclared grouped column still fails.
 *
 * **Scope.** This is the company's statement, not the shop floor's. It books
 * Keeta, Talabat and Zomato commission under cost of goods sold, and under
 * accrual accounting a commission cost only appears in the period whose sales
 * it was charged on -- so those marketplaces' sales are already inside the
 * income line, and there is exactly one income sub-tree on the statement to
 * hold them. The split between offline trade and marketplace trade is stated
 * nowhere in this file.
 *
 * That is why the income line projects to `revenue.company_gross` and not to
 * `revenue.gross`. `revenue.gross` is what the cross-channel share is computed
 * from, and a channel whose revenue already contains every other channel's
 * would make each marketplace look like a fraction of itself while the finding
 * reported itself as complete.
 *
 * **Page one only.** Income, cost of goods sold and the commission lines are
 * all on it. The operating expenses run onto pages two and three and are not
 * read yet. If a future month pushes an account across the page break the
 * import fails on the header it cannot find, which is the loud failure this
 * would rather have than a quiet one.
 *
 * **Gross profit is deliberately not bound.** The statement states it, and it
 * would be the natural check on our own arithmetic, but a money field must
 * declare one fixed sign and gross profit is only positive while the business
 * is profitable. Binding it would mean a loss-making month failed the import.
 * Recomputing the margin from the revenue and costs below costs nothing and
 * carries no such trap.
 */
export const accountingProfitAndLoss: ProviderReportDefinition = {
  key: "accounting.profit_and_loss.monthly",
  provider: "Accounting",
  reportType: "profit_and_loss_monthly",
  summary: "Monthly income, food and packaging cost and marketplace commission, from the books.",
  draftedFrom: "Offline_Store_Profit_and_loss .pdf",
  contract: reportContractDocumentSchema.parse({
    schemaVersion: 1,
    currency: "AED",
    outletGrain: "branch",
    sheets: [
      {
        normalizedSheetName: "page_1",
        // Rotated on the way in. After that, the header row is the account
        // column and each month is one record, so these two mean what they
        // always mean, counted down the rotated grid.
        recordOrientation: "period_columns",
        headerRow: 1,
        dataStartRow: 2,
        // The months are printed above the columns rather than in a cell of
        // their own. This is the row they are on, counted as the statement
        // reads: title, subtitle, basis, then the month headings.
        periodHeaderRow: 4,
        allowFormula: false,
        allowMergedCells: false,
        fields: [
          {
            canonicalField: "period_month",
            // Supplied by the reader, because a column heading has no heading.
            sourceHeader: "report_period",
            parser: "local_date",
            // Written as `May 2026`.
            dateEncoding: "month_year",
            required: true,
          },
          {
            canonicalField: "operating_income",
            sourceHeader: "total_for_operating_income",
            parser: "money",
            financialSign: "positive",
            numberFormat: "grouped",
            required: true,
          },
          {
            canonicalField: "food_cost",
            sourceHeader: "food_items",
            parser: "money",
            // A statement prints a cost as a positive number under a cost
            // heading and subtracts it in the total. It is not a deduction
            // written as a negative, so there is no sign convention to undo.
            financialSign: "positive",
            numberFormat: "grouped",
            required: true,
          },
          {
            canonicalField: "packaging_cost",
            sourceHeader: "packing_consumables",
            parser: "money",
            financialSign: "positive",
            numberFormat: "grouped",
            required: true,
          },
          {
            canonicalField: "keeta_commission",
            sourceHeader: "keeta_service_commission",
            parser: "money",
            financialSign: "positive",
            numberFormat: "grouped",
            required: true,
          },
          {
            canonicalField: "talabat_commission",
            sourceHeader: "talabat_commission",
            parser: "money",
            financialSign: "positive",
            numberFormat: "grouped",
            required: true,
          },
          {
            canonicalField: "zomato_commission",
            sourceHeader: "zomato_commission",
            parser: "money",
            financialSign: "positive",
            numberFormat: "grouped",
            required: true,
          },
        ],
      },
    ],
    // A row or cell count would compare the rotated sheet against a profile
    // taken before it was rotated, and fail every time while nothing was wrong.
    // The contract schema refuses one here for that reason.
    controls: [],
    unmappedFieldDisposition: "reviewed_ignore",
    // Pages two and three carry the operating expenses and are not read yet.
    unmappedSheetDisposition: "reviewed_ignore",
  }),
  projection: reportProjectionDocumentSchema.parse({
    schemaVersion: 1,
    outputKind: "period_grain",
    grain: "month",
    periodKey: { normalizedSheetName: "page_1", canonicalField: "period_month" },
    outputs: [
      {
        key: "company_gross_revenue",
        normalizedSheetName: "page_1",
        canonicalField: "operating_income",
        metricKey: "revenue.company_gross",
        valueKind: "money",
        aggregation: "sum",
      },
      {
        key: "food_cost",
        normalizedSheetName: "page_1",
        canonicalField: "food_cost",
        metricKey: "cost.food",
        valueKind: "money",
        aggregation: "sum",
      },
      {
        key: "packaging_cost",
        normalizedSheetName: "page_1",
        canonicalField: "packaging_cost",
        metricKey: "cost.packaging",
        valueKind: "money",
        aggregation: "sum",
      },
      {
        key: "marketplace_commission",
        normalizedSheetName: "page_1",
        canonicalField: "keeta_commission",
        // One figure the statement reports across three accounts. At company
        // scope this is the whole marketplace commission bill; per marketplace
        // it belongs to that channel's own report, which states it per day.
        sumWith: ["talabat_commission", "zomato_commission"],
        metricKey: "cost.commission",
        valueKind: "money",
        aggregation: "sum",
      },
    ],
    controlTotals: [],
  }),
};
