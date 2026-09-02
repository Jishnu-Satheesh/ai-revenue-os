import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { projectPeriodGrainMetrics } from "@/domain/reports/projection";
import { keetaOrders } from "@/domain/reports/provider-library/keeta-orders";
import { readWorkbookRows } from "@/workflows/reports/project-report-package";

/**
 * Runs against the client's own download, which is gitignored because it
 * carries real figures, so the suite skips where the file is absent rather than
 * failing on every clone.
 *
 * What it is here to prove is the thing a synthetic fixture cannot: that an
 * order-level export collapses into daily figures correctly. Every other
 * governed report on this platform states one row per day already, so this is
 * the first time the projector's per-period accumulation carries the weight.
 */
const FIXTURE = resolve(process.cwd(), "fixtures/raw/Keeta/Keeta-Jan-Feb-2026-Orders-Data.xlsx");
const hasRealExport = existsSync(FIXTURE);

const DECLARED_PERIOD = { periodStart: "2026-01-01", periodEnd: "2026-02-28" };

async function projectFixture() {
  const sheets = await readWorkbookRows(readFileSync(FIXTURE));
  return projectPeriodGrainMetrics({
    contract: keetaOrders.contract,
    document: keetaOrders.projection as Extract<
      typeof keetaOrders.projection,
      { outputKind: "period_grain" }
    >,
    declaredCurrency: "AED",
    declaredPeriod: DECLARED_PERIOD,
    sheets,
  });
}

describe.skipIf(!hasRealExport)("keeta orders projection over the real export", () => {
  it("collapses many orders a day into one figure a day, and says how many made it", async () => {
    const result = await projectFixture();
    const commission = result.observations.filter((o) => o.metricKey === "cost.commission");

    // Fewer days than orders is the whole point: 156 order rows, and every day
    // that traded carries one commission figure built from that day's orders.
    expect(commission.length).toBeGreaterThan(0);
    expect(commission.length).toBeLessThan(156);
    // A day built from several orders records how many contributed, so nobody
    // has to guess whether a figure is one order or twenty.
    expect(commission.some((o) => o.contributorCount > 1)).toBe(true);
    expect(commission.every((o) => o.contributorCount >= 1)).toBe(true);
  });

  it("keeps every projected day inside the declared window", async () => {
    const result = await projectFixture();
    for (const observation of result.observations) {
      expect(observation.periodStart >= DECLARED_PERIOD.periodStart).toBe(true);
      expect(observation.periodStart <= DECLARED_PERIOD.periodEnd).toBe(true);
    }
  });

  it("writes commission as money in the declared currency, never as a bare number", async () => {
    const result = await projectFixture();
    const commission = result.observations.filter((o) => o.metricKey === "cost.commission");
    expect(commission.every((o) => o.valueKind === "money")).toBe(true);
    expect(commission.every((o) => o.currency === "AED")).toBe(true);
  });

  it("projects exactly the figures the mapping declares, and nothing else", async () => {
    const result = await projectFixture();
    expect([...new Set(result.observations.map((o) => o.metricKey))].sort()).toEqual([
      "cost.commission",
      "operations.preparation_minutes",
      "order.cancellation_attribution_count",
      "promotion.provider_subsidy",
    ]);
  });

  it("reads the cancellation party out of the sentences the provider writes", async () => {
    // The point of the label map, against the real column rather than a
    // fixture written to suit it: every attribution in the client's export
    // resolves to a declared code, and none arrives as prose.
    const result = await projectFixture();
    const attributions = result.observations.filter(
      (o) => o.metricKey === "order.cancellation_attribution_count",
    );

    expect(attributions.length).toBeGreaterThan(0);
    expect(attributions.every((o) => o.valueKind === "count")).toBe(true);
    expect(attributions.every((o) => o.currency === null)).toBe(true);
    for (const observation of attributions) {
      expect(Object.keys(observation.dimensions ?? {})).toEqual(["cancelled_by"]);
      expect(["MERCHANT", "CUSTOMER_SERVICE", "PLATFORM"]).toContain(
        observation.dimensions?.cancelled_by,
      );
    }
  });

  it("attributes no party to the orders the provider completed", async () => {
    // Keeta writes `-` on every order it did not cancel. Counting that marker
    // would invent a fourth party responsible for most of the export.
    const result = await projectFixture();
    const attributed = result.observations
      .filter((o) => o.metricKey === "order.cancellation_attribution_count")
      .reduce((total, o) => total + Number(o.valueNumerator), 0);
    const commissionDays = result.observations.filter(
      (o) => o.metricKey === "cost.commission",
    ).length;

    // Far fewer attributions than the export has orders, and no day carries an
    // attribution for a party the map does not name.
    expect(attributed).toBeGreaterThan(0);
    expect(attributed).toBeLessThan(156);
    expect(commissionDays).toBeGreaterThan(0);
  });

  it("does not read the promotion expense the restaurant export already states", async () => {
    // Two sources under one metric for one period is an overlap decision an
    // operator would have to settle, for a figure that would not change.
    const result = await projectFixture();
    expect(result.observations.some((o) => o.metricKey === "promotion.funding")).toBe(false);
  });
});
