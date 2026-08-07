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
