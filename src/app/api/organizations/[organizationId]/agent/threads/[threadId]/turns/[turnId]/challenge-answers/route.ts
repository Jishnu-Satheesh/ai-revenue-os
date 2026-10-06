import { getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { assertAgentChatEnabled } from "@/modules/integrations/application/feature-access";
import {
  agentApiErrorResponse,
  agentCorrelationState,
  agentJsonResponse,
} from "@/modules/agent-chat/application/http";
import {
  turnChallengeAnswerBodySchema,
  turnPersistenceFor,
  turnRouteParamsSchema,
} from "@/modules/agent-chat/application/turn-api";
import { createAgentTurnRepository } from "@/modules/agent-chat/infrastructure/turn-repository";
import type { agentAttachmentTask, agentProcessTurnTask } from "@/trigger/agent-chat";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; threadId: string; turnId: string }> },
) {
  const correlation = agentCorrelationState(request);
  let correlationId = correlation.responseId;
  let organizationId: string | undefined;
  try {
    const path = turnRouteParamsSchema.parse(await params);
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: path.organizationId }),
    );
    organizationId = context.organizationId;
    assertAgentChatEnabled(organizationId);
    correlationId = correlation.parseAfterAuthorization();
    const repo = createAgentTurnRepository(turnPersistenceFor(context.supabase));
    const turn = await repo.getTurn(organizationId, path.threadId, path.turnId);
    if (!turn) throw new DomainError("TENANT_SCOPE_ERROR", "This agent turn was not found.");
    const body = turnChallengeAnswerBodySchema.parse(await request.json().catch(() => ({})));
    const result = await repo.answerChallenge({
      organizationId,
      actorId: context.user.id,
      turnId: turn.id,
      challengeId: body.challengeId,
      idempotencyKey: body.idempotencyKey,
      answers: body.answers,
    });
    if (result.status === "queued") {
      const dispatchKey = await idempotencyKeys.create(
        `agent-challenge:${organizationId}:${turn.id}:${body.challengeId}`,
        { scope: "global" },
      );
      if (turn.objective === "report_intake") {
        const [attachment] = await repo.listAttachments(organizationId, turn.id);
        if (!attachment)
          throw new DomainError("TENANT_SCOPE_ERROR", "This report attachment was not found.");
        await tasks.trigger<typeof agentAttachmentTask>(
          "agent-chat.process-attachment",
          {
            organizationId,
            turnId: turn.id,
            attachmentId: attachment.id,
          },
          { idempotencyKey: dispatchKey },
        );
      } else {
        await tasks.trigger<typeof agentProcessTurnTask>(
          "agent-chat.process-turn",
          {
            organizationId,
            turnId: turn.id,
          },
          { idempotencyKey: dispatchKey },
        );
      }
    }
    const updated = await repo.getTurn(organizationId, path.threadId, turn.id);
    return agentJsonResponse({ turn: updated }, correlationId);
  } catch (error) {
    logger.warn("agent_turn.challenge_answer_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return agentApiErrorResponse(error, correlationId);
  }
}
import { idempotencyKeys, tasks } from "@trigger.dev/sdk";
