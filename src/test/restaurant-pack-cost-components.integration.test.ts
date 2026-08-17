import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { computeDerivedMargin } from "@/domain/economics/margin";
import type { CostComponentDefinition, CostComputationKind } from "@/domain/economics/types";

/**
 * Contract between the Restaurant Pack's cost vocabulary, the seed that
 * registers it, and the margin arithmetic that consumes it.
 */

const seedSql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260811100000_restaurant_pack_cost_components.sql"),
  "utf8",
);
const seedStatements = seedSql.replace(/^[ \t]*--.*$/gm, "");
const packDoc = readFileSync(
  resolve(process.cwd(), "industry-packs/restaurant/domain-model.md"),
  "utf8",
);

const PACK_COMPONENTS: ReadonlyArray<readonly [string, CostComputationKind]> = [
  ["commission", "rate_of_revenue"],
  ["food_cost", "rate_of_revenue"],
  ["packaging", "per_unit"],
  ["promotion_funding", "sourced"],
  ["delivery_cost", "fixed_amount"],
  ["payment_fees", "rate_of_revenue"],
];

describe("restaurant pack cost vocabulary", () => {
  it("registers every documented component with its computation kind", () => {
    for (const [key, kind] of PACK_COMPONENTS) {
      expect(seedStatements, `${key} is missing from the seed`).toContain(`'${key}'`);
      expect(seedStatements).toMatch(new RegExp(`'${key}'[^\\n]*'${kind}'`));
      expect(packDoc, `${key} is missing from the pack domain model`).toContain(`\`${key}\``);
    }
  });

  it("ships no rate, because a rate is one tenant's fact", () => {
    // A commission percentage belongs to a business, not to a pack. Seeding one
    // would put a number nobody confirmed behind a margin.
    expect(seedStatements).not.toContain("cost_component_rates");
    expect(seedStatements).not.toContain("rate_of_revenue,");
    expect(seedStatements).not.toMatch(/0\.\d+/);
  });

  it("seeds shared vocabulary rather than scoping to a tenant", () => {
    expect(seedStatements).toContain("'pack', 'restaurant'");
    expect(seedStatements).not.toContain("organization_id");
  });

  it("leaves every component applicable to every channel", () => {
    // Naming marketplaces here would guess which ones a tenant sells through.
    // A channel with no such cost carries a measured zero rate instead.
    expect(seedStatements).not.toContain("applies_to_channels");
    expect(packDoc).toContain("measured zero rate");
  });

  it("grades a margin indicative until the tenant supplies its rates", () => {
    // The state every restaurant starts in: vocabulary registered, nothing
    // priced. The ledger must refuse a figure rather than treat unknown costs
    // as zero and report the whole of revenue as margin.
    const definitions: CostComponentDefinition[] = PACK_COMPONENTS.map(([key, kind]) => ({
      key,
      label: key,
      computationKind: kind,
      appliesToChannels: null,
    }));

    const outcome = computeDerivedMargin({
      basis: {
        grossRevenueMinor: 1_000_000,
        transactionCount: 200,
        unitCount: 500,
        currency: "AED",
      },
      channel: "talabat",
      definitions,
      rates: [],
    });

    expect(outcome.grade).toBe("indicative");
    if (outcome.grade !== "indicative") return;
    expect(outcome.missingComponentKeys).toHaveLength(PACK_COMPONENTS.length);
    // The ceiling is the whole of revenue, which is exactly what an unpriced
    // business can honestly say and no more.
    expect(outcome.atMostMinor).toBe(1_000_000);
  });
});
