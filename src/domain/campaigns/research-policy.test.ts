import { describe, expect, it } from "vitest";

import {
  admitResearchRequest,
  type ResearchPolicy,
} from "@/domain/campaigns/research-policy";

const ORGANIZATION_ID = "fb430000-0000-4000-8000-000000000201";

function policy(overrides: Partial<ResearchPolicy> = {}): ResearchPolicy {
  return {
    schemaVersion: 1,
    organizationId: ORGANIZATION_ID,
    version: 3,
    enabled: true,
    timezone: "Asia/Dubai",
    evidenceQualificationRuleVersion: "evidence-qualification@2",
    evidenceMaxAgeDays: 30,
    cooldownSeconds: 3600,
    maxPendingProposals: 2,
    perRunAllowance: { amountMinor: 5000, currency: "AED" },
    windowAllowance: { amountMinor: 20000, currency: "AED" },
    windowDays: 30,
    ...overrides,
  };
}

const NOW = new Date("2026-09-13T12:00:00.000Z");

function admitted(overrides: Partial<Parameters<typeof admitResearchRequest>[0]> = {}) {
  return admitResearchRequest({
    policy: policy(),
    knownPolicyVersion: 3,
    triggerKind: "manual_request",
    requestedBudget: { amountMinor: 1000, currency: "AED" },
    pendingCount: 0,
    windowSpentMinor: 0,
    lastAdmittedAt: null,
    now: NOW,
    ...overrides,
  });
}

describe("research policy admission", () => {
  it("admits a request inside every limit and records the policy version", () => {
    const result = admitted();
    expect(result).toEqual({
      outcome: "admitted",
      policyVersion: 3,
      reservedBudget: { amountMinor: 1000, currency: "AED" },
    });
  });

  it("refuses as needs_setup when no policy exists", () => {
    expect(admitted({ policy: null })).toEqual({
      outcome: "refused",
      reasonCode: "needs_setup",
    });
  });

  it("refuses as needs_setup when the policy is switched off", () => {
    expect(admitted({ policy: policy({ enabled: false }) })).toEqual({
      outcome: "refused",
      reasonCode: "needs_setup",
    });
  });

  it("refuses a requester acting on an older policy version", () => {
    expect(admitted({ knownPolicyVersion: 2 })).toEqual({
      outcome: "refused",
      reasonCode: "stale_policy",
    });
  });

  it("admits when the requester never saw a policy version", () => {
    // Workers enqueue without a seen version; the current policy still binds.
    expect(admitted({ knownPolicyVersion: null }).outcome).toBe("admitted");
  });

  it("refuses inside the cooldown window, whatever the trigger kind", () => {
    for (const triggerKind of ["manual_request", "business_signal", "scheduled"] as const) {
      expect(
        admitted({
          triggerKind,
          lastAdmittedAt: "2026-09-13T11:30:00.000Z",
        }),
      ).toEqual({ outcome: "refused", reasonCode: "cooldown_active" });
    }
  });

  it("admits once the cooldown has fully elapsed", () => {
    expect(admitted({ lastAdmittedAt: "2026-09-13T11:00:00.000Z" }).outcome).toBe("admitted");
  });

  it("refuses when pending proposals reach the configured limit", () => {
    expect(admitted({ pendingCount: 2 })).toEqual({
      outcome: "refused",
      reasonCode: "pending_limit_reached",
    });
  });

  it("refuses a request above the per-run allowance", () => {
    expect(admitted({ requestedBudget: { amountMinor: 5001, currency: "AED" } })).toEqual({
      outcome: "refused",
      reasonCode: "allowance_exceeded",
    });
  });

  it("refuses when the window allowance cannot cover the request", () => {
    expect(admitted({ windowSpentMinor: 19500 })).toEqual({
      outcome: "refused",
      reasonCode: "allowance_exceeded",
    });
  });

  it("refuses a currency the policy never authorized", () => {
    expect(admitted({ requestedBudget: { amountMinor: 100, currency: "USD" } })).toEqual({
      outcome: "refused",
      reasonCode: "currency_mismatch",
    });
  });

  it("never reserves more than asked", () => {
    const result = admitted({ requestedBudget: { amountMinor: 4999, currency: "AED" } });
    expect(result).toEqual({
      outcome: "admitted",
      policyVersion: 3,
      reservedBudget: { amountMinor: 4999, currency: "AED" },
    });
  });
});
