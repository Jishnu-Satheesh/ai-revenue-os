import { CampaignError } from "@/domain/campaigns/errors";

/**
 * Where a campaign is, and where it may go next.
 *
 * Approval is never a field on this state. It is derived from an approval row
 * that names an exact bundle version and digest, so a campaign cannot be edited
 * into looking approved, and a revision cannot inherit the previous version's
 * permission. `approved` here means "an approval row currently covers the
 * version this campaign is on" — nothing more.
 */
export const CAMPAIGN_STATES = [
  "draft",
  "needs_data",
  "ready_for_review",
  "approved",
  "scheduled",
  "executing",
  "measuring",
  "completed",
  "partially_completed",
  "blocked",
  "cancelled",
  "failed",
] as const;

export type CampaignState = (typeof CAMPAIGN_STATES)[number];

/**
 * The only transitions that exist.
 *
 * Two rules are load-bearing and easy to lose. Nothing returns to `draft`
 * except through a revision, which creates a new version rather than reopening
 * an approved one. And `cancelled` fences future work without erasing what
 * already happened, so it is reachable from every live state but leads nowhere.
 */
const TRANSITIONS: Readonly<Record<CampaignState, readonly CampaignState[]>> = {
  draft: ["needs_data", "ready_for_review", "blocked", "cancelled", "failed"],
  // A readiness gap is recoverable: the evidence arrives, and review resumes.
  needs_data: ["draft", "ready_for_review", "blocked", "cancelled"],
  ready_for_review: ["draft", "needs_data", "approved", "blocked", "cancelled"],
  // Approval does not schedule anything by itself; scheduling is a separate
  // act inside the approved envelope, and policy may still block it.
  approved: ["scheduled", "blocked", "cancelled"],
  scheduled: ["executing", "blocked", "cancelled", "failed"],
  executing: ["measuring", "partially_completed", "blocked", "cancelled", "failed"],
  // Some actions published and some did not. Measurement still runs, because
  // what happened is true whether or not the whole plan succeeded.
  partially_completed: ["measuring", "cancelled"],
  measuring: ["completed", "failed", "cancelled"],
  completed: [],
  blocked: ["draft", "needs_data", "ready_for_review", "cancelled"],
  cancelled: [],
  failed: ["cancelled"],
};

export function allowedTransitions(from: CampaignState): readonly CampaignState[] {
  return TRANSITIONS[from];
}

export function canTransition(from: CampaignState, to: CampaignState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: CampaignState, to: CampaignState): void {
  if (!canTransition(from, to)) {
    throw new CampaignError(
      "CAMPAIGN_TRANSITION_NOT_ALLOWED",
      `A campaign cannot move from ${from} to ${to}.`,
    );
  }
}

/** A state from which nothing further happens. */
export function isTerminal(state: CampaignState): boolean {
  return TRANSITIONS[state].length === 0;
}

export type ApprovalRow = {
  bundleVersionId: string;
  bundleDigest: string;
  expiresAt: string;
  revokedAt: string | null;
};

export type ApprovalSubject = {
  bundleVersionId: string;
  bundleDigest: string;
};

export type ApprovalStatus =
  | { isApproved: true }
  | {
      isApproved: false;
      reason: "no_approval" | "version_superseded" | "digest_mismatch" | "expired" | "revoked";
    };

/**
 * Whether an approval actually authorizes the version in front of us.
 *
 * Both the version id and the digest must match. The id alone would let a row
 * edited in place keep its approval; the digest alone would let a different
 * version with identical content borrow one. Requiring both means an approval
 * covers exactly the thing the operator read.
 */
export function approvalStatus(
  approval: ApprovalRow | null,
  subject: ApprovalSubject,
  now: Date,
): ApprovalStatus {
  if (!approval) return { isApproved: false, reason: "no_approval" };
  if (approval.revokedAt !== null) return { isApproved: false, reason: "revoked" };
  if (approval.bundleVersionId !== subject.bundleVersionId) {
    return { isApproved: false, reason: "version_superseded" };
  }
  if (approval.bundleDigest !== subject.bundleDigest) {
    return { isApproved: false, reason: "digest_mismatch" };
  }
  // The write path refuses at `expires_at <= now()`, so the boundary instant is
  // expired here too. A UI that disagreed with the database would offer an
  // action the database was already refusing.
  if (new Date(approval.expiresAt).getTime() <= now.getTime()) {
    return { isApproved: false, reason: "expired" };
  }
  return { isApproved: true };
}
