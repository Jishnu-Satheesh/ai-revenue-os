import { z } from "zod";

export const connectionMaturitySchema = z.enum([
  "manual",
  "imported",
  "read-only",
  "draft-write",
  "governed-write",
  "bounded-autonomous",
]);

export const integrationCharacterSchema = z.enum([
  "data_source",
  "publishing_destination",
  "advertising_account",
  "operator_review",
]);

export const capabilityDirectionSchema = z.enum(["inbound", "outbound"]);

export const capabilityEffectSchema = z.enum([
  "read",
  "public_write",
  "money_moving",
  "operator_control",
]);

export const providerAdapterKindSchema = z.enum([
  "read",
  "publish",
  "advertise",
  "webhook",
  "operator_review",
]);

export const capabilityPrerequisiteSchema = z.enum([
  "organization_entitled",
  "account_eligible",
  "account_mapped",
  "credential_current",
  "controlled_account_evidence",
  "tracking_ready",
  "linked_operator",
  "webhook_configured",
]);

const integrationKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .regex(/^[a-z][a-z0-9_.-]+$/);

export const providerCapabilityDefinitionSchema = z
  .object({
    key: integrationKeySchema,
    character: integrationCharacterSchema,
    direction: capabilityDirectionSchema,
    effect: capabilityEffectSchema,
    maturity: connectionMaturitySchema,
    requiredScopes: z.array(z.string().trim().min(1).max(300)),
    restrictionCodes: z.array(integrationKeySchema),
    adapterKind: providerAdapterKindSchema,
    prerequisites: z.array(capabilityPrerequisiteSchema),
    requiredWebhookEventKeys: z.array(integrationKeySchema),
  })
  .strict();

export const providerDefinitionSchema = z
  .object({
    key: integrationKeySchema,
    displayName: z.string().trim().min(1).max(160),
    adapterVersion: z.string().trim().min(1).max(80),
    contractVersion: z.string().trim().min(1).max(120),
    rolloutState: z.enum(["fixture", "available", "disabled"]),
    characters: z.array(integrationCharacterSchema).min(1),
    capabilities: z.array(providerCapabilityDefinitionSchema).min(1),
    syncIntervalMinutes: z.number().int().positive(),
    staleAfterMinutes: z.number().int().positive(),
    operatorCopy: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()
  .superRefine((definition, context) => {
    const characters = new Set(definition.characters);
    const capabilityKeys = new Set<string>();
    for (const [index, capability] of definition.capabilities.entries()) {
      if (!characters.has(capability.character)) {
        context.addIssue({
          code: "custom",
          path: ["capabilities", index, "character"],
          message: "Capability character must be owned by the provider definition.",
        });
      }
      if (capabilityKeys.has(capability.key)) {
        context.addIssue({
          code: "custom",
          path: ["capabilities", index, "key"],
          message: "Provider capability keys must be unique.",
        });
      }
      capabilityKeys.add(capability.key);
      if (new Set(capability.requiredScopes).size !== capability.requiredScopes.length) {
        context.addIssue({
          code: "custom",
          path: ["capabilities", index, "requiredScopes"],
          message: "Capability scopes must be exact and unique.",
        });
      }
      if (new Set(capability.restrictionCodes).size !== capability.restrictionCodes.length) {
        context.addIssue({
          code: "custom",
          path: ["capabilities", index, "restrictionCodes"],
          message: "Capability restriction codes must be unique.",
        });
      }
      if (new Set(capability.prerequisites).size !== capability.prerequisites.length) {
        context.addIssue({
          code: "custom",
          path: ["capabilities", index, "prerequisites"],
          message: "Capability prerequisites must be unique.",
        });
      }
      if (
        new Set(capability.requiredWebhookEventKeys).size !==
        capability.requiredWebhookEventKeys.length
      ) {
        context.addIssue({
          code: "custom",
          path: ["capabilities", index, "requiredWebhookEventKeys"],
          message: "Webhook event keys must be exact and unique.",
        });
      }
      if (
        (capability.adapterKind === "webhook") !==
        capability.requiredWebhookEventKeys.length > 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["capabilities", index, "requiredWebhookEventKeys"],
          message: "Only webhook capabilities declare one or more webhook event keys.",
        });
      }

      const compatibility = {
        read:
          capability.character === "data_source" &&
          capability.direction === "inbound" &&
          capability.effect === "read" &&
          capability.maturity === "read-only",
        publish:
          capability.character === "publishing_destination" &&
          capability.direction === "outbound" &&
          capability.effect === "public_write" &&
          ["governed-write", "bounded-autonomous"].includes(capability.maturity),
        advertise:
          capability.character === "advertising_account" &&
          capability.direction === "outbound" &&
          capability.effect === "money_moving" &&
          ["governed-write", "bounded-autonomous"].includes(capability.maturity),
        webhook:
          capability.character === "data_source" &&
          capability.direction === "inbound" &&
          capability.effect === "read" &&
          capability.maturity === "read-only",
        operator_review:
          capability.character === "operator_review" &&
          capability.direction === "inbound" &&
          capability.effect === "operator_control" &&
          capability.maturity === "governed-write",
      }[capability.adapterKind];
      if (!compatibility) {
        context.addIssue({
          code: "custom",
          path: ["capabilities", index],
          message: "Capability is not compatible with its adapter kind.",
        });
      }
      if (definition.rolloutState !== "fixture") {
        const mandatoryPrerequisites = {
          read: ["organization_entitled", "account_mapped", "credential_current"],
          publish: [
            "organization_entitled",
            "account_eligible",
            "account_mapped",
            "credential_current",
            "controlled_account_evidence",
          ],
          advertise: [
            "organization_entitled",
            "account_eligible",
            "account_mapped",
            "credential_current",
            "controlled_account_evidence",
            "tracking_ready",
          ],
          webhook: [
            "organization_entitled",
            "account_mapped",
            "credential_current",
            "webhook_configured",
          ],
          operator_review: ["organization_entitled", "linked_operator"],
        }[capability.adapterKind] as readonly CapabilityPrerequisite[];
        const missingPrerequisite = mandatoryPrerequisites.find(
          (prerequisite) => !capability.prerequisites.includes(prerequisite),
        );
        if (missingPrerequisite) {
          context.addIssue({
            code: "custom",
            path: ["capabilities", index, "prerequisites"],
            message: `Live ${capability.adapterKind} capabilities require ${missingPrerequisite}.`,
          });
        }
      }
      if (
        definition.rolloutState === "fixture" &&
        !(
          capability.adapterKind === "read" &&
          capability.character === "data_source" &&
          capability.direction === "inbound" &&
          capability.effect === "read" &&
          capability.maturity === "read-only"
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["capabilities", index],
          message: "A fixture provider may register read-only fixture capabilities only.",
        });
      }
    }
    if (new Set(definition.characters).size !== definition.characters.length) {
      context.addIssue({
        code: "custom",
        path: ["characters"],
        message: "Provider characters must be unique.",
      });
    }
    const capabilityCharacters = new Set(definition.capabilities.map(({ character }) => character));
    if (
      capabilityCharacters.size !== definition.characters.length ||
      definition.characters.some((character) => !capabilityCharacters.has(character))
    ) {
      context.addIssue({
        code: "custom",
        path: ["characters"],
        message: "Provider characters must exactly match its capability characters.",
      });
    }
  });

export const v1AvailableMaturitySchema = z.enum(["manual", "imported", "read-only"]);

export const connectionStatusSchema = z.enum([
  "pending",
  "active",
  "degraded",
  "disconnected",
  "revoked",
]);

export const operatorHealthStateSchema = z.enum([
  "pending",
  "healthy",
  "degraded",
  "stale",
  "revoked",
]);

export const integrationRecordSourceSchema = z.object({
  kind: z.enum(["connection", "data_source"]),
  id: z.string().trim().min(1),
});

export const integrationRecordEnvelopeSchema = z.object({
  schemaVersion: z.number().int().positive(),
  organizationId: z.string().trim().min(1),
  source: integrationRecordSourceSchema,
  externalRecordId: z.string().trim().min(1),
  recordType: z.string().trim().min(1),
  observedAt: z.string().datetime().optional(),
  fetchedAt: z.string().datetime(),
  payload: z.unknown(),
});

export const ingestionRunSourceSchema = z
  .object({
    connectionId: z.string().trim().min(1).optional(),
    dataSourceId: z.string().trim().min(1).optional(),
  })
  .refine(
    ({ connectionId, dataSourceId }) => Boolean(connectionId) !== Boolean(dataSourceId),
    "Exactly one source identifier is required.",
  );

export type ConnectionMaturity = z.infer<typeof connectionMaturitySchema>;
export type IntegrationCharacter = z.infer<typeof integrationCharacterSchema>;
export type CapabilityDirection = z.infer<typeof capabilityDirectionSchema>;
export type CapabilityEffect = z.infer<typeof capabilityEffectSchema>;
export type ProviderAdapterKind = z.infer<typeof providerAdapterKindSchema>;
export type CapabilityPrerequisite = z.infer<typeof capabilityPrerequisiteSchema>;
export type V1AvailableMaturity = z.infer<typeof v1AvailableMaturitySchema>;
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;
export type OperatorHealthState = z.infer<typeof operatorHealthStateSchema>;
export type IntegrationRecordEnvelope = z.infer<typeof integrationRecordEnvelopeSchema>;
