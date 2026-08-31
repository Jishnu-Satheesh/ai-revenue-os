import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { projectPeriodGrainMetrics } from "@/domain/reports/projection";
import { keetaBillingSummary } from "@/domain/reports/provider-library/keeta-billing-summary";
import { readWorkbookRows } from "@/workflows/reports/project-report-package";

/**
 * Runs against the client's own download, which is gitignored because it
 * carries real figures, so the suite skips where the file is absent rather than
 * failing on every clone. No figure from it is asserted here, only shape.
 *
 * What it is here to prove is the thing a synthetic fixture cannot: that the
 * costs Keeta writes as deductions land as costs. A sign that survives the
 * projector reversed is not a smaller number, it is a cost that subtracts from
 * the other costs when anything adds them up.
 */
const FIXTURE = resolve(process.cwd(), "fixtures/raw/Keeta/billing_report_2026_jan.xlsx");
const hasRealExport = existsSync(FIXTURE);

const DECLARED_PERIOD = { periodStart: "2026-01-01", periodEnd: "2026-01-31" };

async function projectFixture() {
  const sheets = await readWorkbookRows(readFileSync(FIXTURE));
  return projectPeriodGrainMetrics({
    contract: keetaBillingSummary.contract,
    document: keetaBillingSummary.projection as Extract<
      typeof keetaBillingSummary.projection,
      { outputKind: "period_grain" }
    >,
    declaredCurrency: "AED",
    declaredPeriod: DECLARED_PERIOD,
    sheets,
  });
}

describe.skipIf(!hasRealExport)("keeta billing projection over the real export", () => {
  it("projects exactly the three figures the mapping declares, and nothing else", async () => {
    const result = await projectFixture();
    expect([...new Set(result.observations.map((o) => o.metricKey))].sort()).toEqual([
      "cost.equipment_fee",
      "cost.payment_processing",
      "revenue.gross",
    ]);
  });

  it("records deductions as costs, never as negative costs", async () => {
    // The whole reason `signConvention` exists. Keeta writes both of these as
    // money it took away; `cost.commission` from the order export is written as
    // a positive. One metric family cannot hold both conventions and still sum.
    const result = await projectFixture();
    const costs = result.observations.filter((o) => o.metricKey.startsWith("cost."));

    expect(costs.length).toBeGreaterThan(0);
    expect(costs.every((o) => !o.valueNumerator.startsWith("-"))).toBe(true);
  });

  it("charges the equipment fee on some days and not others, as the provider does", async () => {
    // It arrives in lumps rather than daily. Every day carrying a zero is a day
    // Keeta charged nothing, which is a fact worth recording; a projector that
    // spread the month evenly would invent figures the provider never stated.
    const result = await projectFixture();
    const equipment = result.observations.filter((o) => o.metricKey === "cost.equipment_fee");

    expect(equipment.some((o) => o.valueNumerator === "0")).toBe(true);
    expect(equipment.some((o) => o.valueNumerator !== "0")).toBe(true);
  });

  it("keeps revenue on the side of the ledger it was always on", async () => {
    const result = await projectFixture();
    const revenue = result.observations.filter((o) => o.metricKey === "revenue.gross");

    expect(revenue.length).toBeGreaterThan(0);
    expect(revenue.every((o) => !o.valueNumerator.startsWith("-"))).toBe(true);
  });

  it("writes every cost as money in the declared currency, never as a bare number", async () => {
    const result = await projectFixture();
    const costs = result.observations.filter((o) => o.metricKey.startsWith("cost."));
    expect(costs.every((o) => o.valueKind === "money")).toBe(true);
    expect(costs.every((o) => o.currency === "AED")).toBe(true);
  });

  it("does not read the commission the order export already states per day", async () => {
    // The two files agree to the fils on this export. Projecting both would put
    // two sources under one metric for one period and hand an operator an
    // overlap to settle between a number and itself.
    const result = await projectFixture();
    expect(result.observations.some((o) => o.metricKey === "cost.commission")).toBe(false);
  });

  it("keeps every projected day inside the declared window", async () => {
    const result = await projectFixture();
    for (const observation of result.observations) {
      expect(observation.periodStart >= DECLARED_PERIOD.periodStart).toBe(true);
      expect(observation.periodStart <= DECLARED_PERIOD.periodEnd).toBe(true);
    }
  });
});
