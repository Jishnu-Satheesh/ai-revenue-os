import { z } from "zod";

import { getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError, toPublicError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { assertAgentChatEnabled } from "@/modules/integrations/application/feature-access";
import { agentApiErrorResponse, agentCorrelationState, agentJsonResponse } from "@/modules/agent-chat/application/http";
import { turnPersistenceFor, turnRouteParamsSchema } from "@/modules/agent-chat/application/turn-api";
import { createAgentTurnRepository } from "@/modules/agent-chat/infrastructure/turn-repository";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; threadId: string; turnId: string }> },
) {
  const correlation = agentCorrelationState(request);
  let correlationId = correlation.responseId;
  let organizationId: string | undefined;
  try {
    const path = turnRouteParamsSchema.parse(await params);
    const context = await getOrganizationContext(Promise.resolve({ organizationId: path.organizationId }));
    organizationId = context.organizationId;
    assertAgentChatEnabled(organizationId);
    correlationId = correlation.parseAfterAuthorization();
    const afterSeq = z.coerce.number().int().min(0).max(2147483647).parse(new URL(request.url).searchParams.get("afterSeq") ?? 0);
    const repo = createAgentTurnRepository(turnPersistenceFor(context.supabase));
    const turn = await repo.getTurn(organizationId, path.threadId, path.turnId);
    if (!turn) throw new DomainError("TENANT_SCOPE_ERROR", "This agent turn was not found.");
    const events = await repo.listEvents(organizationId, turn.id, afterSeq);
    return agentJsonResponse({ events, nextSeq: events.at(-1)?.seq ?? afterSeq, status: turn.status }, correlationId);
  } catch (error) {
    logger.warn("agent_turn.events_failed", { organizationId, correlationId, errorCode: toPublicError(error).code });
    return agentApiErrorResponse(error, correlationId);
  }
}
