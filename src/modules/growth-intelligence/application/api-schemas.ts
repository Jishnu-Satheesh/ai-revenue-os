import { z } from "zod";
import { NextResponse } from "next/server";

import {
  marketProfileDocumentV1Schema,
  marketProfileDocumentV2Schema,
} from "@/domain/growth-intelligence/schemas";
import { toPublicError } from "@/lib/errors";

const idempotencyKeySchema = z.string().trim().min(16).max(200);
const profileDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const marketProfileProposalBodySchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("ai"),
      idempotencyKey: idempotencyKeySchema,
    })
    .strict(),
  z
    .object({
      source: z.literal("operator"),
      profileDocument: marketProfileDocumentV1Schema,
      idempotencyKey: idempotencyKeySchema,
    })
    .strict(),
]);

export const marketProfileDecisionBodySchema = z
  .object({
    decision: z.enum(["confirmed", "rejected", "disabled"]),
    profileDigest: profileDigestSchema,
    reason: z.string().trim().min(1).max(500).nullable().optional().default(null),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const marketProfileRouteParamsSchema = z
  .object({ organizationId: z.string().uuid() })
  .strict();

export const marketProfileDecisionRouteParamsSchema = marketProfileRouteParamsSchema
  .extend({ versionId: z.string().uuid() })
  .strict();

export const startBranchResearchBodySchema = z
  .object({
    branchId: z.string().uuid(),
    document: marketProfileDocumentV2Schema,
    expectedCurrentVersionId: z.string().uuid().nullable(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export type StartBranchResearchBody = z.infer<typeof startBranchResearchBodySchema>;

const itemFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);

const itemReasonSchema = z.string().trim().min(1).max(500);

/**
 * One member answer over a synthesized item. The vocabulary is the full
 * RPC vocabulary on purpose: kind-to-decision gating lives in the fenced
 * function beside the row it protects, so the boundary never invents its
 * own subset that could drift from storage.
 */
function itemDecisionVariant<T extends z.ZodRawShape>(shape: T) {
  return z.object({ ...shape, itemFingerprint: itemFingerprintSchema }).strict();
}

export const itemDecisionBodySchema = z.discriminatedUnion("decision", [
  itemDecisionVariant({ decision: z.literal("acknowledged") }),
  itemDecisionVariant({ decision: z.literal("pinned") }),
  itemDecisionVariant({ decision: z.literal("unpinned") }),
  itemDecisionVariant({ decision: z.literal("planned") }),
  itemDecisionVariant({
    decision: z.literal("snoozed"),
    snoozedUntil: z.string().datetime({ offset: true }),
  }),
  itemDecisionVariant({ decision: z.literal("dismissed"), reason: itemReasonSchema }),
  itemDecisionVariant({ decision: z.literal("resolved") }),
]);

export type ItemDecisionBody = z.infer<typeof itemDecisionBodySchema>;

export const itemFeedbackBodySchema = z.object({ helpful: z.boolean() }).strict();

export type ItemFeedbackBody = z.infer<typeof itemFeedbackBodySchema>;

export const itemDecisionRouteParamsSchema = marketProfileRouteParamsSchema
  .extend({ itemId: z.string().uuid() })
  .strict();

export const preferenceRouteParamsSchema = marketProfileRouteParamsSchema
  .extend({
    sourceKind: z.enum(["synthesis_item", "channel_recommendation", "opportunity"]),
    sourceId: z.string().uuid(),
  })
  .strict();

export type PreferenceRouteParams = z.infer<typeof preferenceRouteParamsSchema>;

/**
 * An actor-scoped presentation preference. The horizon travels only for
 * channel recommendations; the route refuses it for the other kinds because
 * their preference rows have nowhere to store it.
 */
export const preferenceBodySchema = z
  .object({
    pinned: z.boolean(),
    snoozedUntil: z.string().datetime({ offset: true }).nullable().optional().default(null),
  })
  .strict();

export type PreferenceBody = z.infer<typeof preferenceBodySchema>;

export type MarketProfileProposalBody = z.infer<typeof marketProfileProposalBodySchema>;
export type MarketProfileDecisionBody = z.infer<typeof marketProfileDecisionBodySchema>;

export function marketProfileCorrelationState(request: Request) {
  const supplied = request.headers.get("x-correlation-id");
  const fallback = crypto.randomUUID();
  return {
    responseId: z.string().uuid().safeParse(supplied).success ? supplied! : fallback,
    parseAfterAuthorization() {
      return supplied === null ? fallback : z.string().uuid().parse(supplied);
    },
  };
}

export function marketProfileApiErrorResponse(error: unknown, correlationId: string) {
  const publicError = toPublicError(error);
  const status =
    publicError.code === "AUTHENTICATION_ERROR"
      ? 401
      : publicError.code === "AUTHORIZATION_ERROR"
        ? 403
        : publicError.code === "FEATURE_NOT_AVAILABLE" || publicError.code === "TENANT_SCOPE_ERROR"
          ? 404
          : publicError.code === "VALIDATION_ERROR"
            ? 400
            : publicError.code === "UNEXPECTED_ERROR"
              ? 500
              : 422;
  const response = NextResponse.json({ error: publicError }, { status });
  response.headers.set("x-correlation-id", correlationId);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
