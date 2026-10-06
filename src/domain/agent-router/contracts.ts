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

export const threadModeSchema = z.enum(["quick", "deepthink"]);
export type ThreadMode = z.infer<typeof threadModeSchema>;

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
    /**
     * Shell mode of the calling thread (Task 3, ruling T3a; Task B2, ADR
     * 0074). Optional so earlier callers keep working: absent means "no
     * mode promise", and the service never gates on it. Present `quick`
     * plus a research judgment auto-escalates manage-holders zero-click
     * (`DEEPTHINK_AUTO_ESCALATED`, no nudge card); the deprecated
     * `deepthink_upgrade` nudge is never emitted for new turns.
     */
    threadMode: threadModeSchema.optional(),
    model: z.union([stubModelProposalSchema, liveModelProposalSchema]),
  })
  .strict();
export type RouterInput = z.infer<typeof routerInputSchema>;

export const questionnaireKindSchema = z.enum([
  "clarify",
  "missing_fields",
  /**
   * Deprecated (Task B2, ADR 0074): the router no longer emits upgrade
   * nudges — manage-holders auto-escalate Quick → DeepThink zero-click.
   * Kept in the enum so old rows and saved specs still parse; never mint
   * a new `deepthink_upgrade` card.
   */
  "deepthink_upgrade",
  "duplicate_watch",
  "evidence_window",
  "campaign_ideas",
]);
export type QuestionnaireKind = z.infer<typeof questionnaireKindSchema>;

/**
 * One pickable option. `label` is the title the card renders;
 * `description` is the short description under it. `description` and
 * `recommended` stay optional because the older kinds predate them — the
 * `campaign_ideas` invariant below requires them there, and only there.
 */
export const questionnaireOptionSchema = z
  .object({
    value: z.string().trim().min(1).max(120),
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(280).optional(),
    recommended: z.boolean().optional(),
  })
  .strict();
export type QuestionnaireOption = z.infer<typeof questionnaireOptionSchema>;

export const questionnaireItemSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,60}$/),
    label: z.string().trim().min(1).max(120),
    kind: z.enum(["text", "single_select", "multi_select", "date", "confirm"]),
    required: z.boolean(),
    options: z.array(questionnaireOptionSchema).max(12).optional(),
    helpText: z.string().trim().max(280).optional(),
  })
  .strict();
export type QuestionnaireItem = z.infer<typeof questionnaireItemSchema>;

/**
 * Questionnaire spec. Nullable in the output: present means "ask before
 * routing", absent means "route directly". Task 4 renders this shape.
 *
 * `campaign_ideas` invariant (streaming-synthesis Task 5): every
 * options-bearing item is one choice set of ideas, so each option must
 * carry its short description plus an explicit recommended flag, and
 * exactly one option per item must be recommended. The card renders the
 * description under the title and marks the recommended pick; the Task 6
 * executor reads the pick plus this flag off the echoed spec. Other kinds
 * are untouched: their options predate both fields and still parse.
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
    items: z.array(questionnaireItemSchema).min(1).max(8),
  })
  .strict()
  .superRefine((spec, ctx) => {
    if (spec.kind !== "campaign_ideas") return;
    const choiceItems = spec.items.filter((item) => (item.options?.length ?? 0) > 0);
    if (choiceItems.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A campaign-ideas card needs at least one idea to pick.",
        path: ["items"],
      });
      return;
    }
    for (const item of choiceItems) {
      const options = item.options ?? [];
      if (
        options.some(
          (option) => option.description === undefined || typeof option.recommended !== "boolean",
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Every idea in "${item.key}" needs a short description and an explicit recommended flag.`,
          path: ["items"],
        });
        continue;
      }
      const recommendedCount = options.filter((option) => option.recommended).length;
      if (recommendedCount !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Exactly one idea in "${item.key}" must be recommended, found ${recommendedCount}.`,
          path: ["items"],
        });
      }
    }
  });
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

/**
 * What the light model may propose. The model proposes; this schema
 * disposes — every resolver result is parsed through it before use, so an
 * unparseable proposal fails closed instead of flowing downstream.
 */
export const routerProposalSchema = z
  .object({
    intent: agentIntentSchema,
    confidence: routerConfidenceSchema,
    missing: z.array(missingFieldSchema).max(10),
  })
  .strict();
export type RouterProposal = z.infer<typeof routerProposalSchema>;
