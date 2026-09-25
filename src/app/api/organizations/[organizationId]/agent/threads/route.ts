import { getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createEventPublisher } from "@/domain/events/publisher";
import { createThreadRepository } from "@/modules/agent-chat/infrastructure/thread-repository";
import { createThreadService } from "@/modules/agent-chat/application/thread-service";
import {
  createThreadBodySchema,
  organizationRouteParamsSchema,
  threadListQuerySchema,
} from "@/modules/agent-chat/application/api-schemas";
import {
  agentApiErrorResponse,
  agentCorrelationState,
  agentJsonResponse,
  agentPersistenceFor,
} from "@/modules/agent-chat/application/http";

/**
 * Agent thread collection (spec section 7).
 *
 * GET lists newest-first history for the caller's own organization (any
 * member, viewers included). POST opens a thread through the fenced
 * keyed RPC (operator role or above; viewers get an honest 403 before
 * touching persistence). The body carries content plus the idempotency
 * key only — organization, actor, and correlation ids are server-owned.
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const correlation = agentCorrelationState(request);
  let correlationId = correlation.responseId;
  let organizationId: string | undefined;
  try {
    const rawParams = organizationRouteParamsSchema.parse(await params);
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: rawParams.organizationId }),
    );
    organizationId = context.organizationId;
    correlationId = correlation.parseAfterAuthorization();

    const url = new URL(request.url);
    const query = threadListQuerySchema.parse({
      limit: url.searchParams.get("limit") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
    });

    const service = createThreadService({
      threads: createThreadRepository(agentPersistenceFor(context.supabase)),
      events: createEventPublisher(),
      correlationId,
    });
    const { threads, nextCursor } = await service.listThreads({
      organizationId,
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    logger.info("agent_threads.listed", { organizationId, correlationId });
    return agentJsonResponse({ threads, nextCursor }, correlationId);
  } catch (error) {
    logger.warn("agent_threads.list_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return agentApiErrorResponse(error, correlationId);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const correlation = agentCorrelationState(request);
  let correlationId = correlation.responseId;
  let organizationId: string | undefined;
  try {
    const rawParams = organizationRouteParamsSchema.parse(await params);
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: rawParams.organizationId }),
    );
    organizationId = context.organizationId;
    if (context.membership.role === "viewer") {
      throw new DomainError("AUTHORIZATION_ERROR", "Viewers cannot change this chat.");
    }
    correlationId = correlation.parseAfterAuthorization();

    const body = createThreadBodySchema.parse(await request.json().catch(() => ({})));

    const service = createThreadService({
      threads: createThreadRepository(agentPersistenceFor(context.supabase)),
      events: createEventPublisher(),
      correlationId,
    });
    const { thread, replayed } = await service.createThread({
      organizationId,
      actorId: context.user.id,
      role: context.membership.role,
      idempotencyKey: body.idempotencyKey,
      ...(body.title !== undefined ? { title: body.title } : {}),
      mode: body.mode,
    });
    logger.info("agent_thread.opened", { organizationId, correlationId });
    return agentJsonResponse({ thread, replayed }, correlationId, replayed ? 200 : 201);
  } catch (error) {
    logger.warn("agent_thread.open_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return agentApiErrorResponse(error, correlationId);
  }
}
