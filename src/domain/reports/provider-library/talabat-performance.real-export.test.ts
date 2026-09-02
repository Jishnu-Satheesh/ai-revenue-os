import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { talabatPerformance } from "@/domain/reports/provider-library/talabat-performance";
import { projectPeriodGrainMetrics } from "@/domain/reports/projection";
import { readCsvRows, readWorkbookRows } from "@/workflows/reports/project-report-package";

/**
 * The real drafting export, projected end to end through the approved
 * contract.
 *
 * This is the test that keeps the ragged rows honest. Eleven of the
 * fifty-nine days carry a second unavailability reason, which pushes every
 * later cell two places right; binding those rows by header name alone reads
 * the wrong cells silently and lands figures nobody can see are wrong. Every
 * expected total below was verified against the file by hand first, so a
 * regression here is a wrong reading of the export and not a wrong
 * expectation.
 */

const FIXTURE = "fixtures/raw/Talabat-Jan-Feb-2026-Performance-Report.xlsx";

/**
 * The client's real export is deliberately not in the repository -- `.gitignore`
 * excludes `fixtures/raw/` so customer data never lands in git. That makes this
 * suite conditional by design: it runs where the file has been placed and skips
 * where it has not, rather than failing seven times on a fresh clone and
 * teaching everyone to ignore a red suite.
 *
 * Skipping is honest here only because the assertions are not merely slow or
 * awkward to run -- they cannot be evaluated at all without the file. Anything
 * checkable from the scrubbed fixtures in `fixtures/providers/` belongs in a
 * suite that always runs.
 */
const hasRealExport = existsSync(FIXTURE);

const DECLARED_PERIOD = {
  periodStart: "2026-01-01",
  periodEnd: "2026-02-28",
};

async function projectFixture() {
  const sheets = await readWorkbookRows(readFileSync(FIXTURE));
  return projectPeriodGrainMetrics({
    contract: talabatPerformance.contract,
    // The declaration is a union; this slice projects the period-grain member.
    document: talabatPerformance.projection as Extract<
      typeof talabatPerformance.projection,
      { outputKind: "period_grain" }
    >,
    declaredCurrency: "AED",
    declaredPeriod: DECLARED_PERIOD,
    sheets,
  });
}

function sumByMetric(
  observations: ReturnType<typeof projectPeriodGrainMetrics>["observations"],
  metricKey: string,
): number {
  return observations
    .filter((observation) => observation.metricKey === metricKey)
    .reduce((total, observation) => total + Number(observation.valueNumerator), 0);
}

describe.skipIf(!hasRealExport)("talabat performance projection over the real export", () => {
  it("reads every funnel stage exactly as the provider states them", async () => {
    const result = await projectFixture();
    expect(sumByMetric(result.observations, "listing.impressions")).toBe(18_294);
    expect(sumByMetric(result.observations, "listing.menu_views")).toBe(949);
    expect(sumByMetric(result.observations, "listing.cart_additions")).toBe(59);
    expect(sumByMetric(result.observations, "listing.placed_orders")).toBe(24);
  });

  it("reads gross sales and the provider's own rejection loss in minor units", async () => {
    const result = await projectFixture();
    // AED 553.00 earned.
    expect(sumByMetric(result.observations, "revenue.gross")).toBe(55_300);
    // AED 357.00 lost to rejections, as the provider reports it.
    expect(sumByMetric(result.observations, "revenue.rejection_loss")).toBe(35_700);
  });

  it("keeps the customer-mix cross-check intact", async () => {
    const result = await projectFixture();
    const newOrders = sumByMetric(result.observations, "customer.new_order_count");
    const returningOrders = sumByMetric(result.observations, "customer.returning_order_count");
    expect(newOrders).toBe(25);
    expect(returningOrders).toBe(1);
    // The file's own arithmetic: new plus returning is the order count.
    expect(newOrders + returningOrders).toBe(sumByMetric(result.observations, "order.total_count"));
  });

  it("counts closed minutes against scheduled minutes", async () => {
    const result = await projectFixture();
    // The export reports fractional minutes per day, so window totals carry
    // the provider's own per-day rounding -- close to the round figures the
    // report reads as, never silently rounded again here.
    const closed = sumByMetric(result.observations, "operations.closed_minutes");
    const scheduled = sumByMetric(result.observations, "operations.scheduled_minutes");
    expect(Math.abs(closed - 34_217)).toBeLessThan(1);
    expect(Math.abs(scheduled - 70_799)).toBeLessThan(1);
    expect(closed / scheduled).toBeGreaterThan(0.482);
    expect(closed / scheduled).toBeLessThan(0.484);
  });

  it("attributes every closed day to exactly one declared reason", async () => {
    const result = await projectFixture();
    // The provider's own tally counts each closed day once, by its first
    // reason, so the two labels partition the window: 39 + 20 = 59.
    const checkIn = result.observations.filter(
      (observation) =>
        observation.metricKey === "operations.closed_days" &&
        observation.dimensions?.reason_code === "CHECK_IN_REQUIRED",
    );
    const unreachable = result.observations.filter(
      (observation) =>
        observation.metricKey === "operations.closed_days" &&
        observation.dimensions?.reason_code === "UNREACHABLE",
    );
    const total = (rows: typeof checkIn) =>
      rows.reduce((total, observation) => total + Number(observation.valueNumerator), 0);
    expect(total(checkIn)).toBe(39);
    expect(total(unreachable)).toBe(20);
    expect(total(checkIn) + total(unreachable)).toBe(59);
  });

  it("attributes every avoidable cancellation to its declared reason", async () => {
    const result = await projectFixture();
    // The provider tags every rejectable order with one reason. Across the
    // window every label present is ITEM_UNAVAILABLE (the import refuses a
    // label outside the declared vocabulary), so the attribution is counted
    // evidence and not prose.
    const reasonDays = result.observations.filter(
      (observation) =>
        observation.metricKey === "order.avoidable_cancellation_reason" &&
        observation.dimensions?.reason_code === "ITEM_UNAVAILABLE",
    );
    const total = reasonDays.reduce(
      (sum, observation) => sum + Number(observation.valueNumerator),
      0,
    );
    // Nine days across the window carry a declared cancel reason, all of them
    // ITEM_UNAVAILABLE. (This is a day count, distinct from the ten avoidable
    // *orders*; the projection counts the days the provider tagged a reason,
    // because reasons label days, and every one of those days reads as the
    // single label the import admitted.)
    expect(total).toBe(9);
  });

  it("keeps a day that genuinely traded zero distinct from an absent day", async () => {
    const result = await projectFixture();
    const grossDays = result.observations.filter(
      (observation) => observation.metricKey === "revenue.gross",
    );
    // Twenty reported days out of fifty-nine; among them the days that
    // genuinely sold nothing arrive as zero, which is a claim about the day
    // and not silence about it.
    expect(grossDays).toHaveLength(20);
    const zeroDays = grossDays.filter((day) => Number(day.valueNumerator) === 0);
    expect(zeroDays.length).toBeGreaterThan(0);
  });
});

/**
 * The real client file that was refused, projected end to end.
 *
 * This is the CSV export of the same report the suite above reads as XLSX.
 * The spreadsheet writes a day's second closure reason into an injected
 * cell; the CSV has nowhere to shift a cell to, so it joins both reasons
 * into one with a semicolon -- `CHECK_IN_REQUIRED;UNREACHABLE` -- and that
 * joined string is not a declared value on its own. Every expected total
 * below was verified against the file by hand first, so a regression here is
 * a wrong reading of the export and not a wrong expectation.
 */
const FIXTURE_CSV = "fixtures/raw/Talabat/Jan-2026.csv";
const hasCsvExport = existsSync(FIXTURE_CSV);

const CSV_DECLARED_PERIOD = {
  periodStart: "2026-01-01",
  periodEnd: "2026-01-31",
};

async function projectCsvFixture() {
  const rows = await readCsvRows(readFileSync(FIXTURE_CSV));
  return projectPeriodGrainMetrics({
    contract: talabatPerformance.contract,
    document: talabatPerformance.projection as Extract<
      typeof talabatPerformance.projection,
      { outputKind: "period_grain" }
    >,
    declaredCurrency: "AED",
    declaredPeriod: CSV_DECLARED_PERIOD,
    // The shape the projection workflow itself builds for a CSV package: one
    // sheet, named for the format rather than the report, because the
    // contract binds this sheet by position and never by name.
    sheets: [{ normalizedSheetName: "csv", rows }],
  });
}

describe.skipIf(!hasCsvExport)(
  "talabat performance projection over the real CSV export (Jan 2026)",
  () => {
    it("reads all 31 declared days of January", async () => {
      const rows = await readCsvRows(readFileSync(FIXTURE_CSV));
      expect(rows).toHaveLength(32); // header plus 31 data rows
      const dates = rows.slice(1).map((row) => row[0]);
      expect(dates[0]).toBe("2026-01-01");
      expect(dates[dates.length - 1]).toBe("2026-01-31");
    });

    it("attributes every closed day to exactly one declared reason, reading only the first of a joined cell", async () => {
      const result = await projectCsvFixture();
      // Every closed day in January carries two reasons in the same cell in
      // this export; only the first is counted, which is the rule this
      // output already follows for the spreadsheet.
      const checkIn = result.observations.filter(
        (observation) =>
          observation.metricKey === "operations.closed_days" &&
          observation.dimensions?.reason_code === "CHECK_IN_REQUIRED",
      );
      const unreachable = result.observations.filter(
        (observation) =>
          observation.metricKey === "operations.closed_days" &&
          observation.dimensions?.reason_code === "UNREACHABLE",
      );
      const total = (rows: typeof checkIn) =>
        rows.reduce((sum, observation) => sum + Number(observation.valueNumerator), 0);
      expect(total(checkIn)).toBe(28);
      expect(total(unreachable)).toBe(3);
      expect(total(checkIn) + total(unreachable)).toBe(31);
    });

    it("attributes every avoidable cancellation to its declared reason", async () => {
      const result = await projectCsvFixture();
      const reasonDays = result.observations.filter(
        (observation) =>
          observation.metricKey === "order.avoidable_cancellation_reason" &&
          observation.dimensions?.reason_code === "ITEM_UNAVAILABLE",
      );
      const total = reasonDays.reduce(
        (sum, observation) => sum + Number(observation.valueNumerator),
        0,
      );
      expect(total).toBe(7);
    });

    it("reads gross revenue in minor units", async () => {
      const result = await projectCsvFixture();
      // AED 438.00 across the declared window.
      expect(sumByMetric(result.observations, "revenue.gross")).toBe(43_800);
    });

    it("reads the total order count for the declared window", async () => {
      const result = await projectCsvFixture();
      expect(sumByMetric(result.observations, "order.total_count")).toBe(20);
    });
  },
);
