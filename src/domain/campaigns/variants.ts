import { z } from "zod";

import { campaignChannelSchema, campaignPlacementSchema } from "@/domain/campaigns/schemas";

/**
 * One creative instance produced under an approved generation policy.
 *
 * The shape is the first line of defence, and it works by omission. A variant
 * has no offer, no audience, no schedule, no spend ceiling and no generation
 * profile — not as optional fields that are then validated, but absent from the
 * type entirely. Those belong to the approved bundle, and a model that tries to
 * send one is refused at the parse boundary before any judgement is applied.
 *
 * What remains is exactly the pitch: which image, and the words around it.
 *
 * Channel and placement are present but are not the variant's to choose. They
 * name which approved action this instance is for, and the derivation check
 * refuses any pair the direction's approved actions do not already cover.
 */
export const campaignCreativeVariantSchema = z.strictObject({
  id: z.string().uuid(),
  directionId: z.string().uuid(),
  assetId: z.string().uuid(),
  channel: campaignChannelSchema,
  placement: campaignPlacementSchema,
  hook: z.string().trim().min(1).max(200),
  caption: z.string().trim().min(1).max(2_200),
  hashtags: z.array(
    z
      .string()
      .trim()
      .regex(/^#[^\s#]+$/, "A hashtag is # followed by no spaces."),
  ),
  callToAction: z.string().trim().min(1).max(120),
});

export type CampaignCreativeVariant = z.infer<typeof campaignCreativeVariantSchema>;

/**
 * Where a variant is in its life.
 *
 * `provider_outcome_unknown` is not a failure and must never be rendered as
 * one: it means a publish may have reached the provider, and the only safe
 * next step is reconciliation rather than a retry.
 */
export const CAMPAIGN_VARIANT_STATES = [
  "draft",
  "scheduled",
  "published",
  "paused_by_agent",
  "paused_by_operator",
  "failed",
  "provider_outcome_unknown",
] as const;

export type CampaignVariantState = (typeof CAMPAIGN_VARIANT_STATES)[number];
