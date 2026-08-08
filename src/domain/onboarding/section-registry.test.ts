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
});
