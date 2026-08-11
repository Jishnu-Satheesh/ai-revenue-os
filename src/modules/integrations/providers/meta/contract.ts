import { z } from "zod";

const contractStringSchema = z.string().trim().min(1);
const contractKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const nullablePositiveIntegerSchema = z.number().int().positive().nullable();

const evidenceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: contractKeySchema,
      kind: z.literal("official_source"),
      sourceUrl: z.string().url(),
      checkedAt: z.string().datetime({ offset: true }),
      detail: contractStringSchema,
    })
    .strict(),
  z
    .object({
      id: contractKeySchema,
      kind: z.literal("controlled_account_check"),
      sourceUrl: z.string().url(),
      checkedAt: z.string().datetime({ offset: true }),
      detail: contractStringSchema,
      artifactReference: contractStringSchema,
      artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
]);

const accountPrerequisiteSchema = z
  .object({
    key: contractKeySchema,
    detail: contractStringSchema,
    verificationStatus: z.enum(["verified", "blocked"]),
    evidenceIds: z.array(contractKeySchema),
  })
  .strict();

const placementSchema = z
  .object({
    key: contractKeySchema,
    verificationStatus: z.enum(["verified", "blocked"]),
    evidenceIds: z.array(contractKeySchema),
    limits: z
      .object({
        maxPayloadBytes: nullablePositiveIntegerSchema,
        maxCopyCharacters: nullablePositiveIntegerSchema,
        maxHashtags: nullablePositiveIntegerSchema,
      })
      .strict(),
  })
  .strict();

const reconciliationLookupInputSchema = z.discriminatedUnion(
  "source",
  [
    z
      .object({
        key: contractKeySchema,
        source: z.literal("preflight"),
        valueReference: z.string().regex(/^preflight\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/, {
          message: "Preflight reconciliation references must use the preflight.* namespace.",
        }),
      })
      .strict(),
    z
      .object({
        key: contractKeySchema,
        source: z.literal("request"),
        valueReference: z.string().regex(/^request\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/, {
          message: "Request reconciliation references must use the request.* namespace.",
        }),
      })
      .strict(),
  ],
  "Reconciliation input source must be preflight or request.",
);

const actionSchema = z
  .object({
    key: contractKeySchema,
    verificationStatus: z.literal("verified"),
    effect: z.enum(["read", "public_write", "money_moving", "operator_control"]),
    placementKey: contractKeySchema.nullable(),
    requiredScopes: z.array(contractStringSchema),
    sourceEvidenceIds: z.array(contractKeySchema).min(1),
    controlledAccountEvidenceIds: z.array(contractKeySchema).min(1),
    requiredPrerequisiteKeys: z.array(contractKeySchema).min(1),
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
        lookupInputs: z.array(reconciliationLookupInputSchema).min(1),
        resultIdentityField: contractStringSchema,
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
    evidence: z.array(evidenceSchema).min(1),
    accountPrerequisites: z.array(accountPrerequisiteSchema).min(1),
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
    addUniqueIssue(
      contract.evidence.map(({ id }) => id),
      ["evidence"],
      context,
    );
    addUniqueIssue(
      contract.accountPrerequisites.map(({ key }) => key),
      ["accountPrerequisites"],
      context,
    );
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
    const evidenceById = new Map(contract.evidence.map((evidence) => [evidence.id, evidence]));
    const prerequisitesByKey = new Map(
      contract.accountPrerequisites.map((prerequisite) => [prerequisite.key, prerequisite]),
    );

    contract.evidence.forEach((evidence, evidenceIndex) => {
      if (!officialSources.has(evidence.sourceUrl)) {
        context.addIssue({
          code: "custom",
          message: "Evidence must cite an official source listed by the contract.",
          path: ["evidence", evidenceIndex, "sourceUrl"],
        });
      }

      if (new Date(evidence.checkedAt) > new Date(contract.verifiedAt)) {
        context.addIssue({
          code: "custom",
          message: "Evidence cannot be checked after the contract verification time.",
          path: ["evidence", evidenceIndex, "checkedAt"],
        });
      }
    });

    contract.accountPrerequisites.forEach((prerequisite, prerequisiteIndex) => {
      addUniqueIssue(
        prerequisite.evidenceIds,
        ["accountPrerequisites", prerequisiteIndex, "evidenceIds"],
        context,
      );

      const linkedEvidence = prerequisite.evidenceIds.map((id) => evidenceById.get(id));
      if (linkedEvidence.some((evidence) => !evidence)) {
        context.addIssue({
          code: "custom",
          message: "Account prerequisite cites unknown evidence.",
          path: ["accountPrerequisites", prerequisiteIndex, "evidenceIds"],
        });
      }

      if (prerequisite.verificationStatus === "verified") {
        if (linkedEvidence.length === 0) {
          context.addIssue({
            code: "custom",
            message: "A verified account prerequisite requires checked evidence.",
            path: ["accountPrerequisites", prerequisiteIndex, "evidenceIds"],
          });
        } else if (
          !linkedEvidence.some((evidence) => evidence?.kind === "controlled_account_check")
        ) {
          context.addIssue({
            code: "custom",
            message: "A verified account prerequisite requires controlled-account evidence.",
            path: ["accountPrerequisites", prerequisiteIndex, "evidenceIds"],
          });
        }
      }
    });

    contract.placements.forEach((placement, placementIndex) => {
      addUniqueIssue(placement.evidenceIds, ["placements", placementIndex, "evidenceIds"], context);

      const linkedEvidence = placement.evidenceIds.map((id) => evidenceById.get(id));
      if (linkedEvidence.some((evidence) => !evidence)) {
        context.addIssue({
          code: "custom",
          message: "Placement cites unknown evidence.",
          path: ["placements", placementIndex, "evidenceIds"],
        });
      }

      if (placement.verificationStatus === "verified") {
        if (
          linkedEvidence.length === 0 ||
          !linkedEvidence.some((evidence) => evidence?.kind === "official_source")
        ) {
          context.addIssue({
            code: "custom",
            message: "A verified placement requires official-source evidence.",
            path: ["placements", placementIndex, "evidenceIds"],
          });
        }

        if (Object.values(placement.limits).some((limit) => limit === null)) {
          context.addIssue({
            code: "custom",
            message: "A verified placement requires non-null provider contract limits.",
            path: ["placements", placementIndex, "limits"],
          });
        }
      }
    });

    contract.actions.forEach((action, actionIndex) => {
      addUniqueIssue(
        action.sourceEvidenceIds,
        ["actions", actionIndex, "sourceEvidenceIds"],
        context,
      );
      addUniqueIssue(
        action.controlledAccountEvidenceIds,
        ["actions", actionIndex, "controlledAccountEvidenceIds"],
        context,
      );
      addUniqueIssue(
        action.requiredPrerequisiteKeys,
        ["actions", actionIndex, "requiredPrerequisiteKeys"],
        context,
      );

      const sourceEvidence = action.sourceEvidenceIds.map((id) => evidenceById.get(id));
      if (
        sourceEvidence.some((evidence) => !evidence) ||
        !sourceEvidence.some((evidence) => evidence?.kind === "official_source")
      ) {
        context.addIssue({
          code: "custom",
          message: "A verified action requires official-source evidence.",
          path: ["actions", actionIndex, "sourceEvidenceIds"],
        });
      }

      const controlledEvidence = action.controlledAccountEvidenceIds.map((id) =>
        evidenceById.get(id),
      );
      if (
        controlledEvidence.some((evidence) => !evidence) ||
        !controlledEvidence.some((evidence) => evidence?.kind === "controlled_account_check")
      ) {
        context.addIssue({
          code: "custom",
          message: "A verified action requires checked controlled-account evidence.",
          path: ["actions", actionIndex, "controlledAccountEvidenceIds"],
        });
      }

      action.requiredPrerequisiteKeys.forEach((key) => {
        const prerequisite = prerequisitesByKey.get(key);
        if (!prerequisite || prerequisite.verificationStatus !== "verified") {
          context.addIssue({
            code: "custom",
            message: "An action requires every controlled-account prerequisite to be verified.",
            path: ["actions", actionIndex, "requiredPrerequisiteKeys"],
          });
        }
      });

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

      action.reconciliationLookup?.lookupInputs.forEach((lookupInput, lookupInputIndex) => {
        if (!action.reconciliationLookup?.pathTemplate.includes(`{${lookupInput.key}}`)) {
          context.addIssue({
            code: "custom",
            message: "Every reconciliation input must be used by the lookup path.",
            path: [
              "actions",
              actionIndex,
              "reconciliationLookup",
              "lookupInputs",
              lookupInputIndex,
            ],
          });
        }
      });

      if (action.reconciliationLookup) {
        const pathInputs = [
          ...action.reconciliationLookup.pathTemplate.matchAll(/\{([a-z0-9._-]+)\}/g),
        ].map((match) => match[1]);
        const declaredInputs = new Set(
          action.reconciliationLookup.lookupInputs.map(({ key }) => key),
        );
        if (pathInputs.some((key) => !declaredInputs.has(key))) {
          context.addIssue({
            code: "custom",
            message:
              "Reconciliation path inputs must be known before send from preflight or request state.",
            path: ["actions", actionIndex, "reconciliationLookup", "pathTemplate"],
          });
        }
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

  if (new Date(contract.verifiedAt) > now) {
    throw new Error(`Provider contract verification is in the future: ${contract.providerKey}`);
  }

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

const metaCampaignProviderContract = {
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
  evidence: [
    {
      id: "meta.official.graph_versioning",
      kind: "official_source",
      sourceUrl: META_VERSIONING_SOURCE,
      checkedAt: "2026-08-10T00:00:00.000Z",
      detail: "The official versioning guide identifies Graph API v26.0 as current.",
    },
    {
      id: "meta.official.instagram_publishing",
      kind: "official_source",
      sourceUrl: META_INSTAGRAM_PUBLISHING_SOURCE,
      checkedAt: "2026-08-10T00:00:00.000Z",
      detail: "The official guide documents Instagram publishing prerequisites and flow.",
    },
    {
      id: "meta.official.page_posts",
      kind: "official_source",
      sourceUrl: META_PAGE_POSTS_SOURCE,
      checkedAt: "2026-08-10T00:00:00.000Z",
      detail: "The official guide documents Page post and photo publishing prerequisites.",
    },
    {
      id: "meta.official.marketing_get_started",
      kind: "official_source",
      sourceUrl: META_MARKETING_SOURCE,
      checkedAt: "2026-08-10T00:00:00.000Z",
      detail: "The official guide documents active ad-account and billing prerequisites.",
    },
  ],
  accountPrerequisites: [
    {
      key: "meta.controlled_app_and_login",
      detail: "A controlled Meta developer app and applicable login flow must be verified.",
      verificationStatus: "blocked",
      evidenceIds: ["meta.official.instagram_publishing"],
    },
    {
      key: "meta.controlled_instagram_account",
      detail: "The controlled Instagram professional account and Page relationship must pass.",
      verificationStatus: "blocked",
      evidenceIds: ["meta.official.instagram_publishing"],
    },
    {
      key: "meta.controlled_page",
      detail: "The controlled Page access token and Page tasks must pass.",
      verificationStatus: "blocked",
      evidenceIds: ["meta.official.page_posts"],
    },
    {
      key: "meta.controlled_ad_account",
      detail: "The controlled ad account must be active with billing configured.",
      verificationStatus: "blocked",
      evidenceIds: ["meta.official.marketing_get_started"],
    },
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
      evidenceIds: ["meta.official.instagram_publishing"],
      limits: { maxPayloadBytes: null, maxCopyCharacters: null, maxHashtags: null },
    },
    {
      key: "instagram.image_story",
      verificationStatus: "blocked",
      evidenceIds: ["meta.official.instagram_publishing"],
      limits: { maxPayloadBytes: null, maxCopyCharacters: null, maxHashtags: null },
    },
    {
      key: "facebook.feed_image",
      verificationStatus: "blocked",
      evidenceIds: ["meta.official.page_posts"],
      limits: { maxPayloadBytes: null, maxCopyCharacters: null, maxHashtags: null },
    },
    {
      key: "facebook.image_story",
      verificationStatus: "blocked",
      evidenceIds: ["meta.official.page_posts"],
      limits: { maxPayloadBytes: null, maxCopyCharacters: null, maxHashtags: null },
    },
    {
      key: "meta_ads.feed_image",
      verificationStatus: "blocked",
      evidenceIds: ["meta.official.marketing_get_started"],
      limits: { maxPayloadBytes: null, maxCopyCharacters: null, maxHashtags: null },
    },
    {
      key: "meta_ads.image_story",
      verificationStatus: "blocked",
      evidenceIds: ["meta.official.marketing_get_started"],
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

export function getMetaCampaignProviderContract(now: Date = new Date()): VerifiedProviderContract {
  return parseVerifiedProviderContract(metaCampaignProviderContract, now);
}
