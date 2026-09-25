import { z } from "zod";

import {
  agentIntentSchema,
  missingFieldSchema,
  routerConfidenceSchema,
  ROUTER_MESSAGE_MAX_CHARS,
} from "@/domain/agent-router/intents";

/**
 * Router contracts (spec section 8). Zod-strict on both sides of the AI
 * boundary: the light model proposes, these schemas dispose.
 */

export const routerRoleSchema = z.enum(["viewer", "operator", "admin", "owner"]);
export type RouterRole = z.infer<typeof routerRoleSchema>;

const permissionSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_.]{1,120}$/);

const pageKeySchema = z.string().trim().min(1).max(120);

/**
 * Opaque digest string. Hex preferred but not enforced, so the router stays
 * a reusable platform layer for any caller digest format.
 */
const digestSchema = z.string().trim().min(1).max(256);

/** Safe ids + scope fingerprints only. Never customer data. */
export const activeWatchCandidateSchema = z
  .object({
    id: z.string().uuid(),
    scopeFingerprint: z.string().trim().min(1).max(256),
  })
  .strict();
export type ActiveWatchCandidate = z.infer<typeof activeWatchCandidateSchema>;

/**
 * An already-obtained, schema-validated model proposal. Tests hand-write
 * it; Task 3's async route obtains it from the live light-model provider
 * (`propose`) and forwards it here, keeping `routeAgentMessage` sync and
 * deterministic.
 */
export const stubModelProposalSchema = z
  .object({
    kind: z.literal("stub"),
    intent: agentIntentSchema,
    confidence: routerConfidenceSchema,
    missing: z.array(missingFieldSchema).max(10),
  })
  .strict();

/** Live classification. Without an injected resolver it fails closed. */
export const liveModelProposalSchema = z.object({ kind: z.literal("live") }).strict();

export const routerInputSchema = z
  .object({
    /** Trimmed then validated; over-long is rejected, never silently cut. */
    text: z.preprocess(
      (value) => (typeof value === "string" ? value.trim() : value),
      z.string().min(1).max(ROUTER_MESSAGE_MAX_CHARS),
    ),
    page: pageKeySchema,
    role: routerRoleSchema,
    permissions: z.array(permissionSchema).max(32),
    contextDigest: digestSchema,
    historyDigest: digestSchema.optional(),
    activeWatches: z.array(activeWatchCandidateSchema).max(20),
    model: z.union([stubModelProposalSchema, liveModelProposalSchema]),
  })
  .strict();
export type RouterInput = z.infer<typeof routerInputSchema>;

export const questionnaireKindSchema = z.enum([
  "clarify",
  "missing_fields",
  "deepthink_upgrade",
  "duplicate_watch",
  "evidence_window",
]);
export type QuestionnaireKind = z.infer<typeof questionnaireKindSchema>;

export const questionnaireItemSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,60}$/),
    label: z.string().trim().min(1).max(120),
    kind: z.enum(["text", "single_select", "multi_select", "date", "confirm"]),
    required: z.boolean(),
    options: z
      .array(
        z
          .object({
            value: z.string().trim().min(1).max(120),
            label: z.string().trim().min(1).max(120),
          })
          .strict(),
      )
      .max(12)
      .optional(),
    helpText: z.string().trim().max(280).optional(),
  })
  .strict();
export type QuestionnaireItem = z.infer<typeof questionnaireItemSchema>;

/**
 * Questionnaire spec. Nullable in the output: present means "ask before
 * routing", absent means "route directly". Task 4 renders this shape.
 */
export const questionnaireSpecSchema = z
  .object({
    kind: questionnaireKindSchema,
    title: z.string().trim().min(1).max(120),
    /** Deterministic resume key derived from intent + page + digest. */
    resumeKey: z
      .string()
      .trim()
      .regex(/^[a-z0-9:_\-.]{1,160}$/),
    items: z.array(questionnaireItemSchema).min(1).max(5),
  })
  .strict();
export type QuestionnaireSpec = z.infer<typeof questionnaireSpecSchema>;

const reasonCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_]{2,80}$/);

export const routerOutputSchema = z
  .object({
    intent: agentIntentSchema,
    confidence: routerConfidenceSchema,
    missingFields: z.array(missingFieldSchema).max(3),
    /** Deterministic note for the executor: digests + safe ids only. */
    routingNote: z.string().trim().min(1).max(4000),
    questionnaire: questionnaireSpecSchema.nullable(),
    reasonCodes: z.array(reasonCodeSchema).max(12),
  })
  .strict();
export type RouterOutput = z.infer<typeof routerOutputSchema>;
