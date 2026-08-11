import { describe, expect, it } from "vitest";

import { calculateReadiness } from "@/domain/onboarding/readiness";

describe("calculateReadiness", () => {
  it("blocks outbound retention when customer consent is not confirmed", () => {
    const result = calculateReadiness({
      sections: {
        customers_consent: {
          status: "complete",
          payload: { consentConfirmed: false },
        },
      },
    });

    expect(result.capabilities.outbound_retention.available).toBe(false);
    expect(result.criticalBlockers).toContain("customer_consent_required");
    expect(result.reasons.some((reason) => reason.id === "customer_consent_required")).toBe(true);
  });

  it("still blocks outbound retention when an unrelated section is complete", () => {
    // The regression guard. Capabilities were once read out of the requirement
    // list by position, so inserting a section above consent silently handed
    // outbound retention to whatever landed on that index. specs/008 requires
    // missing consent to block it, and nothing else may satisfy that.
    const result = calculateReadiness({
      sections: {
        customers_consent: { status: "complete", payload: { consentConfirmed: false } },
        cost_structure: { status: "complete", payload: {} },
        brand_assets: { status: "complete", payload: {} },
      },
    });

    expect(result.capabilities.outbound_retention.available).toBe(false);
    expect(result.capabilityScores.customer_consent).toBe(0);
  });

  it("scores governance from the governance section and nothing else", () => {
    const result = calculateReadiness({
      sections: {
        governance: { status: "complete", payload: {} },
        brand_assets: { status: "not_started", payload: {} },
      },
    });

    expect(result.capabilityScores.governance).toBe(100);
  });

  it("blocks autonomous ad optimisation when conversion tracking is missing", () => {
    const result = calculateReadiness({
      sections: {
        channels_presence: {
          status: "complete",
          payload: { conversionTracking: false },
        },
      },
    });

    expect(result.capabilities.autonomous_ad_optimization.available).toBe(false);
    expect(result.criticalBlockers).toContain("conversion_tracking_required");
  });

  it("names a real requirement for every capability", () => {
    // A capability wired to an id that does not exist would read as permanently
    // unavailable with no blocker explaining why, which is the silent version
    // of the same bug.
    const result = calculateReadiness({ sections: {} });
    const ids = new Set(result.reasons.map((reason) => reason.id));

    for (const capability of Object.values(result.capabilities))
      for (const reasonId of capability.reasonIds) expect(ids.has(reasonId)).toBe(true);

    // Every capability score must move for some achievable requirement.
    expect(Object.values(result.capabilityScores).every((score) => score === 0)).toBe(true);
  });

  it("returns a deterministic explainable score", () => {
    const input = {
      sections: {
        business_identity: {
          status: "complete" as const,
          payload: { name: "Al Noor Kitchen", industry: "restaurant" },
        },
      },
    };

    expect(calculateReadiness(input)).toEqual(calculateReadiness(input));
    expect(calculateReadiness(input).overallScore).toBeGreaterThanOrEqual(0);
    expect(calculateReadiness(input).overallScore).toBeLessThanOrEqual(100);
    expect(calculateReadiness(input).rubricVersion).toBe("v1");
  });
});
