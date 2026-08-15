/**
 * Campaign Bundle errors.
 *
 * These signal a broken contract rather than an absent input. A missing piece
 * of evidence is an ordinary outcome that moves a campaign to `needs_data`; a
 * manifest that cannot be canonicalised, a spend ceiling in a second currency,
 * or an approval reused across versions is a defect, and papering over any of
 * them would make the approval record untrue.
 */
export type CampaignErrorCode =
  | "CAMPAIGN_MANIFEST_NOT_CANONICAL"
  | "CAMPAIGN_CURRENCY_MISMATCH"
  | "CAMPAIGN_DIRECTIONS_INCOMPLETE"
  | "CAMPAIGN_DIRECTION_NOT_DISTINCT"
  | "CAMPAIGN_PROFILE_VIOLATION"
  | "CAMPAIGN_HASHTAG_LIMITS_UNVERIFIED"
  | "CAMPAIGN_ACTION_UNSUPPORTED"
  | "CAMPAIGN_TRANSITION_NOT_ALLOWED"
  | "CAMPAIGN_VERSION_NOT_COMPARABLE";

export class CampaignError extends Error {
  readonly name = "CampaignError";

  constructor(
    readonly code: CampaignErrorCode,
    message: string,
  ) {
    super(message);
  }
}
