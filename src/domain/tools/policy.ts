/**
 * What has to be true before a campaign action may touch the outside world.
 *
 * This is the deterministic half of the Tool Gateway: given a complete picture
 * of the current state, it decides whether one action may proceed and, if not,
 * says exactly why. No model participates. Nothing here calls a provider or
 * reserves anything — it returns a decision, and the database acts on it inside
 * a transaction that locks the rows this decision was made from.
 *
 * Every refusal carries a stable code rather than a sentence, because these
 * codes are read by the UI, by operators, and by later reconciliation, and a
 * message that changes wording would break all three.
 */

export type PreflightRefusalCode =
  | "membership_lost"
  | "role_not_permitted"
  | "no_active_approval"
  | "approval_version_superseded"
  | "approval_digest_mismatch"
  | "approval_expired"
  | "approval_revoked"
  | "attestation_missing"
  | "action_not_approved"
  | "outside_schedule_window"
  | "campaign_cancelled"
  | "policy_version_changed"
  | "capability_not_granted"
  | "capability_grant_changed"
  | "capability_restricted"
  | "credential_unhealthy"
  | "account_not_mapped"
  | "provider_contract_expired"
  | "tracking_not_ready"
  | "consent_withdrawn"
  | "required_action_blocked"
  | "spend_currency_mismatch"
  | "spend_ceiling_exhausted"
  | "provider_outcome_unknown";

export type PreflightDecision =
  | { outcome: "proceed"; reservationMinor: number | null }
  | { outcome: "refuse"; reasons: readonly PreflightRefusalCode[] }
  | { outcome: "already_completed"; receiptId: string }
  | { outcome: "provider_outcome_unknown"; invocationId: string };

export type ApprovalFacts = {
  exists: boolean;
  bundleVersionId: string;
  bundleDigest: string;
  expiresAt: string;
  revokedAt: string | null;
  attestationId: string | null;
  approvedActionKeys: readonly string[];
  policyVersionIds: readonly string[];
  capabilityGrantVersions: Readonly<Record<string, string>>;
  spendCeilingMinor: number | null;
  spendCurrency: string | null;
};

export type CapabilityFacts = {
  granted: boolean;
  /** Monotonic. A change means the grant is not the one that was approved. */
  grantVersion: string;
  restrictionCodes: readonly string[];
  credentialHealthy: boolean;
  accountMapped: boolean;
  contractExpiresAt: string | null;
};

export type ActionFacts = {
  actionKey: string;
  bundleVersionId: string;
  channel: string;
  requirement: "required" | "optional";
  scheduledFor: string;
  spendCeilingMinor: number | null;
  spendCurrency: string | null;
};

export type CampaignFacts = {
  state: string;
  currentBundleVersionId: string;
  currentBundleDigest: string;
  executionMode: "best_effort" | "all_channels_required";
  /** Action keys currently blocked for any reason, used by execution mode. */
  blockedActionKeys: readonly string[];
};

export type BudgetFacts = {
  currency: string | null;
  reservedMinor: number;
  settledMinor: number;
};

export type PriorOutcomeFacts =
  | { kind: "none" }
  | { kind: "completed"; receiptId: string }
  | { kind: "unknown"; invocationId: string };

export type PreflightInput = {
  now: Date;
  actor: { isMember: boolean; canExecute: boolean };
  campaign: CampaignFacts;
  action: ActionFacts;
  approval: ApprovalFacts;
  capability: CapabilityFacts;
  budget: BudgetFacts;
  /** Policy versions currently in force, compared with what approval assumed. */
  currentPolicyVersionIds: readonly string[];
  trackingReady: boolean;
  consentWithdrawn: boolean;
  priorOutcome: PriorOutcomeFacts;
  /** How early an action may fire before its scheduled time, in minutes. */
  scheduleToleranceMinutes?: number;
};

const DEFAULT_TOLERANCE_MINUTES = 5;

export function preflight(input: PreflightInput): PreflightDecision {
  // A completed action replays its receipt. This comes first: re-checking policy
  // on work that already happened could refuse something the provider has
  // already done, and the record must never disagree with reality.
  if (input.priorOutcome.kind === "completed") {
    return { outcome: "already_completed", receiptId: input.priorOutcome.receiptId };
  }

  // An ambiguous previous send blocks everything until reconciliation resolves
  // it. Retrying here is how a campaign posts twice or spends twice.
  if (input.priorOutcome.kind === "unknown") {
    return {
      outcome: "provider_outcome_unknown",
      invocationId: input.priorOutcome.invocationId,
    };
  }

  const reasons: PreflightRefusalCode[] = [];

  reasons.push(...checkActor(input));
  reasons.push(...checkCampaign(input));
  reasons.push(...checkApproval(input));
  reasons.push(...checkCapability(input));
  reasons.push(...checkReadiness(input));

  const spend = checkSpend(input);
  reasons.push(...spend.reasons);

  return reasons.length > 0
    ? { outcome: "refuse", reasons: dedupe(reasons) }
    : { outcome: "proceed", reservationMinor: spend.reservationMinor };
}

/**
 * Authorization is re-evaluated at execution, not inherited from approval.
 *
 * Someone who approved a campaign last week may have left the organization
 * since. The approval stays in the record as a true statement about the past;
 * it does not keep authorizing work in the present.
 */
function checkActor(input: PreflightInput): PreflightRefusalCode[] {
  const reasons: PreflightRefusalCode[] = [];
  if (!input.actor.isMember) reasons.push("membership_lost");
  else if (!input.actor.canExecute) reasons.push("role_not_permitted");
  return reasons;
}

function checkCampaign(input: PreflightInput): PreflightRefusalCode[] {
  const reasons: PreflightRefusalCode[] = [];
  if (input.campaign.state === "cancelled") reasons.push("campaign_cancelled");

  // `all_channels_required` means exactly that: if any action is blocked, none
  // may run. `best_effort` lets ready actions proceed, which is the whole
  // difference an operator agreed to at approval time.
  if (
    input.campaign.executionMode === "all_channels_required" &&
    input.campaign.blockedActionKeys.length > 0
  ) {
    reasons.push("required_action_blocked");
  }

  const scheduled = new Date(input.action.scheduledFor).getTime();
  const tolerance = (input.scheduleToleranceMinutes ?? DEFAULT_TOLERANCE_MINUTES) * 60_000;
  if (input.now.getTime() + tolerance < scheduled) reasons.push("outside_schedule_window");

  return reasons;
}

function checkApproval(input: PreflightInput): PreflightRefusalCode[] {
  const reasons: PreflightRefusalCode[] = [];
  const approval = input.approval;

  if (!approval.exists) return ["no_active_approval"];
  if (approval.revokedAt !== null) reasons.push("approval_revoked");

  // Both must match. The version id alone would let a row edited in place keep
  // its approval; the digest alone would let a different version with identical
  // content borrow one.
  if (approval.bundleVersionId !== input.campaign.currentBundleVersionId) {
    reasons.push("approval_version_superseded");
  }
  if (approval.bundleDigest !== input.campaign.currentBundleDigest) {
    reasons.push("approval_digest_mismatch");
  }

  // The write path refuses at `expires_at <= now()`, so the boundary instant is
  // expired here too rather than one second more generous.
  if (new Date(approval.expiresAt).getTime() <= input.now.getTime()) {
    reasons.push("approval_expired");
  }

  if (!approval.attestationId) reasons.push("attestation_missing");
  if (!approval.approvedActionKeys.includes(input.action.actionKey)) {
    reasons.push("action_not_approved");
  }

  // Policy that changed since approval takes precedence over the approval. An
  // operator agreed under the old rules; the new rules are the ones in force.
  if (!sameSet(approval.policyVersionIds, input.currentPolicyVersionIds)) {
    reasons.push("policy_version_changed");
  }

  return reasons;
}

function checkCapability(input: PreflightInput): PreflightRefusalCode[] {
  const reasons: PreflightRefusalCode[] = [];
  const capability = input.capability;

  if (!capability.granted) return ["capability_not_granted"];

  const approvedGrantVersion = input.approval.capabilityGrantVersions[input.action.channel];
  if (approvedGrantVersion && approvedGrantVersion !== capability.grantVersion) {
    reasons.push("capability_grant_changed");
  }

  if (capability.restrictionCodes.length > 0) reasons.push("capability_restricted");
  if (!capability.credentialHealthy) reasons.push("credential_unhealthy");
  if (!capability.accountMapped) reasons.push("account_not_mapped");

  // A contract whose verification lapsed is not evidence any more. Acting on it
  // would mean calling a provider against rules nobody has checked recently.
  if (
    capability.contractExpiresAt &&
    new Date(capability.contractExpiresAt).getTime() <= input.now.getTime()
  ) {
    reasons.push("provider_contract_expired");
  }

  return reasons;
}

function checkReadiness(input: PreflightInput): PreflightRefusalCode[] {
  const reasons: PreflightRefusalCode[] = [];
  if (!input.trackingReady) reasons.push("tracking_not_ready");
  // Consent withdrawn after approval overrides the approval, always.
  if (input.consentWithdrawn) reasons.push("consent_withdrawn");
  return reasons;
}

/**
 * Paid actions reserve their full ceiling before anything is sent.
 *
 * Reserving after the call would let two concurrent claims each see budget
 * available and both spend it. Reserving the whole ceiling rather than an
 * estimate means the worst case is already accounted for; the reservation is
 * reconciled down to actual spend afterwards.
 */
function checkSpend(input: PreflightInput): {
  reasons: PreflightRefusalCode[];
  reservationMinor: number | null;
} {
  const action = input.action;
  if (action.spendCeilingMinor === null) return { reasons: [], reservationMinor: null };

  const reasons: PreflightRefusalCode[] = [];
  const approval = input.approval;

  // Money never crosses currencies silently. A converted ceiling would be a
  // number nobody approved, at a rate nobody recorded.
  if (
    action.spendCurrency !== approval.spendCurrency ||
    (input.budget.currency !== null && input.budget.currency !== action.spendCurrency)
  ) {
    reasons.push("spend_currency_mismatch");
    return { reasons, reservationMinor: null };
  }

  const ceiling = approval.spendCeilingMinor;
  if (ceiling === null) {
    reasons.push("spend_ceiling_exhausted");
    return { reasons, reservationMinor: null };
  }

  // Already-reserved and already-settled both count against the ceiling: money
  // committed to an in-flight action is not available to this one.
  const committed = input.budget.reservedMinor + input.budget.settledMinor;
  if (committed + action.spendCeilingMinor > ceiling) {
    reasons.push("spend_ceiling_exhausted");
    return { reasons, reservationMinor: null };
  }

  return { reasons, reservationMinor: action.spendCeilingMinor };
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const known = new Set(left);
  return right.every((entry) => known.has(entry));
}

function dedupe(codes: readonly PreflightRefusalCode[]): readonly PreflightRefusalCode[] {
  return [...new Set(codes)];
}

/**
 * What an operator is told, derived from stable codes.
 *
 * Built here rather than at the call site so the same refusal reads the same
 * way in the Studio, in a Telegram review, and in an operations runbook.
 */
export function explainRefusal(codes: readonly PreflightRefusalCode[]): string {
  const explanations: Record<PreflightRefusalCode, string> = {
    membership_lost: "the person who approved this no longer belongs to the organization",
    role_not_permitted: "their role no longer permits execution",
    no_active_approval: "there is no approval covering this campaign",
    approval_version_superseded: "the campaign changed after it was approved",
    approval_digest_mismatch: "the proposal changed after it was approved",
    approval_expired: "the approval expired",
    approval_revoked: "the approval was revoked",
    attestation_missing: "the visual-truth attestation is missing",
    action_not_approved: "this action was not part of what was approved",
    outside_schedule_window: "it is not yet time for this action",
    campaign_cancelled: "the campaign was cancelled",
    policy_version_changed: "policy changed since the approval was given",
    capability_not_granted: "this channel is not connected for this organization",
    capability_grant_changed: "the channel's permissions changed after approval",
    capability_restricted: "the provider currently restricts this action",
    credential_unhealthy: "the channel's credentials need reconnecting",
    account_not_mapped: "no provider account is mapped for this channel",
    provider_contract_expired: "the verified provider contract needs rechecking",
    tracking_not_ready: "the measurement tracking this campaign needs is not ready",
    consent_withdrawn: "consent for this audience was withdrawn",
    required_action_blocked:
      "another required channel is blocked and this campaign runs all-or-nothing",
    spend_currency_mismatch: "the approved spend is in a different currency",
    spend_ceiling_exhausted: "the approved spend ceiling is already committed",
    provider_outcome_unknown: "a previous send has an unknown outcome and must be reconciled first",
  };

  const listed = codes.map((code) => explanations[code]);
  return `This action did not run because ${listed.join(", and ")}.`;
}
