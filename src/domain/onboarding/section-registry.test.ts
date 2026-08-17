import { describe, expect, it } from "vitest";

import {
  canCompleteSection,
  evaluateSectionCompletion,
} from "@/domain/onboarding/section-registry";
import { toSectionPayload } from "@/domain/onboarding/payload";
import { emptyWeeklyHours } from "@/domain/onboarding/vocabularies";

describe("section completion requirements", () => {
  it("rejects free-text industries that are outside the taxonomy", () => {
    expect(
      canCompleteSection("business_identity", { name: "Al Noor", industry: "Restaurant" }),
    ).toBe(false);
    expect(
      canCompleteSection("business_identity", { name: "Al Noor", industry: "restaurant" }),
    ).toBe(true);
  });

  it("requires both a location answer and a usable weekly schedule", () => {
    const hours = emptyWeeklyHours().map((entry, index) =>
      index === 0 ? { ...entry, opensAt: "10:00", closesAt: "23:00" } : entry,
    );

    expect(canCompleteSection("branches_operations", { branches: ["Jumeirah"] })).toBe(false);
    expect(
      canCompleteSection("branches_operations", {
        branches: ["Jumeirah"],
        operatingHours: emptyWeeklyHours(),
      }),
    ).toBe(false);
    expect(
      canCompleteSection("branches_operations", {
        branchlessConfirmed: true,
        operatingHours: hours,
      }),
    ).toBe(true);
  });

  it("names every unmet requirement so the editor can explain a draft save", () => {
    const missing = evaluateSectionCompletion("governance", { goals: ["Grow repeat orders"] })
      .filter((requirement) => !requirement.satisfied)
      .map((requirement) => requirement.field);

    expect(missing).toEqual(["baseline", "budgetMinor", "budgetCurrency", "approvalMode"]);
  });

  it("treats a zero budget as answered but a non-integer amount as missing", () => {
    const base = {
      goals: ["Grow repeat orders"],
      baseline: "known",
      budgetCurrency: "AED",
      approvalMode: "approval_required",
    };

    expect(canCompleteSection("governance", { ...base, budgetMinor: 0 })).toBe(true);
    expect(canCompleteSection("governance", { ...base, budgetMinor: 12.5 })).toBe(false);
    expect(
      canCompleteSection("governance", { ...base, budgetCurrency: "XYZ", budgetMinor: 1 }),
    ).toBe(false);
  });

  it("accepts an explicit unknown consent answer but still requires segments", () => {
    expect(
      canCompleteSection(
        "customers_consent",
        toSectionPayload("customers_consent", { consentStatus: "unknown" }),
      ),
    ).toBe(false);
    expect(
      canCompleteSection(
        "customers_consent",
        toSectionPayload("customers_consent", {
          segments: ["repeat"],
          consentStatus: "unknown",
        }),
      ),
    ).toBe(true);
  });

  it("requires a valid closed measurement period for historical performance", () => {
    const base = { metrics: ["revenue"], currency: "AED" };

    expect(
      canCompleteSection("historical_performance", {
        ...base,
        period: { start: "2026-01", end: "2026-06" },
      }),
    ).toBe(true);
    expect(
      canCompleteSection("historical_performance", {
        ...base,
        period: { start: "2026-06", end: "2026-01" },
      }),
    ).toBe(false);
    expect(
      canCompleteSection("historical_performance", { ...base, period: { start: "2026-01" } }),
    ).toBe(false);
  });

  it("completes cost structure on one priced cost, not on all of them", () => {
    // Most operators cannot state their food cost on the first day. Requiring
    // every component would stall onboarding over exactly the gap the ledger
    // exists to report honestly.
    const priced = {
      componentKey: "commission",
      channel: null,
      percent: 28,
      amountMinor: null,
      confidence: "measured",
    };

    expect(
      canCompleteSection("cost_structure", {
        costRates: [priced],
        effectiveFrom: "2026-06-01",
      }),
    ).toBe(true);

    expect(canCompleteSection("cost_structure", { costRates: [priced] })).toBe(false);
    expect(canCompleteSection("cost_structure", { effectiveFrom: "2026-06-01" })).toBe(false);
  });

  it("treats a zero cost as answered and an opened but unfilled row as not", () => {
    const base = { effectiveFrom: "2026-06-01" };
    const row = { componentKey: "commission", channel: null, confidence: "assumed" };

    // Dine-in commission genuinely is zero, and saying so is what turns a
    // bounded margin into a real one.
    expect(
      canCompleteSection("cost_structure", {
        ...base,
        costRates: [{ ...row, percent: 0, amountMinor: null }],
      }),
    ).toBe(true);

    // A row the operator opened and left blank says nothing yet.
    expect(
      canCompleteSection("cost_structure", {
        ...base,
        costRates: [{ ...row, percent: null, amountMinor: null }],
      }),
    ).toBe(false);
  });

  it("rejects a cost that claims to be both a share and an amount", () => {
    expect(
      canCompleteSection("cost_structure", {
        effectiveFrom: "2026-06-01",
        costRates: [
          {
            componentKey: "commission",
            channel: null,
            percent: 28,
            amountMinor: 500,
            confidence: "measured",
          },
        ],
      }),
    ).toBe(false);
  });

  it("requires a real calendar date for the effective day", () => {
    const costRates = [
      {
        componentKey: "commission",
        channel: null,
        percent: 28,
        amountMinor: null,
        confidence: "measured",
      },
    ];

    expect(canCompleteSection("cost_structure", { costRates, effectiveFrom: "June 2026" })).toBe(
      false,
    );
    expect(canCompleteSection("cost_structure", { costRates, effectiveFrom: "2026-13-01" })).toBe(
      false,
    );
  });
});
