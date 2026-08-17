import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseCsvMetricMapping, projectCsvRows } from "@/domain/metrics/csv-projection";
import type { MetricValueKind } from "@/domain/metrics/types";

/**
 * Contract between the Restaurant Pack's documented vocabulary, the seed that
 * registers it, and the machinery that has to consume it.
 *
 * Cross-cutting rather than owned by the metrics module, because the point is
 * that the core never learns these names: they appear here as data being
 * asserted, not as a dependency of any core code path.
 */

const seedSql = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260810160000_restaurant_pack_metric_definitions.sql",
  ),
  "utf8",
);

const packDoc = readFileSync(
  resolve(process.cwd(), "industry-packs/restaurant/domain-model.md"),
  "utf8",
);

/**
 * The seed without its comments. The header explains at length why these keys
 * are not scoped to an organization, and an assertion that no such scoping
 * exists must not trip over the sentence saying so.
 */
const seedStatements = seedSql.replace(/^[ \t]*--.*$/gm, "");

/** Every pack key, with the value kind the seed registers it under. */
const PACK_KEYS: ReadonlyArray<readonly [string, MetricValueKind]> = [
  ["margin.contribution", "money"],
  ["margin.contribution_percent", "ratio"],
  ["order.average_value", "ratio"],
  ["listing.impressions", "count"],
  ["listing.conversion_rate", "ratio"],
  ["customer.repeat_rate", "ratio"],
  ["order.refund_rate", "ratio"],
  ["order.cancellation_rate", "ratio"],
  ["menu_item.stockout_rate", "ratio"],
  ["kitchen.preparation_time", "duration"],
  ["review.rating", "rating"],
  ["review.velocity", "count"],
  ["branch.footfall_proxy", "count"],
];

describe("restaurant pack metric vocabulary", () => {
  it("registers every documented key", () => {
    for (const [key] of PACK_KEYS) {
      expect(seedSql, `${key} is missing from the seed`).toContain(`'${key}'`);
      expect(packDoc, `${key} is missing from the pack domain model`).toContain(`\`${key}\``);
    }
  });

  it("leaves quantities the core already owns to the core", () => {
    // An order is the restaurant's word for a transaction, and revenue is core
    // outright. A second key for either would leave the economics ledger with
    // no defensible choice between them. See specs/012 section 2.
    expect(seedSql).not.toContain("'orders.count'");
    expect(seedSql).not.toContain("'revenue.gross'");
    expect(packDoc).toContain("transactions.count");
  });

  it("gives the percentile and rating metrics the metadata their kinds require", () => {
    // The schema enforces both, so a seed missing either would fail to apply.
    expect(seedSql).toMatch(/'kitchen\.preparation_time'[^\n]*'percentile', 0\.5/);
    expect(seedSql).toMatch(/'review\.rating'[^\n]*'weighted_mean', null, 1, 5/);
  });

  it("registers the pack subject kinds a playbook screens on", () => {
    expect(seedSql).toContain("'menu_item'");
    expect(seedSql).toContain("'marketplace_listing'");
    expect(seedSql).toContain("'restaurant'");
  });

  it("seeds as shared vocabulary rather than against one tenant", () => {
    // A pack key scoped to an organization would have to claim that tenant
    // invented it, and would collide when the pack seed landed properly.
    expect(seedStatements).toContain("'pack', 'restaurant'");
    expect(seedStatements).not.toMatch(/'organization'/);
    expect(seedStatements).not.toContain("organization_id");
  });

  it("projects the development organization's CSV mapping with no rejections", () => {
    // The mapping stored on the Al Noor Kitchen data source, against the value
    // kinds the seed registers. This is the join the pipeline actually depends
    // on: a mapping is only useful if its keys resolve and their kinds import.
    const mapping = parseCsvMetricMapping({
      period: "Date",
      channel: "Channel",
      "revenue.gross": "Gross Revenue",
      "transactions.count": "Orders",
      "listing.impressions": "Impressions",
      "margin.contribution": "Contribution Margin",
    });

    const result = projectCsvRows({
      rows: [
        {
          Date: "2026-08-01",
          Channel: "talabat",
          "Gross Revenue": "18450.75",
          Orders: "212",
          Impressions: "9840",
          "Contribution Margin": "5120.20",
        },
      ],
      mapping,
      grain: "day",
      timeZone: "Asia/Dubai",
      definitions: [
        { key: "revenue.gross", valueKind: "money" },
        { key: "transactions.count", valueKind: "count" },
        { key: "listing.impressions", valueKind: "count" },
        { key: "margin.contribution", valueKind: "money" },
      ],
      defaultCurrency: "AED",
    });

    expect(result.rejections).toEqual([]);
    expect(result.observations).toHaveLength(4);

    const revenue = result.observations.find((entry) => entry.metricKey === "revenue.gross");
    expect(revenue).toMatchObject({ numerator: 1_845_075, currency: "AED", channel: "talabat" });
    // Dubai runs four hours ahead, so 1 August local begins at 20:00Z on 31 July.
    expect(revenue?.periodStart.toISOString()).toBe("2026-07-31T20:00:00.000Z");
  });

  it("cannot import a rate, which is why none is mapped", () => {
    // Every ratio key above is deliberately absent from the data source
    // mapping: one column can only carry a quotient, and the projection
    // refuses it rather than storing the shape the schema forbids.
    const mapping = parseCsvMetricMapping({ period: "Date", "listing.conversion_rate": "CVR" });

    const result = projectCsvRows({
      rows: [{ Date: "2026-08-01", CVR: "0.021" }],
      mapping,
      grain: "day",
      timeZone: "Asia/Dubai",
      definitions: [{ key: "listing.conversion_rate", valueKind: "ratio" }],
      defaultCurrency: "AED",
    });

    expect(result.observations).toEqual([]);
    expect(result.rejections).toEqual([
      { row: 1, metricKey: "listing.conversion_rate", reason: "UNSUPPORTED_VALUE_KIND" },
    ]);
  });
});
