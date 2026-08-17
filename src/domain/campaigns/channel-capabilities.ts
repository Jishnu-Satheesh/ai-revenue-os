import type { CampaignChannel } from "@/domain/campaigns/schemas";

/**
 * Which provider permission a campaign channel actually needs.
 *
 * A manifest talks about channels — "instagram", "facebook" — because that is
 * what an operator chose. The integration layer talks about capabilities,
 * because that is what an organization granted. Something has to join the two,
 * and it must be the same join everywhere: the Tool Gateway passes a capability
 * key when it claims an action, and the Studio passes one when it asks whether
 * that action could be claimed. If those two disagree, the screen shows a green
 * channel the gateway will refuse, which is worse than showing nothing.
 *
 * So the map lives here, once, in domain code that both sides import.
 */

export const CHANNEL_CAPABILITY_KEYS: Readonly<Record<CampaignChannel, string>> = Object.freeze({
  instagram: "publish_instagram",
  facebook: "publish_facebook",
});

export function capabilityKeyForChannel(channel: CampaignChannel): string {
  return CHANNEL_CAPABILITY_KEYS[channel];
}

/**
 * How each blocker reads to the person who has to clear it, and what clears it.
 *
 * Codes are stable and are what the gateway and the ledger record. Sentences
 * are for the screen. Keeping them apart means the wording can improve without
 * breaking anything that reads a code, and a code with no sentence yet still
 * renders as itself rather than as a blank card.
 */
export type ReadinessCode =
  | "capability_not_registered"
  | "capability_not_granted"
  | "capability_restricted"
  | "capability_grant_changed"
  | "credential_unhealthy"
  | "account_not_mapped";

type Explanation = { reason: string; recovery: string };

const EXPLANATIONS: Readonly<Record<ReadinessCode, Explanation>> = Object.freeze({
  capability_not_registered: {
    reason:
      "This deployment has no publishing capability for this channel yet, so there is nothing to grant.",
    recovery: "Nothing to do here — the channel becomes available when the integration ships.",
  },
  capability_not_granted: {
    reason: "Nobody has connected an account that is allowed to publish on this channel.",
    recovery: "Connect the channel",
  },
  capability_restricted: {
    reason: "The connected account carries restrictions that stop it publishing.",
    recovery: "Review the connection",
  },
  capability_grant_changed: {
    reason:
      "The permission changed after this version was approved, so the approval no longer covers what the account can now do.",
    recovery: "Re-approve this version",
  },
  credential_unhealthy: {
    reason: "The connection is expired, disconnected, or was never completed.",
    recovery: "Reconnect the account",
  },
  account_not_mapped: {
    reason: "The account is connected but no page or profile has been chosen to post to.",
    recovery: "Choose an account",
  },
});

export function explainReadinessCode(code: string): Explanation {
  return (
    EXPLANATIONS[code as ReadinessCode] ?? {
      reason: `This channel is blocked by ${code}.`,
      recovery: "Review the connection",
    }
  );
}
