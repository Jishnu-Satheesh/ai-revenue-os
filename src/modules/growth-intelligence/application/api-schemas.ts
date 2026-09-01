import { z } from "zod";
import { NextResponse } from "next/server";

import { marketProfileDocumentV1Schema } from "@/domain/growth-intelligence/schemas";
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
