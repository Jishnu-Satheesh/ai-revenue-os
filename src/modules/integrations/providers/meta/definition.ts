import type { ProviderDefinition } from "@/domain/integrations/types";

export const META_BLOCKED_COPY =
  "Meta is not connectable yet. No action is proven against a controlled account.";

/**
 * Meta appears in the catalog so an operator can see what the release train
 * intends and exactly why none of it is available. Every entry below is
 * declared-blocked: the provider ships no adapter, declares no grantable
 * capability, and its rollout state is `disabled`, so no organization grant can
 * be derived for it by any path.
 *
 * Restriction codes and scopes are copied from `docs/provider-contracts/
 * meta-campaign-v1.md`, which records that no action, placement, or webhook is
 * verified. Scopes are listed to show what an eventual grant would request, not
 * to claim the application holds them.
 *
 * Unblocking happens in the later provider tasks, and only with controlled
 * account evidence. It is not a copy change here.
 */
export const META_BLOCKED_CAPABILITY_KEYS = Object.freeze([
  "publish_instagram",
  "publish_facebook",
  "advertise_meta_ads",
  "read_meta_metrics",
  "webhook_meta",
] as const);

const definition = {
  key: "meta",
  displayName: "Meta",
  adapterVersion: "unreleased",
  contractVersion: "meta-campaign-v1",
  rolloutState: "disabled",
  characters: Object.freeze(["publishing_destination", "advertising_account", "data_source"]),
  capabilities: Object.freeze([]),
  declaredBlockedCapabilities: Object.freeze([
    Object.freeze({
      key: "publish_instagram",
      character: "publishing_destination",
      effect: "public_write",
      adapterKind: "publish",
      requiredScopes: Object.freeze(["instagram_basic", "instagram_content_publish"]),
      restrictionCodes: Object.freeze([
        "meta.instagram_feed_image_blocked",
        "meta.instagram_image_story_blocked",
        "meta.unknown_outcome_reconciliation_unverified",
      ]),
      summary:
        "Instagram feed and story publishing have no proven size, copy, or hashtag limits, and no duplicate-safe recovery after a timed-out send.",
    }),
    Object.freeze({
      key: "publish_facebook",
      character: "publishing_destination",
      effect: "public_write",
      adapterKind: "publish",
      requiredScopes: Object.freeze(["pages_manage_posts", "pages_read_engagement"]),
      restrictionCodes: Object.freeze([
        "meta.facebook_feed_image_blocked",
        "meta.facebook_image_story_unproven",
        "meta.unknown_outcome_reconciliation_unverified",
      ]),
      summary:
        "Facebook Page image publishing has no proven limits, and no Page image Story action is documented at all.",
    }),
    Object.freeze({
      key: "advertise_meta_ads",
      character: "advertising_account",
      effect: "money_moving",
      adapterKind: "advertise",
      requiredScopes: Object.freeze(["ads_management", "ads_read"]),
      restrictionCodes: Object.freeze([
        "meta.ads_feed_image_blocked",
        "meta.ads_image_story_blocked",
        "meta.controlled_account_evidence_missing",
      ]),
      summary:
        "Advertising moves money and requires controlled-account evidence for eligibility, spend limits, and stopping conditions. None exists.",
    }),
    Object.freeze({
      key: "read_meta_metrics",
      character: "data_source",
      effect: "read",
      adapterKind: "read",
      requiredScopes: Object.freeze([
        "pages_read_engagement",
        "pages_read_user_engagement",
        "ads_read",
      ]),
      restrictionCodes: Object.freeze(["meta.controlled_account_evidence_missing"]),
      summary:
        "Metrics reads need a verified account mapping and exact field set from a controlled account before results could be trusted.",
    }),
    Object.freeze({
      key: "webhook_meta",
      character: "data_source",
      effect: "read",
      adapterKind: "webhook",
      requiredScopes: Object.freeze([]),
      restrictionCodes: Object.freeze(["meta.webhook_contract_unverified"]),
      summary:
        "No allowlisted event, signature contract, or replay contract is verified, so inbound webhooks cannot be accepted.",
    }),
  ]),
  syncIntervalMinutes: 60,
  staleAfterMinutes: 125,
  operatorCopy: META_BLOCKED_COPY,
} as const satisfies ProviderDefinition;

export const metaDefinition: ProviderDefinition = Object.freeze(definition);
