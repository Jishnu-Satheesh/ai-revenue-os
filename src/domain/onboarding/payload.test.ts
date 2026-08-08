import { describe, expect, it } from "vitest";

import { toSectionPayload } from "@/domain/onboarding/payload";

describe("toSectionPayload", () => {
  it("drops answers that were never given instead of storing empty values", () => {
    const payload = toSectionPayload("business_identity", {
      name: "  Al Noor Kitchen  ",
      legalIdentity: "   ",
      market: [],
      baseCurrency: "",
      valueProposition: null,
    });

    expect(payload).toEqual({ name: "Al Noor Kitchen" });
  });

  it("drops a structured control that was rendered but left untouched", () => {
    const payload = toSectionPayload("historical_performance", {
      metrics: ["revenue"],
      period: { start: "", end: "" },
    });

    expect(payload).toEqual({ metrics: ["revenue"] });
  });

  it("keeps a partially answered period so the operator does not lose input", () => {
    const payload = toSectionPayload("historical_performance", {
      period: { start: "2026-01", end: "" },
    });

    expect(payload.period).toEqual({ start: "2026-01", end: "" });
  });

  it("derives the conversion tracking boolean the readiness rubric consumes", () => {
    expect(
      toSectionPayload("channels_presence", { conversionTrackingStatus: "connected" })
        .conversionTracking,
    ).toBe(true);
    expect(
      toSectionPayload("channels_presence", { conversionTrackingStatus: "partial" })
        .conversionTracking,
    ).toBe(false);
  });

  it("treats only an explicit confirmation as consent", () => {
    for (const status of ["confirmed_by_client", "confirmed_by_operator"]) {
      expect(
        toSectionPayload("customers_consent", { consentStatus: status }).consentConfirmed,
      ).toBe(true);
    }
    for (const status of ["not_confirmed", "unknown", undefined]) {
      expect(
        toSectionPayload("customers_consent", { consentStatus: status }).consentConfirmed,
      ).toBe(false);
    }
  });

  it("always records the branchless decision, including when it is false", () => {
    expect(
      toSectionPayload("branches_operations", { branchlessConfirmed: false }).branchlessConfirmed,
    ).toBe(false);
    expect(toSectionPayload("branches_operations", {}).branchlessConfirmed).toBe(false);
  });

  it("preserves zero amounts, which a blank-value filter would discard", () => {
    expect(toSectionPayload("governance", { budgetMinor: 0 }).budgetMinor).toBe(0);
  });
});
