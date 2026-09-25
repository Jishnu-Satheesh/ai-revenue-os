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

export const organizationRouteParamsSchema = z
  .object({ organizationId: z.string().uuid() })
  .strict();
