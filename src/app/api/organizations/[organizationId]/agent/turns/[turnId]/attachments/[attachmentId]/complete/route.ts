import { tasks } from "@trigger.dev/sdk";
import { z } from "zod";

import { hasReportPermission } from "@/domain/reports/permissions";
import { DomainError, toPublicError } from "@/lib/errors";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { logger } from "@/lib/logger";
import { assertAgentChatEnabled } from "@/modules/integrations/application/feature-access";
import { attachmentCompletionSchema } from "@/modules/agent-chat/application/report-intake-api";
import { submitAgentAttachment } from "@/modules/agent-chat/application/report-intake-transport";
import { agentApiErrorResponse, agentCorrelationState, agentJsonResponse } from "@/modules/agent-chat/application/http";
import type { agentAttachmentTask } from "@/trigger/agent-chat";

const paramsSchema = z.object({
  organizationId: z.string().uuid(),
  turnId: z.string().uuid(),
  attachmentId: z.string().uuid(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; turnId: string; attachmentId: string }> },
) {
  const correlation = agentCorrelationState(request);
  let correlationId = correlation.responseId;
  let organizationId: string | undefined;
  try {
    const route = paramsSchema.parse(await params);
    const context = await getOrganizationContext(Promise.resolve({ organizationId: route.organizationId }));
    organizationId = context.organizationId;
    assertAgentChatEnabled(organizationId);
    if (!hasReportPermission(context.membership.role, "report.upload")) {
      throw new DomainError("AUTHORIZATION_ERROR", "You cannot upload reports for this organization.");
    }
    correlationId = correlation.parseAfterAuthorization();
    const body = attachmentCompletionSchema.parse(await request.json().catch(() => ({})));
    await submitAgentAttachment({
      organizationId,
      actorId: context.user.id,
      turnId: route.turnId,
      attachmentId: route.attachmentId,
      scope: body.scope,
    }, {
      declareScope: async (input) => {
        const { error } = await (context.supabase.rpc as unknown as (
          name: string, args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: unknown }>) ("declare_agent_attachment_scope", {
          p_organization_id: input.organizationId,
          p_actor_id: input.actorId,
          p_turn_id: input.turnId,
          p_attachment_id: input.attachmentId,
          p_scope: input.scope,
        });
        if (error) throw new DomainError("DOMAIN_ERROR", "The report upload could not be confirmed.");
      },
      dispatch: async (input) => {
        try {
          await tasks.trigger<typeof agentAttachmentTask>("agent-chat.process-attachment", input, {
            idempotencyKey: `agent-attachment:${input.attachmentId}:initial`,
          });
        } catch {
          throw new DomainError("DOMAIN_ERROR", "The report is saved, but processing could not be queued. Please retry.");
        }
      },
    });
    return agentJsonResponse({ attachmentId: route.attachmentId, status: "queued" }, correlationId, 202);
  } catch (error) {
    logger.warn("agent_attachment.complete_failed", { organizationId, correlationId, errorCode: toPublicError(error).code });
    return agentApiErrorResponse(error, correlationId);
  }
}
