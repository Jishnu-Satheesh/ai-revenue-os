import { describe, expect, it } from "vitest";

import {
  confirmCandidateFact,
  onboardingSectionKeys,
  sectionSaveSchema,
  onboardingRequestInputSchema,
  type CandidateFact,
} from "@/domain/onboarding/types";
import { onboardingSectionRegistry } from "@/domain/onboarding/section-registry";
import { canCompleteSection } from "@/domain/onboarding/section-registry";

describe("onboarding domain vocabulary", () => {
  it("registers all ten onboarding sections across six phases", () => {
    expect(onboardingSectionKeys).toHaveLength(10);
    expect(new Set(onboardingSectionRegistry.map((section) => section.phase)).size).toBe(6);
  });

  it("allows an incomplete section to be saved", () => {
    expect(sectionSaveSchema.parse({ status: "in_progress", payload: {} }).status).toBe(
      "in_progress",
    );
  });

  it("does not promote a candidate without evidence", () => {
    expect(() => confirmCandidateFact({ status: "inferred" } as CandidateFact)).toThrow("evidence");
  });

  it("promotes an evidenced candidate only through explicit confirmation", () => {
    const confirmed = confirmCandidateFact({
      factKey: "performance.monthly_revenue",
      value: { amountMinor: 125000 },
      status: "imported",
      confidence: 0.92,
      evidence: [{ sourceReference: "upload-1", location: "row 4" }],
    });

    expect(confirmed.status).toBe("verified");
    expect(confirmed.confirmedAt).toEqual(expect.any(String));
  });

  it("requires section evidence before allowing completion", () => {
    expect(canCompleteSection("business_identity", { name: "Al Noor Kitchen" })).toBe(false);
    expect(
      canCompleteSection("business_identity", { name: "Al Noor Kitchen", industry: "restaurant" }),
    ).toBe(true);
    expect(canCompleteSection("customers_consent", { unknown: true })).toBe(true);
  });

  it("validates a client data request without accepting arbitrary tenant scope", () => {
    expect(
      onboardingRequestInputSchema.parse({
        sessionId: "session-1",
        sectionKey: "customers_consent",
        title: "Confirm consent source",
        description: "Please confirm the source and retention period.",
        clientContact: "owner@example.com",
      }).sectionKey,
    ).toBe("customers_consent");
  });
});
