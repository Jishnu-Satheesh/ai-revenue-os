import { getOrganizationContext } from "@/lib/api/organization-context";
import { toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createEventPublisher } from "@/domain/events/publisher";
import { assertAgentChatEnabled } from "@/modules/integrations/application/feature-access";
import { createThreadRepository } from "@/modules/agent-chat/infrastructure/thread-repository";
import { createThreadService } from "@/modules/agent-chat/application/thread-service";
import { threadRouteParamsSchema } from "@/modules/agent-chat/application/api-schemas";
import {
  agentApiErrorResponse,
  agentCorrelationState,
  agentJsonResponse,
  agentPersistenceFor,
} from "@/modules/agent-chat/application/http";

/**
 * Agent thread single read (spec section 7, Slice C M9).
 *
 * GET returns the one thread row the drawer checkpoint poll watches:
 * worker-written links plus terminal status. Any member may read —
 * classification and answers stay behind their own gates. A foreign
 * thread id reads as not-found, never as a permission leak. Polling
 * this endpoint replaces the collection-list poll, so one open drawer
 * re-reads one row per tick instead of up to fifty.
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

    const service = createThreadService({
      threads: createThreadRepository(agentPersistenceFor(context.supabase)),
      events: createEventPublisher(),
      correlationId,
    });
    const { thread } = await service.getThread({
      organizationId,
      threadId: rawParams.threadId,
    });
    logger.info("agent_thread.fetched", {
      organizationId,
      threadId: thread.id,
      correlationId,
    });
    return agentJsonResponse({ thread }, correlationId);
  } catch (error) {
    logger.warn("agent_thread.fetch_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return agentApiErrorResponse(error, correlationId);
  }
}
