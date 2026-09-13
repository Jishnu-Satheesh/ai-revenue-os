import { z } from "zod";

/**
 * The spending policy that gates campaign research (C03, D06).
 *
 * Research costs real money through qualified external providers, so every run
 * is admitted against explicit organization configuration before any billable
 * work happens. There are no defaults anywhere in this file: a missing policy
 * is "needs setup", never an implied permission to spend.
 *
 * Research allowance is distinct from media spend and from the creative
 * preparation allowance. Keeping the three purses separate is what stops a
 * research run from ever authorizing money it was never given.
 */

export const RESEARCH_POLICY_SCHEMA_VERSION = 1;

const uuidSchema = z.string().uuid();

export const researchTriggerKindSchema = z.enum([
  "business_signal",
  "scheduled",
  "manual_request",
  "next_test",
]);
export type ResearchTriggerKind = z.infer<typeof researchTriggerKindSchema>;

/** Money in integer minor units with its currency, per repository convention. */
export const researchMoneySchema = z.strictObject({
  amountMinor: z.number().int().nonnegative().max(9_000_000_000_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/, "Currency must be an ISO 4217 code."),
});
export type ResearchMoney = z.infer<typeof researchMoneySchema>;

export const researchPolicySchema = z.strictObject({
  schemaVersion: z.literal(RESEARCH_POLICY_SCHEMA_VERSION),
  organizationId: uuidSchema,
  /** Immutable version. Every run records the version that admitted it. */
  version: z.number().int().positive(),
  enabled: z.boolean(),
  timezone: z.string().trim().min(1).max(80),
  evidenceQualificationRuleVersion: z.string().trim().min(1).max(80),
  /** Seconds between admitted runs. Zero means no cooldown, stated openly. */
  cooldownSeconds: z.number().int().nonnegative().max(31_536_000),
  maxPendingProposals: z.number().int().positive().max(100),
  /** The most one run may reserve. An upper bound, not a target. */
  perRunAllowance: researchMoneySchema,
  /** The most all runs may reserve inside one window. */
  windowAllowance: researchMoneySchema,
  windowDays: z.number().int().positive().max(365),
});
export type ResearchPolicy = z.infer<typeof researchPolicySchema>;

export const researchAdmissionRefusalSchema = z.enum([
  "needs_setup",
  "stale_policy",
  "cooldown_active",
  "pending_limit_reached",
  "allowance_exceeded",
  "currency_mismatch",
]);
export type ResearchAdmissionRefusal = z.infer<typeof researchAdmissionRefusalSchema>;

export type ResearchAdmission =
  | {
      outcome: "admitted";
      /** The exact policy version that admitted this run. Recorded on the run. */
      policyVersion: number;
      /** What this run may spend. Never more than asked, never more than allowed. */
      reservedBudget: ResearchMoney;
    }
  | { outcome: "refused"; reasonCode: ResearchAdmissionRefusal };

/**
 * Admits one research request against a policy and current ledger state.
 *
 * Pure by design: the service supplies the ledger numbers, this function only
 * judges. A manual request goes through exactly the same checks as any other
 * trigger kind — there is no fast lane that skips the purse.
 */
export function admitResearchRequest(input: {
  policy: ResearchPolicy | null;
  /** The policy version the requester saw, if they saw one. */
  knownPolicyVersion: number | null;
  triggerKind: ResearchTriggerKind;
  /** What this run wants to be allowed to spend. */
  requestedBudget: ResearchMoney;
  /** Runs admitted but not yet finished or cancelled. */
  pendingCount: number;
  /** Already reserved inside the current window, same currency as the policy. */
  windowSpentMinor: number;
  /** When the last run was admitted, if any. */
  lastAdmittedAt: string | null;
  now: Date;
}): ResearchAdmission {
  const {
    policy,
    knownPolicyVersion,
    requestedBudget,
    pendingCount,
    windowSpentMinor,
    lastAdmittedAt,
    now,
  } = input;

  // No policy, or a switched-off one, is not a zero budget. It is the absence
  // of permission, reported as setup work rather than as a spending decision.
  if (policy === null || !policy.enabled) {
    return { outcome: "refused", reasonCode: "needs_setup" };
  }

  // A requester acting on yesterday's policy must re-read it, not spend under
  // it. This is checked before money because the limits themselves may have
  // moved.
  if (knownPolicyVersion !== null && knownPolicyVersion !== policy.version) {
    return { outcome: "refused", reasonCode: "stale_policy" };
  }

  if (requestedBudget.currency !== policy.perRunAllowance.currency) {
    return { outcome: "refused", reasonCode: "currency_mismatch" };
  }

  if (lastAdmittedAt !== null && policy.cooldownSeconds > 0) {
    const elapsedSeconds = (now.getTime() - Date.parse(lastAdmittedAt)) / 1000;
    if (elapsedSeconds < policy.cooldownSeconds) {
      return { outcome: "refused", reasonCode: "cooldown_active" };
    }
  }

  if (pendingCount >= policy.maxPendingProposals) {
    return { outcome: "refused", reasonCode: "pending_limit_reached" };
  }

  if (requestedBudget.amountMinor > policy.perRunAllowance.amountMinor) {
    return { outcome: "refused", reasonCode: "allowance_exceeded" };
  }

  if (windowSpentMinor + requestedBudget.amountMinor > policy.windowAllowance.amountMinor) {
    return { outcome: "refused", reasonCode: "allowance_exceeded" };
  }

  return {
    outcome: "admitted",
    policyVersion: policy.version,
    reservedBudget: { ...requestedBudget },
  };
}
