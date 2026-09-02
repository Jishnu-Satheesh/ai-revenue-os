import { describe, expect, it } from "vitest";

import { accountingProfitAndLoss } from "@/domain/reports/provider-library/accounting-profit-and-loss";
import { TRANSPOSED_PERIOD_HEADER } from "@/domain/reports/transpose";

const { contract, projection } = accountingProfitAndLoss;
const sheet = contract.sheets[0]!;

describe("the company's monthly profit and loss", () => {
  it("reads the statement rotated, with the months named in a column heading", () => {
    expect(sheet.recordOrientation).toBe("period_columns");
    expect(sheet.periodHeaderRow).toBe(4);
    // After rotation the account column is the header row and each month is a
    // record, so these mean what they always mean.
    expect(sheet.headerRow).toBe(1);
    expect(sheet.dataStartRow).toBe(2);
  });

  it("dates each record from the heading the reader supplies", () => {
    const period = sheet.fields.find((field) => field.canonicalField === "period_month");

    expect(period?.sourceHeader).toBe(TRANSPOSED_PERIOD_HEADER);
    expect(period?.dateEncoding).toBe("month_year");
    expect(projection.outputKind).toBe("period_grain");
    expect(projection.outputKind === "period_grain" && projection.grain).toBe("month");
  });

  it("says the statement prints its figures with separators", () => {
    // A PDF hands over what was printed. Every money column on this statement
    // reads `1,234.56`, which is not a number until the contract says so.
    const money = sheet.fields.filter((field) => field.parser === "money");

    expect(money.length).toBeGreaterThan(0);
    expect(money.every((field) => field.numberFormat === "grouped")).toBe(true);
  });

  it("records a cost as the positive figure the statement prints", () => {
    // A statement prints a cost as a positive number under a cost heading and
    // subtracts it in its own total. It is not a deduction written as a
    // negative, so there is no sign convention to undo.
    for (const field of sheet.fields.filter((candidate) => candidate.parser === "money")) {
      expect(field.financialSign, field.canonicalField).toBe("positive");
    }
    expect(projection.outputs.every((output) => output.signConvention === undefined)).toBe(true);
  });

  it("keeps company revenue out of the metric channels are compared on", () => {
    // The statement books marketplace commission as a cost, so under accrual
    // its income line already contains those marketplaces' sales. Filing it as
    // `revenue.gross` would make every channel look like a fraction of itself
    // while the cross-channel share reported itself as complete.
    const metrics = projection.outputs.map((output) => output.metricKey);

    expect(metrics).toContain("revenue.company_gross");
    expect(metrics).not.toContain("revenue.gross");
  });

  it("adds the three marketplaces into one commission figure", () => {
    const commission = projection.outputs.find((output) => output.metricKey === "cost.commission");

    expect(commission?.canonicalField).toBe("keeta_commission");
    expect(commission?.sumWith).toEqual(["talabat_commission", "zomato_commission"]);
  });

  it("states what it costs to make the food, which no marketplace export does", () => {
    const metrics = projection.outputs.map((output) => output.metricKey);

    expect(metrics).toContain("cost.food");
    expect(metrics).toContain("cost.packaging");
  });

  it("binds no label the statement uses more than once", () => {
    // `Cost of Goods Sold` and `Total for Cost of Goods Sold` each appear twice
    // on page one, carrying different figures. The reader refuses to bind
    // either, so a definition that named one would fail on the real file.
    const bound = sheet.fields.map((field) => field.sourceHeader);

    expect(bound).not.toContain("cost_of_goods_sold");
    expect(bound).not.toContain("total_for_cost_of_goods_sold");
  });

  it("does not bind gross profit, which cannot declare one fixed sign", () => {
    // The statement states it, and it would be the natural check on our own
    // arithmetic. A money field must declare one sign, and gross profit is only
    // positive while the business is profitable, so binding it would mean a
    // loss-making month failed the import.
    expect(sheet.fields.map((field) => field.sourceHeader)).not.toContain("gross_profit");
  });

  it("declares no counting control, which a rotated sheet cannot carry", () => {
    expect(contract.controls).toEqual([]);
    expect(projection.controlTotals).toEqual([]);
  });
});
