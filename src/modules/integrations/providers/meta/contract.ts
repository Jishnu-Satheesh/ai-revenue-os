import { z } from "zod";

const contractStringSchema = z.string().trim().min(1);
const contractKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const nullablePositiveIntegerSchema = z.number().int().positive().nullable();

const placementSchema = z
  .object({
    key: contractKeySchema,
    verificationStatus: z.enum(["verified", "blocked"]),
    limits: z
      .object({
        maxPayloadBytes: nullablePositiveIntegerSchema,
        maxCopyCharacters: nullablePositiveIntegerSchema,
        maxHashtags: nullablePositiveIntegerSchema,
      })
      .strict(),
  })
  .strict();

const actionSchema = z
  .object({
    key: contractKeySchema,
    verificationStatus: z.literal("verified"),
    effect: z.enum(["read", "public_write", "money_moving", "operator_control"]),
    placementKey: contractKeySchema.nullable(),
    requiredScopes: z.array(contractStringSchema),
    idempotency: z
      .object({
        mode: z.enum(["provider_key", "provider_reference", "platform_ledger"]),
        providerKeyField: contractStringSchema.nullable(),
      })
      .strict(),
    reconciliationLookup: z
      .object({
        method: z.literal("GET"),
        pathTemplate: contractStringSchema,
        externalReferenceField: contractStringSchema,
      })
      .strict()
      .nullable(),
  })
  .strict();

const webhookSchema = z
  .object({
    events: z.array(
      z
        .object({
          key: contractKeySchema,
          sourceUrl: z.string().url(),
        })
        .strict(),
    ),
    signature: z
      .object({
        mechanism: contractStringSchema,
        headerName: contractStringSchema,
      })
      .strict(),
    replay: z
      .object({
        deduplicationKey: contractStringSchema,
        retentionSeconds: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

const restrictionSchema = z
  .object({
    code: contractKeySchema,
    actionKey: contractKeySchema,
    detail: contractStringSchema,
    sourceUrl: z.string().url(),
  })
  .strict();

function addUniqueIssue(
  values: readonly string[],
  path: readonly (string | number)[],
  context: z.RefinementCtx,
) {
  if (new Set(values).size !== values.length) {
    context.addIssue({
      code: "custom",
      message: "Contract values must be unique.",
      path: [...path],
    });
  }
}

export const verifiedProviderContractSchema = z
  .object({
    schemaVersion: z.literal(1),
    providerKey: contractKeySchema,
    contractVersion: contractKeySchema,
    apiVersion: contractStringSchema,
    verifiedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    officialSourceUrls: z.array(z.string().url()).min(1),
    accountPrerequisites: z.array(contractStringSchema).min(1),
    exactScopes: z.array(contractStringSchema),
    placements: z.array(placementSchema),
    actions: z.array(actionSchema),
    webhook: webhookSchema.nullable(),
    retryableStatuses: z.array(z.number().int().min(100).max(599)),
    knownRestrictions: z.array(restrictionSchema),
  })
  .strict()
  .superRefine((contract, context) => {
    if (new Date(contract.expiresAt) <= new Date(contract.verifiedAt)) {
      context.addIssue({
        code: "custom",
        message: "Contract expiry must be later than its verification time.",
        path: ["expiresAt"],
      });
    }

    addUniqueIssue(contract.officialSourceUrls, ["officialSourceUrls"], context);
    addUniqueIssue(contract.exactScopes, ["exactScopes"], context);
    addUniqueIssue(
      contract.placements.map(({ key }) => key),
      ["placements"],
      context,
    );
    addUniqueIssue(
      contract.actions.map(({ key }) => key),
      ["actions"],
      context,
    );
    addUniqueIssue(
      contract.knownRestrictions.map(({ code }) => code),
      ["knownRestrictions"],
      context,
    );
    addUniqueIssue(contract.retryableStatuses.map(String), ["retryableStatuses"], context);

    const exactScopes = new Set(contract.exactScopes);
    const placements = new Map(contract.placements.map((placement) => [placement.key, placement]));
    const officialSources = new Set(contract.officialSourceUrls);

    contract.actions.forEach((action, actionIndex) => {
      action.requiredScopes.forEach((scope) => {
        if (!exactScopes.has(scope)) {
          context.addIssue({
            code: "custom",
            message: `Action scope is absent from exactScopes: ${scope}`,
            path: ["actions", actionIndex, "requiredScopes"],
          });
        }
      });

      if (action.placementKey) {
        const placement = placements.get(action.placementKey);
        if (!placement || placement.verificationStatus !== "verified") {
          context.addIssue({
            code: "custom",
            message: "A verified action must reference a verified placement.",
            path: ["actions", actionIndex, "placementKey"],
          });
        }
      }

      if (
        (action.effect === "public_write" || action.effect === "money_moving") &&
        action.reconciliationLookup === null
      ) {
        context.addIssue({
          code: "custom",
          message: "A write action requires an unknown-outcome reconciliation lookup.",
          path: ["actions", actionIndex, "reconciliationLookup"],
        });
      }

      if (action.idempotency.mode === "provider_key" && !action.idempotency.providerKeyField) {
        context.addIssue({
          code: "custom",
          message: "Provider-key idempotency requires the documented provider key field.",
          path: ["actions", actionIndex, "idempotency", "providerKeyField"],
        });
      }
    });

    contract.webhook?.events.forEach((event, eventIndex) => {
      if (!officialSources.has(event.sourceUrl)) {
        context.addIssue({
          code: "custom",
          message: "Webhook event is not documented by an official contract source.",
          path: ["webhook", "events", eventIndex, "sourceUrl"],
        });
      }
    });

    contract.knownRestrictions.forEach((restriction, restrictionIndex) => {
      if (!officialSources.has(restriction.sourceUrl)) {
        context.addIssue({
          code: "custom",
          message: "Restriction source must be listed as an official contract source.",
          path: ["knownRestrictions", restrictionIndex, "sourceUrl"],
        });
      }
    });
  });

export type VerifiedProviderContract = z.infer<typeof verifiedProviderContractSchema>;
export type VerifiedProviderContractInput = z.input<typeof verifiedProviderContractSchema>;

export function parseVerifiedProviderContract(
  input: unknown,
  now: Date = new Date(),
): VerifiedProviderContract {
  const contract = verifiedProviderContractSchema.parse(input);

  if (new Date(contract.expiresAt) <= now) {
    throw new Error(`Provider contract verification is expired: ${contract.providerKey}`);
  }

  return contract;
}

const META_VERSIONING_SOURCE = "https://developers.facebook.com/docs/graph-api/guides/versioning/";
const META_INSTAGRAM_PUBLISHING_SOURCE =
  "https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/content-publishing/";
const META_PAGE_POSTS_SOURCE = "https://developers.facebook.com/docs/pages-api/posts/";
const META_MARKETING_SOURCE = "https://developers.facebook.com/docs/marketing-api/get-started/";

export const metaCampaignProviderContract = {
  schemaVersion: 1,
  providerKey: "meta_campaign",
  contractVersion: "meta_campaign_v1",
  apiVersion: "v26.0",
  verifiedAt: "2026-08-11T00:00:00.000Z",
  expiresAt: "2026-09-10T00:00:00.000Z",
  officialSourceUrls: [
    META_VERSIONING_SOURCE,
    META_INSTAGRAM_PUBLISHING_SOURCE,
    META_PAGE_POSTS_SOURCE,
    META_MARKETING_SOURCE,
  ],
  accountPrerequisites: [
    "A Meta developer app and Meta login flow are required.",
    "Instagram publishing requires an eligible Instagram professional account and the documented Page relationship for Facebook Login.",
    "Facebook Page publishing requires a Page access token and the documented Page tasks.",
    "Advertising requires an active ad account with billing configured.",
    "The controlled account, app review status, account mapping, credential health, and each requested capability must pass live verification before a grant can become available.",
  ],
  exactScopes: [
    "instagram_basic",
    "instagram_content_publish",
    "pages_manage_engagement",
    "pages_manage_posts",
    "pages_read_engagement",
    "pages_read_user_engagement",
    "ads_management",
    "ads_read",
  ],
  placements: [
    {
      key: "instagram.feed_image",
      verificationStatus: "blocked",
      limits: { maxPayloadBytes: null, maxCopyCharacters: null, maxHashtags: null },
    },
    {
      key: "instagram.image_story",
      verificationStatus: "blocked",
      limits: { maxPayloadBytes: null, maxCopyCharacters: null, maxHashtags: null },
    },
    {
      key: "facebook.feed_image",
      verificationStatus: "blocked",
      limits: { maxPayloadBytes: null, maxCopyCharacters: null, maxHashtags: null },
    },
    {
      key: "facebook.image_story",
      verificationStatus: "blocked",
      limits: { maxPayloadBytes: null, maxCopyCharacters: null, maxHashtags: null },
    },
    {
      key: "meta_ads.feed_image",
      verificationStatus: "blocked",
      limits: { maxPayloadBytes: null, maxCopyCharacters: null, maxHashtags: null },
    },
    {
      key: "meta_ads.image_story",
      verificationStatus: "blocked",
      limits: { maxPayloadBytes: null, maxCopyCharacters: null, maxHashtags: null },
    },
  ],
  actions: [],
  webhook: null,
  retryableStatuses: [],
  knownRestrictions: [
    {
      code: "meta.controlled_account_eligibility_unverified",
      actionKey: "meta.all_actions",
      detail:
        "No controlled-account or app-review evidence is checked in; no Meta action is executable.",
      sourceUrl: META_INSTAGRAM_PUBLISHING_SOURCE,
    },
    {
      code: "meta.instagram_feed_image_blocked",
      actionKey: "instagram.feed_image",
      detail:
        "The official publishing API exists, but controlled-account eligibility and complete live content-limit evidence are unverified.",
      sourceUrl: META_INSTAGRAM_PUBLISHING_SOURCE,
    },
    {
      code: "meta.instagram_image_story_blocked",
      actionKey: "instagram.image_story",
      detail:
        "The official API documents Stories, but controlled-account business eligibility and live publication evidence are unverified.",
      sourceUrl: META_INSTAGRAM_PUBLISHING_SOURCE,
    },
    {
      code: "meta.facebook_feed_image_blocked",
      actionKey: "facebook.feed_image",
      detail:
        "The official Page photo endpoint exists, but controlled Page task, token, and publication evidence are unverified.",
      sourceUrl: META_PAGE_POSTS_SOURCE,
    },
    {
      code: "meta.facebook_image_story_unproven",
      actionKey: "facebook.image_story",
      detail:
        "The consulted official Page posts contract does not prove a Facebook Page image Story publication action.",
      sourceUrl: META_PAGE_POSTS_SOURCE,
    },
    {
      code: "meta.ads_feed_image_blocked",
      actionKey: "meta_ads.feed_image",
      detail:
        "The official Marketing API requires an active ad account; controlled-account eligibility and bounded experiment fields are unverified.",
      sourceUrl: META_MARKETING_SOURCE,
    },
    {
      code: "meta.ads_image_story_blocked",
      actionKey: "meta_ads.image_story",
      detail:
        "Controlled-account eligibility, placement eligibility, and bounded experiment fields are unverified.",
      sourceUrl: META_MARKETING_SOURCE,
    },
    {
      code: "meta.webhook_contract_unverified",
      actionKey: "meta.webhook_intake",
      detail:
        "No allowlisted Meta webhook event, signature rule, replay rule, or controlled subscription evidence is verified in this contract.",
      sourceUrl: META_VERSIONING_SOURCE,
    },
    {
      code: "meta.unknown_outcome_reconciliation_unverified",
      actionKey: "meta.all_write_actions",
      detail:
        "No provider-supported idempotency key or complete post-send reconciliation lookup is verified, so writes remain blocked.",
      sourceUrl: META_VERSIONING_SOURCE,
    },
    {
      code: "meta.content_limits_unverified",
      actionKey: "meta.all_placements",
      detail:
        "The consulted sources do not prove a complete size, copy, and hashtag limit set for every planned placement; null limits are blockers, not unlimited values.",
      sourceUrl: META_INSTAGRAM_PUBLISHING_SOURCE,
    },
  ],
} satisfies VerifiedProviderContractInput;
