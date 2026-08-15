import { describe, expect, it } from "vitest";

import {
  explainRefusal,
  preflight,
  type PreflightInput,
  type PreflightRefusalCode,
} from "@/domain/tools/policy";

const NOW = new Date("2026-09-01T14:00:00.000Z");
const VERSION_ID = "f0000000-0000-4000-8000-000000000001";
const DIGEST = "a".repeat(64);

/** A state in which one organic action is cleared to run. */
function readyInput(overrides: Partial<PreflightInput> = {}): PreflightInput {
  return {
    now: NOW,
    actor: { isMember: true, canExecute: true },
    campaign: {
      state: "scheduled",
      currentBundleVersionId: VERSION_ID,
      currentBundleDigest: DIGEST,
      executionMode: "best_effort",
      blockedActionKeys: [],
    },
    action: {
      actionKey: "b0000000-0000-4000-8000-000000000001",
      bundleVersionId: VERSION_ID,
      channel: "instagram",
      requirement: "required",
      scheduledFor: "2026-09-01T14:00:00.000Z",
      spendCeilingMinor: null,
      spendCurrency: null,
    },
    approval: {
      exists: true,
      bundleVersionId: VERSION_ID,
      bundleDigest: DIGEST,
      expiresAt: "2026-09-30T00:00:00.000Z",
      revokedAt: null,
      attestationId: "d0000000-0000-4000-8000-000000000001",
      approvedActionKeys: ["b0000000-0000-4000-8000-000000000001"],
      policyVersionIds: ["p1"],
      capabilityGrantVersions: { instagram: "grant-1" },
      spendCeilingMinor: 150_000,
      spendCurrency: "AED",
    },
    capability: {
      granted: true,
      grantVersion: "grant-1",
      restrictionCodes: [],
      credentialHealthy: true,
      accountMapped: true,
      contractExpiresAt: "2027-01-01T00:00:00.000Z",
    },
    budget: { currency: "AED", reservedMinor: 0, settledMinor: 0 },
    currentPolicyVersionIds: ["p1"],
    trackingReady: true,
    consentWithdrawn: false,
    priorOutcome: { kind: "none" },
    ...overrides,
  };
}

function refusalsFor(overrides: Partial<PreflightInput>): readonly PreflightRefusalCode[] {
  const decision = preflight(readyInput(overrides));
  return decision.outcome === "refuse" ? decision.reasons : [];
}

describe("preflight", () => {
  it("lets a fully cleared organic action proceed with no reservation", () => {
    expect(preflight(readyInput())).toEqual({ outcome: "proceed", reservationMinor: null });
  });

  it("replays a completed action rather than re-checking policy on finished work", () => {
    const decision = preflight(
      readyInput({
        priorOutcome: { kind: "completed", receiptId: "receipt-1" },
        // Deliberately hostile surrounding state: none of it matters, because
        // the provider has already done the thing.
        approval: { ...readyInput().approval, exists: false },
        actor: { isMember: false, canExecute: false },
      }),
    );

    expect(decision).toEqual({ outcome: "already_completed", receiptId: "receipt-1" });
  });

  it("blocks everything on an unresolved ambiguous send", () => {
    const decision = preflight(
      readyInput({ priorOutcome: { kind: "unknown", invocationId: "inv-1" } }),
    );

    expect(decision).toEqual({ outcome: "provider_outcome_unknown", invocationId: "inv-1" });
  });
});

describe("authorization is re-evaluated at execution", () => {
  it("refuses when the actor left the organization since approving", () => {
    expect(refusalsFor({ actor: { isMember: false, canExecute: false } })).toContain(
      "membership_lost",
    );
  });

  it("refuses when the role no longer permits execution", () => {
    expect(refusalsFor({ actor: { isMember: true, canExecute: false } })).toContain(
      "role_not_permitted",
    );
  });

  it("reports a lost membership rather than also complaining about the role", () => {
    const reasons = refusalsFor({ actor: { isMember: false, canExecute: false } });

    expect(reasons).not.toContain("role_not_permitted");
  });
});

describe("approval binding", () => {
  it("refuses when no approval exists", () => {
    expect(refusalsFor({ approval: { ...readyInput().approval, exists: false } })).toEqual([
      "no_active_approval",
    ]);
  });

  it("refuses when the campaign moved to a newer version", () => {
    expect(
      refusalsFor({
        campaign: {
          ...readyInput().campaign,
          currentBundleVersionId: "f0000000-0000-4000-8000-000000000002",
        },
      }),
    ).toContain("approval_version_superseded");
  });

  it("refuses when the content changed under a matching version id", () => {
    expect(
      refusalsFor({ campaign: { ...readyInput().campaign, currentBundleDigest: "b".repeat(64) } }),
    ).toContain("approval_digest_mismatch");
  });

  it("refuses an expired approval, treating the exact instant as expired", () => {
    expect(
      refusalsFor({ approval: { ...readyInput().approval, expiresAt: NOW.toISOString() } }),
    ).toContain("approval_expired");
  });

  it("refuses a revoked approval", () => {
    expect(
      refusalsFor({
        approval: { ...readyInput().approval, revokedAt: "2026-08-30T00:00:00.000Z" },
      }),
    ).toContain("approval_revoked");
  });

  it("refuses when the visual-truth attestation is missing", () => {
    expect(refusalsFor({ approval: { ...readyInput().approval, attestationId: null } })).toContain(
      "attestation_missing",
    );
  });

  it("refuses an action that was not in what was approved", () => {
    expect(
      refusalsFor({ approval: { ...readyInput().approval, approvedActionKeys: ["other"] } }),
    ).toContain("action_not_approved");
  });

  it("refuses when policy changed after the approval was given", () => {
    expect(refusalsFor({ currentPolicyVersionIds: ["p2"] })).toContain("policy_version_changed");
  });

  it("accepts the same policy set listed in a different order", () => {
    const decision = preflight(
      readyInput({
        approval: { ...readyInput().approval, policyVersionIds: ["p1", "p2"] },
        currentPolicyVersionIds: ["p2", "p1"],
      }),
    );

    expect(decision.outcome).toBe("proceed");
  });
});

describe("capability and readiness", () => {
  it("refuses an ungranted channel without listing every other capability fault", () => {
    expect(refusalsFor({ capability: { ...readyInput().capability, granted: false } })).toEqual([
      "capability_not_granted",
    ]);
  });

  it("refuses when the grant changed after approval", () => {
    expect(
      refusalsFor({ capability: { ...readyInput().capability, grantVersion: "grant-2" } }),
    ).toContain("capability_grant_changed");
  });

  it("refuses when the provider currently restricts the action", () => {
    expect(
      refusalsFor({
        capability: { ...readyInput().capability, restrictionCodes: ["meta.publish_blocked"] },
      }),
    ).toContain("capability_restricted");
  });

  it("refuses unhealthy credentials and unmapped accounts", () => {
    expect(
      refusalsFor({ capability: { ...readyInput().capability, credentialHealthy: false } }),
    ).toContain("credential_unhealthy");
    expect(
      refusalsFor({ capability: { ...readyInput().capability, accountMapped: false } }),
    ).toContain("account_not_mapped");
  });

  it("refuses when the verified provider contract has lapsed", () => {
    expect(
      refusalsFor({
        capability: { ...readyInput().capability, contractExpiresAt: "2026-08-01T00:00:00.000Z" },
      }),
    ).toContain("provider_contract_expired");
  });

  it("refuses when measurement tracking is not ready", () => {
    expect(refusalsFor({ trackingReady: false })).toContain("tracking_not_ready");
  });

  it("lets withdrawn consent override an approval given earlier", () => {
    expect(refusalsFor({ consentWithdrawn: true })).toContain("consent_withdrawn");
  });
});

describe("schedule and execution mode", () => {
  it("refuses an action whose time has not come", () => {
    expect(
      refusalsFor({
        action: { ...readyInput().action, scheduledFor: "2026-09-02T14:00:00.000Z" },
      }),
    ).toContain("outside_schedule_window");
  });

  it("allows a small early dispatch inside the tolerance", () => {
    const decision = preflight(
      readyInput({
        action: { ...readyInput().action, scheduledFor: "2026-09-01T14:03:00.000Z" },
      }),
    );

    expect(decision.outcome).toBe("proceed");
  });

  it("refuses every action when all_channels_required has a blocked one", () => {
    expect(
      refusalsFor({
        campaign: {
          ...readyInput().campaign,
          executionMode: "all_channels_required",
          blockedActionKeys: ["another-action"],
        },
      }),
    ).toContain("required_action_blocked");
  });

  it("lets a ready action proceed in best_effort while another is blocked", () => {
    const decision = preflight(
      readyInput({
        campaign: {
          ...readyInput().campaign,
          executionMode: "best_effort",
          blockedActionKeys: ["another-action"],
        },
      }),
    );

    expect(decision.outcome).toBe("proceed");
  });

  it("refuses a cancelled campaign", () => {
    expect(refusalsFor({ campaign: { ...readyInput().campaign, state: "cancelled" } })).toContain(
      "campaign_cancelled",
    );
  });
});

describe("spend", () => {
  const paidAction = {
    ...readyInput().action,
    spendCeilingMinor: 100_000,
    spendCurrency: "AED",
  };

  it("reserves the full ceiling before anything is sent", () => {
    const decision = preflight(readyInput({ action: paidAction }));

    expect(decision).toEqual({ outcome: "proceed", reservationMinor: 100_000 });
  });

  it("counts money already reserved by an in-flight action", () => {
    expect(
      refusalsFor({
        action: paidAction,
        budget: { currency: "AED", reservedMinor: 100_000, settledMinor: 0 },
      }),
    ).toContain("spend_ceiling_exhausted");
  });

  it("counts money already settled", () => {
    expect(
      refusalsFor({
        action: paidAction,
        budget: { currency: "AED", reservedMinor: 0, settledMinor: 100_000 },
      }),
    ).toContain("spend_ceiling_exhausted");
  });

  it("allows a reservation that exactly fills the remaining ceiling", () => {
    const decision = preflight(
      readyInput({
        action: paidAction,
        budget: { currency: "AED", reservedMinor: 50_000, settledMinor: 0 },
      }),
    );

    expect(decision).toEqual({ outcome: "proceed", reservationMinor: 100_000 });
  });

  it("refuses rather than converting when currencies differ", () => {
    expect(refusalsFor({ action: { ...paidAction, spendCurrency: "USD" } })).toContain(
      "spend_currency_mismatch",
    );
  });

  it("refuses when the budget ledger is in a third currency", () => {
    expect(
      refusalsFor({
        action: paidAction,
        budget: { currency: "USD", reservedMinor: 0, settledMinor: 0 },
      }),
    ).toContain("spend_currency_mismatch");
  });

  it("refuses a paid action when the approval carries no ceiling at all", () => {
    expect(
      refusalsFor({
        action: paidAction,
        approval: { ...readyInput().approval, spendCeilingMinor: null },
      }),
    ).toContain("spend_ceiling_exhausted");
  });

  it("never reserves for an organic action", () => {
    const decision = preflight(readyInput());

    expect(decision).toMatchObject({ reservationMinor: null });
  });
});

describe("refusal reporting", () => {
  it("reports every independent reason at once, not one per attempt", () => {
    const reasons = refusalsFor({
      trackingReady: false,
      consentWithdrawn: true,
      currentPolicyVersionIds: ["p2"],
    });

    expect(reasons).toEqual(
      expect.arrayContaining(["tracking_not_ready", "consent_withdrawn", "policy_version_changed"]),
    );
  });

  it("never repeats a reason", () => {
    const reasons = refusalsFor({ approval: { ...readyInput().approval, exists: false } });

    expect(new Set(reasons).size).toBe(reasons.length);
  });

  it("explains a refusal in words an operator can act on", () => {
    const message = explainRefusal(["approval_expired", "credential_unhealthy"]);

    expect(message).toContain("the approval expired");
    expect(message).toContain("credentials need reconnecting");
  });
});
