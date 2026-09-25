import { questionnaireSpecSchema } from "@/domain/agent-router/contracts";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createEventPublisher } from "@/domain/events/publisher";
import { createLightModelProvider } from "@/modules/agent-router/infrastructure/light-model-provider";
import { createThreadRepository } from "@/modules/agent-chat/infrastructure/thread-repository";
import { createThreadService } from "@/modules/agent-chat/application/thread-service";
import {
  submitAnswersBodySchema,
  threadRouteParamsSchema,
} from "@/modules/agent-chat/application/api-schemas";
import {
  agentApiErrorResponse,
  agentCorrelationState,
  agentJsonResponse,
  agentPersistenceFor,
} from "@/modules/agent-chat/application/http";

/**
 * Agent thread questionnaire answers (spec section 8, ruling F2).
 *
 * POST validates the submitted answers against the echoed spec, appends
 * them to thread messages through the fenced keyed RPC, and re-triggers
 * routing in the same call. Operator role or above; viewers are refused
 * before persistence. The body carries the idempotency key, the resume
 * key of the card being answered, the echoed spec, and the answer record
 * — thread, organization, actor, and correlation ids are server-owned.
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
    if (context.membership.role === "viewer") {
      throw new DomainError("AUTHORIZATION_ERROR", "Viewers cannot change this chat.");
    }
    correlationId = correlation.parseAfterAuthorization();

    const body = submitAnswersBodySchema.parse(await request.json().catch(() => ({})));
    const spec = questionnaireSpecSchema.parse(body.spec);
    const url = new URL(request.url);
    const page = url.searchParams.get("page") ?? undefined;

    const service = createThreadService({
      threads: createThreadRepository(agentPersistenceFor(context.supabase)),
      events: createEventPublisher(),
      proposeRouter: async (args) => createLightModelProvider().propose({ ...args, correlationId }),
      correlationId,
    });
    const { message, replayed, answers, intent, questionnaire } = await service.submitAnswers({
      organizationId,
      actorId: context.user.id,
      role: context.membership.role,
      threadId: rawParams.threadId,
      spec,
      answers: body.answers,
      idempotencyKey: body.idempotencyKey,
      ...(page ? { page } : {}),
    });
    logger.info("agent_thread.answers_submitted", { organizationId, correlationId });
    return agentJsonResponse(
      { message, replayed, answers, resumeKey: body.resumeKey, intent, questionnaire },
      correlationId,
      replayed ? 200 : 201,
    );
  } catch (error) {
    logger.warn("agent_thread.answers_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return agentApiErrorResponse(error, correlationId);
  }
}
