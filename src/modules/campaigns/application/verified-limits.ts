import { getMetaCampaignProviderContract } from "@/modules/integrations/providers/meta/contract";
import type { ChannelContentLimits } from "@/domain/campaigns/content-policy";
import type { CampaignChannel } from "@/domain/campaigns/schemas";

/**
 * Hashtag and copy limits as the *verified* provider contract states them.
 *
 * Where the contract proves no limit, the channel is absent here and content
 * policy blocks it rather than checking against a guess. Today the checked-in
 * Meta contract proves none, so both channels block — which is the honest state
 * until controlled-account evidence lands.
 *
 * Shared rather than duplicated because an operator editing a caption by hand
 * and a model writing one must be held to identical limits. Two copies of this
 * would eventually disagree, and the direction they would disagree in is the
 * one where a person can type something a model is not allowed to produce.
 */
export function verifiedChannelLimits(): Partial<Record<CampaignChannel, ChannelContentLimits>> {
  const limits: Partial<Record<CampaignChannel, ChannelContentLimits>> = {};

  for (const placement of getMetaCampaignProviderContract().placements) {
    if (placement.verificationStatus !== "verified") continue;
    const channel = placement.key.split(".")[0];
    if (channel !== "instagram" && channel !== "facebook") continue;
    limits[channel] = {
      maxHashtags: placement.limits.maxHashtags,
      maxCopyCharacters: placement.limits.maxCopyCharacters,
    };
  }

  return limits;
}
