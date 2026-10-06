import { z } from "zod";

import { hasReportPermission } from "@/domain/reports/permissions";
import { env } from "@/lib/env";
import { DomainError, toPublicError } from "@/lib/errors";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { logger } from "@/lib/logger";
import { assertAgentChatEnabled } from "@/modules/integrations/application/feature-access";
import { attachmentIntentSchema } from "@/modules/agent-chat/application/report-intake-api";
import { beginAgentAttachment } from "@/modules/agent-chat/application/report-intake-transport";
import { agentApiErrorResponse, agentCorrelationState, agentJsonResponse } from "@/modules/agent-chat/application/http";

const paramsSchema = z.object({ organizationId: z.string().uuid(), turnId: z.string().uuid() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; turnId: string }> },
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
    const body = attachmentIntentSchema.parse(await request.json().catch(() => ({})));
    const receipt = await beginAgentAttachment({
      organizationId, actorId: context.user.id, turnId: route.turnId,
      fileName: body.fileName, mediaType: body.mediaType, byteSize: body.byteSize,
      idempotencyKey: body.idempotencyKey,
    }, {
      createIntent: async (input) => {
        const { data, error } = await (context.supabase.rpc as unknown as (
          name: string, args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: unknown }>) ("create_agent_attachment_intent", {
          p_organization_id: input.organizationId,
          p_actor_id: input.actorId,
          p_turn_id: input.turnId,
          p_file_name: input.fileName,
          p_media_type: input.mediaType,
          p_byte_size: input.byteSize,
          p_idempotency_key: input.idempotencyKey,
        });
        if (error) throw new DomainError("DOMAIN_ERROR", "The report upload could not be started.");
        return data;
      },
      sign: async ({ bucket, path }) => {
        const { data, error } = await context.supabase.storage.from(bucket).createSignedUploadUrl(path, { upsert: false });
        if (error || !data?.token) throw new DomainError("DOMAIN_ERROR", "A secure upload link could not be created.");
        return { token: data.token };
      },
    });
    return agentJsonResponse({
      attachmentId: receipt.attachmentId,
      expiresAt: receipt.expiresAt,
      replayed: receipt.replayed,
      upload: {
        endpoint: new URL("/storage/v1/upload/resumable", env.NEXT_PUBLIC_SUPABASE_URL).toString(),
        token: receipt.upload.token,
        apiKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
        chunkSize: 6 * 1024 * 1024,
        bucket: receipt.storageBucketId,
        path: receipt.storagePath,
      },
    }, correlationId, receipt.replayed ? 200 : 201);
  } catch (error) {
    logger.warn("agent_attachment.intent_failed", { organizationId, correlationId, errorCode: toPublicError(error).code });
    return agentApiErrorResponse(error, correlationId);
  }
}
