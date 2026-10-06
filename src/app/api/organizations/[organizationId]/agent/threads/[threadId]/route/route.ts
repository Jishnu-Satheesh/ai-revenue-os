import { tasks } from "@trigger.dev/sdk";

import { getOrganizationContext } from "@/lib/api/organization-context";
import { toPublicError } from "@/lib/errors";
import { logger, toAgentReasonCodes } from "@/lib/logger";
import { createEventPublisher } from "@/domain/events/publisher";
import { assertAgentChatEnabled } from "@/modules/integrations/application/feature-access";
import { createLightModelProvider } from "@/modules/agent-router/infrastructure/light-model-provider";
import { createThreadRepository } from "@/modules/agent-chat/infrastructure/thread-repository";
import { createAgentContextReaders, createAgentQuestionnaireAuthority, createAgentResearchProfileResolver, resolveAgentContextScope } from "@/modules/agent-chat/application/api";
import { loadAgentAdviceContext } from "@/modules/agent-chat/application/advice-context-reader";
import { assessChannelForAgentRequest } from "@/modules/agent-chat/application/channel-assessment-adapter";
import {
  createResearchAutoSeams,
  createThreadService,
} from "@/modules/agent-chat/application/thread-service";
import type { agentResearchOnceTask } from "@/trigger/agent-chat";
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
 * `overview`). Task B3: qualifying research turns (escalated plus
 * already-DeepThink holder direct turns) auto-enqueue one bounded run
 * in this same call under a server-minted attestation — the response
 * carries the `research` receipt, null for every other turn. Watch and
 * campaign lanes stay behind their own fences.
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
      questionnaireAuthority: createAgentQuestionnaireAuthority(),
      threads: createThreadRepository(agentPersistenceFor(context.supabase)),
      events: createEventPublisher(),
      proposeRouter: async (args) => createLightModelProvider().propose({ ...args, correlationId }),
      // Task 6 swap: route digests the real HEAVY pack. Digest shape is
      // unchanged; values shift because the digest now means something.
      contextReaders: createAgentContextReaders(context.supabase),
      resolveContextScope: (input) => resolveAgentContextScope(context.supabase, input),
      loadAdviceContext: (input) => loadAgentAdviceContext({
        supabase: context.supabase,
        organizationId: input.organizationId,
        actorId: input.actorId,
        role: input.role,
        question: input.question,
        correlationId,
      }),
      // Governed §21.2: channel questions resolve against
      // organization-owned identity and reuse or dispatch the
      // source-owned analysis on the caller's session grants.
      assessChannel: (input) =>
        assessChannelForAgentRequest({
          supabase: context.supabase,
          organizationId: input.organizationId,
          actorId: input.actorId,
          role: input.role,
          question: input.question,
          correlationId: input.correlationId,
          allowDispatch: true,
        }),
      // Task B3: the send-time auto path needs the research seams —
      // Trigger transport plus the authenticated readers — so escalated
      // turns enqueue their one bounded run in this same call.
      dispatchSeams: createResearchAutoSeams({
        resolveProfile: createAgentResearchProfileResolver(context.supabase),
        triggerResearchRun: async (payload) => {
          const handle = await tasks.trigger<typeof agentResearchOnceTask>(
            "agent-chat.research-once",
            {
              organizationId: payload.organizationId,
              actorId: payload.actorId,
              threadId: payload.threadId,
              messageDigest: payload.messageDigest,
              ...(payload.branchId ? { branchId: payload.branchId } : {}),
              profileVersionId: payload.profileVersionId,
              profileDigest: payload.profileDigest,
              correlationId: payload.correlationId,
              idempotencyKey: payload.idempotencyKey,
            },
            { idempotencyKey: payload.idempotencyKey },
          );
          return { runId: handle.id };
        },
        readers: createAgentContextReaders(context.supabase),
      }),
      correlationId,
    });
    const { intent, confidence, reasonCodes, questionnaire, thread, research } =
      await service.routeLatest({
        organizationId,
        actorId: context.user.id,
        role: context.membership.role,
        threadId: rawParams.threadId,
        ...(page ? { page } : {}),
        idempotencyKey: body.idempotencyKey,
      });
    // Intent, confidence, and reason codes travel in the event payload
    // (identifier-only, bodies never logged); the log line stays inside
    // the closed LogContext allowlist (Slice C F4: codes narrowed to the
    // closed vocabulary before logging).
    logger.info("agent_thread.routed", {
      organizationId,
      threadId: thread.id,
      intent,
      confidence,
      reasonCodes: toAgentReasonCodes(reasonCodes),
      correlationId,
    });
    return agentJsonResponse(
      { intent, confidence, reasonCodes, questionnaire, thread, research },
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
