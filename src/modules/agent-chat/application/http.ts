import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

import { toPublicError } from "@/lib/errors";
import type { Database } from "@/lib/supabase/database.types";
import { IdempotencyConflictError } from "@/domain/agent-chat/errors";
import type {
  ThreadPersistence,
  ThreadQueryBuilder,
} from "@/modules/agent-chat/infrastructure/thread-repository";

/**
 * Shared route machinery for the agent chat routes.
 *
 * A Next route module may only export its handlers, so this lives here
 * rather than beside any `route.ts`. Response convention mirrors the
 * growth-intelligence sibling: `{ ..., correlationId }` JSON plus
 * `x-correlation-id` and `Cache-Control: no-store` on every response,
 * errors included.
 */

export function agentCorrelationState(request: Request) {
  const supplied = request.headers.get("x-correlation-id");
  const fallback = crypto.randomUUID();
  return {
    responseId: z.string().uuid().safeParse(supplied).success ? supplied! : fallback,
    parseAfterAuthorization() {
      return supplied === null ? fallback : z.string().uuid().parse(supplied);
    },
  };
}

export function agentJsonResponse(
  body: Record<string, unknown>,
  correlationId: string,
  status = 200,
): NextResponse {
  const response = NextResponse.json({ ...body, correlationId }, { status });
  response.headers.set("x-correlation-id", correlationId);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function agentApiErrorResponse(error: unknown, correlationId: string): NextResponse {
  if (error instanceof IdempotencyConflictError) {
    const response = NextResponse.json(
      { error: { code: "IDEMPOTENCY_CONFLICT", message: error.message }, correlationId },
      { status: 409 },
    );
    response.headers.set("x-correlation-id", correlationId);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  const publicError = toPublicError(error);
  const status =
    publicError.code === "AUTHENTICATION_ERROR"
      ? 401
      : publicError.code === "AUTHORIZATION_ERROR"
        ? 403
        : publicError.code === "TENANT_SCOPE_ERROR"
          ? 404
          : publicError.code === "VALIDATION_ERROR"
            ? 400
            : publicError.code === "UNEXPECTED_ERROR"
              ? 500
              : 422;
  const response = NextResponse.json({ error: publicError, correlationId }, { status });
  response.headers.set("x-correlation-id", correlationId);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/**
 * Adapts the session client to the repository port. Reads and fenced
 * writes both run as the caller — no service role in user-facing paths.
 */
export function agentPersistenceFor(supabase: SupabaseClient<Database>): ThreadPersistence {
  return {
    rpc: (name, args) =>
      (
        supabase.rpc as unknown as (
          rpcName: string,
          rpcArgs: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: unknown }>
      )(name, args),
    from: (table) =>
      supabase.from(table as "agent_threads") as unknown as ThreadQueryBuilder,
  };
}
