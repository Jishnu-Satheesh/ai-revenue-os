import { describe, expect, it } from "vitest";

import { keetaRestaurantDaily } from "@/domain/reports/provider-library/keeta-restaurant-daily";

/**
 * What Keeta's restaurant export is allowed to record.
 *
 * The export carries thirty-two columns and the first version of this
 * definition read four of them, so the channel's Funnel and Orders chapters sat
 * empty over data that was already in the file. These assertions name the
 * outputs rather than their amounts: the fixture is private, and a test that
 * printed its figures would leak the client's trade into the repository.
 */

const sheet = keetaRestaurantDaily.contract.sheets[0]!;
const projection = keetaRestaurantDaily.projection as Extract<
  typeof keetaRestaurantDaily.projection,
  { outputKind: "period_grain" }
>;

const boundFields = new Set(sheet.fields.map((field) => field.canonicalField));
const metricKeys = new Set(projection.outputs.map((output) => output.metricKey));

describe("keeta restaurant daily definition", () => {
  it("records the funnel stages the export actually states", () => {
    // Keeta's own rate columns describe five stages: exposure, visit, cart,
    // checkout, order. The first three map one-to-one onto the registry's
    // vocabulary and are bound here.
    expect(metricKeys.has("listing.impressions")).toBe(true);
    expect(metricKeys.has("listing.menu_views")).toBe(true);
    expect(metricKeys.has("listing.cart_additions")).toBe(true);
  });

  it("leaves the last funnel stage unbound until columns can be added together", () => {
    // The honest source for "placed orders" is
    // `order_customers_in_restaurant` + `order_customers_out_of_restaurant`,
    // and a projection output reads exactly one column. `checkout_customers`
    // would fit the schema and overstate the stage, so nothing is bound.
    expect(metricKeys.has("listing.placed_orders")).toBe(false);
  });

  it("counts orders and cancellations without claiming fault", () => {
    expect(metricKeys.has("order.total_count")).toBe(true);
    expect(metricKeys.has("order.cancelled_count")).toBe(true);
    // Keeta never says whose fault a cancellation was. Calling these avoidable
    // would invent the one fact that turns a count into a reprimand.
    expect(metricKeys.has("order.avoidable_cancellation_count")).toBe(false);
    expect(metricKeys.has("revenue.rejection_loss")).toBe(false);
  });

  it("keeps the money columns bound for validation but unprojected", () => {
    // Commission and delivery fee are channel costs. They stay out of the
    // ledger until the economics vocabulary is separately approved.
    expect(metricKeys.has("cost.marketplace_commission")).toBe(false);
    expect(metricKeys.has("revenue.gross")).toBe(false);
  });

  it("projects only from fields its own contract binds", () => {
    for (const output of projection.outputs) {
      expect(boundFields.has(output.canonicalField)).toBe(true);
    }
  });

  it("treats a dash as absence on every count it reads", () => {
    // The export writes `-` on a day with no orders beside a column that still
    // counted the customers who looked. Absence and zero are different facts,
    // and only the contract can say which one a dash is.
    for (const field of sheet.fields) {
      if (field.canonicalField === "period_date") continue;
      expect(field.absentMarkers).toContain("-");
    }
  });
});
