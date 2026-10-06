import { getOrganizationContext } from "@/lib/api/organization-context";
import { toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createEventPublisher } from "@/domain/events/publisher";
import { assertAgentChatEnabled } from "@/modules/integrations/application/feature-access";
import { createThreadRepository } from "@/modules/agent-chat/infrastructure/thread-repository";
import { createThreadService } from "@/modules/agent-chat/application/thread-service";
import {
  appendMessageBodySchema,
  threadListQuerySchema,
  threadRouteParamsSchema,
} from "@/modules/agent-chat/application/api-schemas";
import {
  agentApiErrorResponse,
  agentCorrelationState,
  agentJsonResponse,
  agentPersistenceFor,
} from "@/modules/agent-chat/application/http";

/**
 * Agent thread messages (spec section 7).
 *
 * GET replays oldest-first messages for reopen (any member; a foreign
 * thread id reads as not-found, never as a permission leak). POST
 * appends through the fenced keyed RPC as the `user` role (operator
 * role or above). The body carries the idempotency key plus the message
 * text only — thread, organization, actor, and correlation ids are
 * server-owned.
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; threadId: string }> },
) {
  const correlation = agentCorrelationState(request);
  let correlationId = correlation.responseId;
  let organizationId: string | undefined;
  try {
    const rawParams = threadRouteParamsSchema.parse(await params);
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: rawParams.organizationId }),
    );
    organizationId = context.organizationId;
    assertAgentChatEnabled(organizationId);
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
    const { messages, nextCursor } = await service.listMessages({
      organizationId,
      threadId: rawParams.threadId,
      limit: query.limit,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    logger.info("agent_messages.listed", { organizationId, correlationId });
    return agentJsonResponse({ messages, nextCursor }, correlationId);
  } catch (error) {
    logger.warn("agent_messages.list_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return agentApiErrorResponse(error, correlationId);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; threadId: string }> },
) {
  const correlation = agentCorrelationState(request);
  let correlationId = correlation.responseId;
  let organizationId: string | undefined;
  try {
    const rawParams = threadRouteParamsSchema.parse(await params);
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: rawParams.organizationId }),
    );
    organizationId = context.organizationId;
    assertAgentChatEnabled(organizationId);
    correlationId = correlation.parseAfterAuthorization();

    const body = appendMessageBodySchema.parse(await request.json().catch(() => ({})));

    const service = createThreadService({
      threads: createThreadRepository(agentPersistenceFor(context.supabase)),
      events: createEventPublisher(),
      correlationId,
    });
    const { message, replayed } = await service.appendUserMessage({
      organizationId,
      actorId: context.user.id,
      role: context.membership.role,
      threadId: rawParams.threadId,
      idempotencyKey: body.idempotencyKey,
      body: body.body,
    });
    logger.info("agent_message.appended", {
      organizationId,
      threadId: message.threadId,
      correlationId,
    });
    return agentJsonResponse({ message, replayed }, correlationId, replayed ? 200 : 201);
  } catch (error) {
    logger.warn("agent_message.append_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return agentApiErrorResponse(error, correlationId);
  }
}
