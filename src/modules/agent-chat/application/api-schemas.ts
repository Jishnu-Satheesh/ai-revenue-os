import { z } from "zod";

import { threadModeSchema } from "@/modules/agent-chat/infrastructure/thread-repository";

/**
 * Agent chat route bodies (spec section 7).
 *
 * The body carries content plus the idempotency key only. Organization,
 * actor, and correlation ids are server-owned (path, session, headers)
 * and never accepted from the client. Title/body caps repeat the Task 1
 * contract verbatim: title trims to at most 200 chars, bodies trim to
 * 1-20000 chars.
 */

const idempotencyKeySchema = z.string().trim().min(16).max(200);

export const createThreadBodySchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    title: z.string().trim().max(200).optional(),
    mode: threadModeSchema.default("quick"),
  })
  .strict();
export type CreateThreadBody = z.infer<typeof createThreadBodySchema>;

export const appendMessageBodySchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    body: z.preprocess(
      (value) => (typeof value === "string" ? value.trim() : value),
      z.string().min(1).max(20000),
    ),
  })
  .strict();
export type AppendMessageBody = z.infer<typeof appendMessageBodySchema>;

/**
 * Route-classify body. Classification itself is read-only; the key is
 * accepted now so the later executor dispatch can key on the same
 * client token without a second round trip.
 */
export const routeThreadBodySchema = z.object({ idempotencyKey: idempotencyKeySchema }).strict();
export type RouteThreadBody = z.infer<typeof routeThreadBodySchema>;

/**
 * Questionnaire-answer submit body (ruling F2). Answers reach the server
 * and re-trigger routing in one call: the idempotency key owns the
 * answers append, and the service derives the reroute token from it, so
 * submission never collides with the original route token (ruling L4).
 * The spec is echoed so the server validates against what the drawer
 * rendered; unknown answer keys are ignored by the validator.
 *
 * Streaming-synthesis Task 6: a `campaign_ideas` pick may carry the bound
 * opportunity (id plus exact version) so the answers route can call the
 * draft seam immediately. Absent means no draft path — the pick resolves
 * to the pre-filled brief, never an invented opportunity.
 */
export const submitAnswersBodySchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    resumeKey: z
      .string()
      .trim()
      .regex(/^[a-z0-9:_\-.]{1,160}$/),
    spec: z.unknown(),
    answers: z.record(z.string(), z.unknown()),
    opportunity: z
      .object({
        id: z.string().uuid(),
        version: z.number().int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type SubmitAnswersBody = z.infer<typeof submitAnswersBodySchema>;

export const threadListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).max(2000).optional(),
  })
  .strict();
export type ThreadListQuery = z.infer<typeof threadListQuerySchema>;

export const threadRouteParamsSchema = z
  .object({
    organizationId: z.string().uuid(),
    threadId: z.string().uuid(),
  })
  .strict();
export type ThreadRouteParams = z.infer<typeof threadRouteParamsSchema>;

/**
 * Thread link update body (spec section 11 audit chain). Every target is
 * optional and nullable, but at least one link id must arrive: a body
 * with zero link ids is refused with 400 instead of clearing the thread's
 * links (the `set_thread_links` RPC overwrites all four columns, so an
 * empty body would silently wipe the thread → research → draft chain —
 * see Task 7 finding 2). Unknown keys are refused. Organization, actor,
 * and thread ids are server-owned (path, session) and never accepted
 * from the client.
 */
const threadLinkIdSchema = z.string().uuid().nullable().optional();

export const threadLinksBodySchema = z
  .object({
    projectId: threadLinkIdSchema,
    requestId: threadLinkIdSchema,
    draftRequestId: threadLinkIdSchema,
    campaignId: threadLinkIdSchema,
  })
  .strict()
  .refine(
    (body) =>
      [body.projectId, body.requestId, body.draftRequestId, body.campaignId].some(
        (id) => typeof id === "string" && id.length > 0,
      ),
    { message: "At least one link id is required." },
  );
export type ThreadLinksBody = z.infer<typeof threadLinksBodySchema>;

export const organizationRouteParamsSchema = z
  .object({ organizationId: z.string().uuid() })
  .strict();

/**
 * Governed dispatch body (spec sections 10-12, Slice B).
 *
 * POST carries the idempotency token, the action, and the operator's
 * explicit confirmation — plus only the block matching the action.
 * Organization, actor, thread, digest, and correlation ids are
 * server-owned (path, session, latest message, headers) and never
 * accepted from the client. `research_once` needs no block: the route
 * resolves the bound Market Profile pointer server-side, so a client
 * can never widen research scope.
 */

export const dispatchActionSchema = z.enum([
  "research_once",
  "watch_create",
  "watch_update",
  "campaign_advice",
]);
export type DispatchAction = z.infer<typeof dispatchActionSchema>;

export const dispatchConfirmationSchema = z.object({ confirmed: z.boolean() }).strict();
export type DispatchConfirmation = z.infer<typeof dispatchConfirmationSchema>;

const dispatchAssertionSchema = z
  .object({
    key: z.string().trim().min(1).max(200),
    expectedOutcome: z.string().trim().min(1).max(200),
  })
  .strict();

const dispatchEvidenceSnapshotSchema = z
  .object({
    windowDays: z.union([z.literal(30), z.literal(60)]),
    observedAt: z.string().datetime({ offset: true }),
    digest: z.string().trim().min(1).max(256),
    citations: z.array(z.string().trim().min(1).max(500)).min(1).max(50),
  })
  .strict();

const dispatchEstimateSchema = z
  .object({
    valueText: z.string().trim().min(1).max(240),
    inputs: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
    assumptions: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  })
  .strict();

export const dispatchWatchCreateSchema = z
  .object({
    branchId: z.string().uuid(),
    title: z.string().trim().min(1).max(200).optional(),
    question: z.string().trim().min(1).max(2000),
    mode: z.enum(["one-time", "recurring"]),
    schedule: z.unknown().optional(),
    researchArea: z.string().trim().min(1).max(160),
    competitors: z.array(z.unknown()).max(20).default([]),
    investigationAreas: z.array(z.string()).min(1).max(5).default(["demand"]),
    businessContextSnapshotId: z.string().uuid().optional(),
  })
  .strict();
export type DispatchWatchCreate = z.infer<typeof dispatchWatchCreateSchema>;

export const dispatchWatchUpdateSchema = z
  .object({
    projectId: z.string().uuid(),
    edits: z.record(z.string(), z.unknown()),
  })
  .strict();
export type DispatchWatchUpdate = z.infer<typeof dispatchWatchUpdateSchema>;

export const dispatchCampaignAdviceSchema = z
  .object({
    opportunity: z
      .object({ id: z.string().uuid(), version: z.number().int().positive() })
      .strict(),
    objective: z.string().trim().min(1).max(500),
    audience: z.string().trim().min(1).max(500),
    assertions: z.array(dispatchAssertionSchema).min(1).max(50),
    evidenceSnapshot: dispatchEvidenceSnapshotSchema,
    evidenceSnapshotFreezable: z.boolean(),
    marketProfile: z
      .object({
        versionId: z.string().trim().min(1).max(200),
        digest: z.string().trim().min(1).max(256),
      })
      .strict()
      .nullable()
      .default(null),
    policyPass: z.boolean(),
    capabilityPass: z.boolean(),
    schedulePass: z.boolean(),
    audienceReady: z.boolean(),
    estimate: dispatchEstimateSchema,
  })
  .strict();
export type DispatchCampaignAdvice = z.infer<typeof dispatchCampaignAdviceSchema>;

export const dispatchBodySchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    action: dispatchActionSchema,
    confirmation: dispatchConfirmationSchema,
    watchCreate: dispatchWatchCreateSchema.optional(),
    watchUpdate: dispatchWatchUpdateSchema.optional(),
    campaignAdvice: dispatchCampaignAdviceSchema.optional(),
  })
  .strict();
export type DispatchBody = z.infer<typeof dispatchBodySchema>;

/**
 * Builds the exact confirmed POST body the drawer sends to the dispatch
 * route. One constructor shared by the drawer, tests, and Slice C, so the
 * wire shape cannot drift between callers. Confirmation is always true
 * here: this helper is only called from an explicit confirm click. Blocks
 * take schema *input* types so Zod applies its defaults (competitors,
 * investigation areas) instead of every caller repeating them.
 */
export function buildDispatchPayload(input: {
  action: DispatchAction;
  idempotencyKey: string;
  watchCreate?: z.input<typeof dispatchWatchCreateSchema>;
  watchUpdate?: z.input<typeof dispatchWatchUpdateSchema>;
  campaignAdvice?: z.input<typeof dispatchCampaignAdviceSchema>;
}): DispatchBody {
  return dispatchBodySchema.parse({ ...input, confirmation: { confirmed: true } });
}
