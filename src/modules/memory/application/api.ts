import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createEventPublisher } from "@/domain/events/publisher";
import { MemoryError, safeMemoryErrorCopy } from "@/domain/memory/errors";
import { organizationRoleSchema, type OrganizationRole } from "@/domain/organizations/types";
import { DomainError } from "@/lib/errors";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { logger } from "@/lib/logger";
import type { Database } from "@/lib/supabase/database.types";
import { operatorCeiling, type MemoryActor } from "@/modules/memory/application/authorization";
import { createMemoryService, type MemoryService } from "@/modules/memory/application/service";
import { createMemoryRetrieval } from "@/modules/memory/application/retrieval";
import { createEmbeddingProvider } from "@/modules/memory/infrastructure/embedding-provider";
import {
  createSupabaseMemoryPersistence,
  createSupabaseMemoryPromotionTransactionPort,
} from "@/modules/memory/infrastructure/persistence";
import { createMemoryRepository } from "@/modules/memory/infrastructure/repository";

export function createMemoryWorkspaceApi(input: {
  supabase: SupabaseClient<Database>;
  actor: MemoryActor;
}) {
  const repository = createMemoryRepository(createSupabaseMemoryPersistence(input.supabase));
  const service = createMemoryService({
    repository,
    events: createEventPublisher(),
    transactions: createSupabaseMemoryPromotionTransactionPort(input.supabase),
    logger,
  });
  const retrieval = createMemoryRetrieval({
    repository,
    embeddings: createEmbeddingProvider(),
    ceilingFor: () => operatorCeiling(input.actor),
    actorFor: () => ({ actorType: "user", actorId: input.actor.userId }),
    logger,
  });
  return { service, retrieval };
}

export type MemoryWorkspaceApi = ReturnType<typeof createMemoryWorkspaceApi>;
export type MemoryRouteContext = {
  organizationId: string;
  actorId: string;
  role: OrganizationRole;
  actor: MemoryActor;
  correlationId: string;
  supabase: SupabaseClient<Database>;
};

type MemoryRouteHandler<TParams> = (input: {
  context: MemoryRouteContext;
  params: TParams;
  service: MemoryService;
  retrieval: MemoryWorkspaceApi["retrieval"];
}) => Promise<{ body: unknown; status?: number }>;

export async function memoryRequest<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new MemoryError("VALIDATION_ERROR", safeMemoryErrorCopy.VALIDATION_ERROR);
  }
  return schema.parse(body);
}

function publicError(error: unknown): {
  status: number;
  error: { code: string; message: string; retryable?: boolean };
} {
  if (error instanceof MemoryError) {
    const statusByCode: Record<MemoryError["code"], number> = {
      AUTHORIZATION_ERROR: 403,
      TENANT_SCOPE_ERROR: 404,
      VALIDATION_ERROR: 400,
      NOT_FOUND: 404,
      CONFLICT: 409,
      MEMORY_SENSITIVITY_DENIED: 403,
      MEMORY_VERIFICATION_FORBIDDEN: 409,
      MEMORY_EVIDENCE_REQUIRED: 400,
      MEMORY_SUPERSESSION_INVALID: 409,
      MEMORY_PROPOSAL_INVALID: 400,
    };
    return {
      status: statusByCode[error.code],
      error: {
        code: error.code,
        message: safeMemoryErrorCopy[error.code],
        retryable: error.retryable,
      },
    };
  }
  if (error instanceof DomainError) {
    const status =
      error.code === "AUTHENTICATION_ERROR"
        ? 401
        : error.code === "AUTHORIZATION_ERROR"
          ? 403
          : error.code === "TENANT_SCOPE_ERROR"
            ? 404
            : error.code === "VALIDATION_ERROR"
              ? 400
              : 409;
    return { status, error: { code: error.code, message: error.message } };
  }
  if (error instanceof z.ZodError) {
    return {
      status: 400,
      error: { code: "VALIDATION_ERROR", message: safeMemoryErrorCopy.VALIDATION_ERROR },
    };
  }
  return {
    status: 500,
    error: { code: "UNEXPECTED_ERROR", message: "Something went wrong. Please try again." },
  };
}

/**
 * The sole user-facing composition boundary for Memory. It authenticates and
 * authorizes before constructing any repository, so every query retains the
 * session client's RLS context.
 */
export async function runMemoryRoute<TParams>(input: {
  request: Request;
  params: Promise<TParams>;
  paramsSchema: z.ZodType<TParams>;
  createApi?: (input: {
    supabase: SupabaseClient<Database>;
    actor: MemoryActor;
  }) => MemoryWorkspaceApi;
  handler: MemoryRouteHandler<TParams>;
}): Promise<NextResponse> {
  const startedAt = performance.now();
  let organizationId: string | undefined;
  let correlationId = crypto.randomUUID();
  try {
    const params = input.paramsSchema.parse(await input.params);
    const typedParams = params as TParams & { organizationId: string };
    organizationId = typedParams.organizationId;
    const suppliedCorrelationId = input.request.headers.get("x-correlation-id");
    if (suppliedCorrelationId) correlationId = z.string().uuid().parse(suppliedCorrelationId);
    const organizationContext = await getOrganizationContext(
      Promise.resolve({ organizationId: typedParams.organizationId }),
    );
    const actor: MemoryActor = {
      userId: organizationContext.user.id,
      role: organizationRoleSchema.parse(organizationContext.membership.role),
    };
    const context: MemoryRouteContext = {
      organizationId: organizationContext.organizationId,
      actorId: actor.userId,
      role: actor.role,
      actor,
      correlationId,
      supabase: organizationContext.supabase,
    };
    const api = (input.createApi ?? createMemoryWorkspaceApi)({
      supabase: context.supabase,
      actor,
    });
    const result = await input.handler({ context, params, ...api });
    const response = NextResponse.json(result.body, { status: result.status ?? 200 });
    response.headers.set("x-correlation-id", correlationId);
    logger.info("memory_api.completed", { organizationId, correlationId });
    return response;
  } catch (error) {
    const result = publicError(error);
    const response = NextResponse.json({ error: result.error }, { status: result.status });
    response.headers.set("x-correlation-id", correlationId);
    logger.warn("memory_api.failed", {
      organizationId,
      correlationId,
      durationMs: Math.round(performance.now() - startedAt),
      errorCode: result.error.code,
      httpStatus: result.status,
    });
    return response;
  } finally {
    logger.info("memory_api.latency", {
      organizationId,
      correlationId,
      durationMs: Math.round(performance.now() - startedAt),
    });
  }
}
