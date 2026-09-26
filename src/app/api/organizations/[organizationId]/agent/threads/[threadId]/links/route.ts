import { getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { assertAgentChatEnabled } from "@/modules/integrations/application/feature-access";
import { createThreadRepository } from "@/modules/agent-chat/infrastructure/thread-repository";
import { createThreadService } from "@/modules/agent-chat/application/thread-service";
import {
  threadLinksBodySchema,
  threadRouteParamsSchema,
} from "@/modules/agent-chat/application/api-schemas";
import {
  agentApiErrorResponse,
  agentCorrelationState,
  agentJsonResponse,
  agentPersistenceFor,
} from "@/modules/agent-chat/application/http";

/**
 * Agent thread link update (spec section 11 audit chain).
 *
 * POST links the thread to its research project, request, draft request,
 * and campaign through the fenced `set_thread_links` RPC. Operator role
 * or above; viewers are refused before persistence. The campaign-advice
 * handoff calls this after admitting a draft request so thread, draft
 * request, and (once the worker completes it) campaign stay
 * identifier-linked. Bodies never logged; link targets are safe ids.
 */

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
    if (context.membership.role === "viewer") {
      throw new DomainError("AUTHORIZATION_ERROR", "Viewers cannot change this chat.");
    }
    correlationId = correlation.parseAfterAuthorization();

    const body = threadLinksBodySchema.parse(await request.json().catch(() => ({})));

    const service = createThreadService({
      threads: createThreadRepository(agentPersistenceFor(context.supabase)),
      correlationId,
    });
    const links = await service.setThreadLinks({
      organizationId,
      actorId: context.user.id,
      role: context.membership.role,
      threadId: rawParams.threadId,
      ...(body.projectId ? { projectId: body.projectId } : {}),
      ...(body.requestId ? { requestId: body.requestId } : {}),
      ...(body.draftRequestId ? { draftRequestId: body.draftRequestId } : {}),
      ...(body.campaignId ? { campaignId: body.campaignId } : {}),
    });
    logger.info("agent_thread.links_updated", {
      organizationId,
      threadId: rawParams.threadId,
      correlationId,
    });
    return agentJsonResponse({ links }, correlationId);
  } catch (error) {
    logger.warn("agent_thread.links_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return agentApiErrorResponse(error, correlationId);
  }
}
