import { createHash } from "node:crypto";
import { idempotencyKeys, tasks } from "@trigger.dev/sdk";

import { getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { assertAgentChatEnabled } from "@/modules/integrations/application/feature-access";
import {
  agentApiErrorResponse,
  agentCorrelationState,
  agentJsonResponse,
  agentPersistenceFor,
} from "@/modules/agent-chat/application/http";
import { threadRouteParamsSchema } from "@/modules/agent-chat/application/api-schemas";
import {
  classifyGovernedTurn,
  turnPersistenceFor,
  turnStartBodySchema,
} from "@/modules/agent-chat/application/turn-api";
import { createThreadRepository } from "@/modules/agent-chat/infrastructure/thread-repository";
import { createAgentTurnRepository } from "@/modules/agent-chat/infrastructure/turn-repository";

import { createLightModelProvider } from "@/modules/agent-router/infrastructure/light-model-provider";
import { readAgentChannelLabels } from "@/modules/agent-chat/application/api";
import type { agentProcessTurnTask } from "@/trigger/agent-chat";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; threadId: string }> },
) {
  const correlation = agentCorrelationState(request);
  let correlationId = correlation.responseId;
  let organizationId: string | undefined;
  try {
    const path = threadRouteParamsSchema.parse(await params);
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: path.organizationId }),
    );
    organizationId = context.organizationId;
    assertAgentChatEnabled(organizationId);
    correlationId = correlation.parseAfterAuthorization();
    const body = turnStartBodySchema.parse(await request.json().catch(() => ({})));
    const threads = createThreadRepository(agentPersistenceFor(context.supabase));
    const message = await threads.getMessage({
      organizationId,
      messageId: body.messageId,
    });
    if (
      !message ||
      message.threadId !== path.threadId ||
      message.role !== "user" ||
      !message.body
    ) {
      throw new DomainError("TENANT_SCOPE_ERROR", "This message was not found in this chat.");
    }
    const repo = createAgentTurnRepository(turnPersistenceFor(context.supabase));
    const existing = await repo.getTurnByMessage(organizationId, path.threadId, message.id);
    let knownChannelLabels: string[] = [];
    if (!existing && !body.hasAttachment) {
      try {
        knownChannelLabels = await readAgentChannelLabels(context.supabase, organizationId);
      } catch {
        logger.warn("agent_turn.channel_labels_unavailable", { organizationId, correlationId });
      }
    }
    const objective =
      existing?.objective ??
      (await classifyGovernedTurn(
        {
          question: message.body!,
          page: `/organizations/${organizationId}/agent`,
          contextDigest: createHash("sha256")
            .update(`${organizationId}:${message.id}`)
            .digest("hex"),
          role: context.membership.role,
          hasAttachment: body.hasAttachment,
          knownChannelLabels,
          correlationId,
        },
        createLightModelProvider(),
      ));
    if (!objective) return agentJsonResponse({ handled: false }, correlationId);
    const receipt = await repo.start({
      organizationId,
      actorId: context.user.id,
      threadId: path.threadId,
      userMessageId: body.messageId,
      idempotencyKey: body.idempotencyKey,
      objective,
    });
    const [turn, thread] = await Promise.all([
      repo.getTurn(organizationId, path.threadId, receipt.turnId),
      threads.getThread({ organizationId, threadId: path.threadId }),
    ]);
    if (!turn || !thread)
      throw new DomainError("TENANT_SCOPE_ERROR", "This chat could not be loaded.");
    if (turn.status === "queued" && turn.objective !== "report_intake") {
      await tasks.trigger<typeof agentProcessTurnTask>(
        "agent-chat.process-turn",
        {
          organizationId,
          turnId: turn.id,
        },
        {
          idempotencyKey: await idempotencyKeys.create(`agent-turn:${organizationId}:${turn.id}`, {
            scope: "global",
          }),
        },
      );
    }
    return agentJsonResponse(
      { handled: true, turn, thread },
      correlationId,
      receipt.replayed ? 200 : 201,
    );
  } catch (error) {
    logger.warn("agent_turn.create_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return agentApiErrorResponse(error, correlationId);
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; threadId: string }> },
) {
  const correlation = agentCorrelationState(request);
  let correlationId = correlation.responseId;
  let organizationId: string | undefined;
  try {
    const path = threadRouteParamsSchema.parse(await params);
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: path.organizationId }),
    );
    organizationId = context.organizationId;
    assertAgentChatEnabled(organizationId);
    correlationId = correlation.parseAfterAuthorization();
    const thread = await createThreadRepository(agentPersistenceFor(context.supabase)).getThread({
      organizationId,
      threadId: path.threadId,
    });
    if (!thread) throw new DomainError("TENANT_SCOPE_ERROR", "This chat was not found.");
    const repo = createAgentTurnRepository(turnPersistenceFor(context.supabase));
    const recent = await repo.listTurns(organizationId, path.threadId, 50);
    const turns = await Promise.all(
      recent.map(async (turn) => {
        const [events, attachments] = await Promise.all([
          repo.listEvents(organizationId!, turn.id),
          repo.listAttachments(organizationId!, turn.id),
        ]);
        return { turn, events, attachments };
      }),
    );
    return agentJsonResponse({ turns }, correlationId);
  } catch (error) {
    logger.warn("agent_turn.list_failed", {
      organizationId,
      correlationId,
      errorCode: toPublicError(error).code,
    });
    return agentApiErrorResponse(error, correlationId);
  }
}
