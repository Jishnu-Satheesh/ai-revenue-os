import { getOrganizationContext } from "@/lib/api/organization-context";
import { toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createEventPublisher } from "@/domain/events/publisher";
import { assertAgentChatEnabled } from "@/modules/integrations/application/feature-access";
import { createLightModelProvider } from "@/modules/agent-router/infrastructure/light-model-provider";
import { createThreadRepository } from "@/modules/agent-chat/infrastructure/thread-repository";
import { createAgentContextReaders } from "@/modules/agent-chat/application/api";
import { createThreadService } from "@/modules/agent-chat/application/thread-service";
import {
  routeThreadBodySchema,
  threadRouteParamsSchema,
} from "@/modules/agent-chat/application/api-schemas";
import {
  agentApiErrorResponse,
  agentCorrelationState,
  agentJsonResponse,
  agentPersistenceFor,
} from "@/modules/agent-chat/application/http";

/**
 * Agent thread classify-only route (spec section 8).
 *
 * POST reads the newest user message, classifies it through the
 * deterministic router (light model proposes, code disposes), and
 * returns intent plus questionnaire for the drawer to render. Any
 * member may route — classification is read-only and viewers receive
 * read-only answers. The body carries the idempotency key only; the
 * page key travels as an optional `page` query parameter (default
 * `overview`). Nothing executes here: research, watch, and campaign
 * lanes arrive in later slices behind their own fences.
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
    correlationId = correlation.parseAfterAuthorization();

    const body = routeThreadBodySchema.parse(await request.json().catch(() => ({})));
    const url = new URL(request.url);
    const page = url.searchParams.get("page") ?? undefined;

    const service = createThreadService({
      threads: createThreadRepository(agentPersistenceFor(context.supabase)),
      events: createEventPublisher(),
      proposeRouter: async (args) => createLightModelProvider().propose({ ...args, correlationId }),
      // Task 6 swap: route digests the real HEAVY pack. Digest shape is
      // unchanged; values shift because the digest now means something.
      contextReaders: createAgentContextReaders(context.supabase),
      correlationId,
    });
    const { intent, confidence, reasonCodes, questionnaire, thread } = await service.routeLatest({
      organizationId,
      actorId: context.user.id,
      role: context.membership.role,
      threadId: rawParams.threadId,
      ...(page ? { page } : {}),
      idempotencyKey: body.idempotencyKey,
    });
    // Intent, confidence, and reason codes travel in the event payload
    // (identifier-only, bodies never logged); the log line stays inside
    // the closed LogContext allowlist.
    logger.info("agent_thread.routed", {
      organizationId,
      threadId: thread.id,
      intent,
      confidence,
      reasonCodes,
      correlationId,
    });
    return agentJsonResponse(
      { intent, confidence, reasonCodes, questionnaire, thread },
      correlationId,
    );
  } catch (error) {
    logger.warn("agent_thread.route_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return agentApiErrorResponse(error, correlationId);
  }
}
