import { z } from "zod";

import { DomainError } from "@/lib/errors";
import { memoryRequest, runMemoryRoute } from "@/modules/memory/application/api";

const paramsSchema = z.object({ organizationId: z.string().uuid() });

/**
 * Every flag is an explicit boolean: there is no silent default for capture,
 * for any context purpose, or for legacy-corpus qualification. Absent means
 * the caller did not decide, and the route refuses rather than guessing.
 */
const settingsPatchSchema = z
  .object({
    captureEnabled: z.boolean(),
    channelContextEnabled: z.boolean(),
    growthContextEnabled: z.boolean(),
    campaignContextEnabled: z.boolean(),
    subjectContextEnabled: z.boolean(),
    legacyCorpusQualified: z.boolean(),
    contextPolicyVersion: z.string().trim().min(1).max(60).optional(),
  })
  .strict();

const settingsResponseSchema = z
  .object({
    organizationId: z.string().uuid(),
    captureEnabled: z.boolean(),
    contextPolicyVersion: z.string(),
  })
  .catchall(z.unknown());

/**
 * Memory integration settings: owner/admin only, explicit booleans.
 *
 * Writes travel through `update_memory_integration_settings`, which binds the
 * actor and the `memory.manage_integrations` permission inside the database;
 * the route's own owner/admin gate sits in front so a lesser role never
 * reaches the RPC. The change itself is audited by the settings trigger.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  return runMemoryRoute({
    request,
    params,
    paramsSchema,
    handler: async ({ context }) => {
      if (context.role !== "owner" && context.role !== "admin") {
        throw new DomainError("AUTHORIZATION_ERROR", "Only owners and admins can change memory settings.");
      }
      const body = await memoryRequest(request, settingsPatchSchema);
      const client = context.supabase as unknown as {
        rpc(
          name: string,
          args: Record<string, unknown>,
        ): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
      };
      const result = await client.rpc("update_memory_integration_settings", {
        p_organization_id: context.organizationId,
        p_actor_id: context.actorId,
        p_capture_enabled: body.captureEnabled,
        p_channel_context_enabled: body.channelContextEnabled,
        p_growth_context_enabled: body.growthContextEnabled,
        p_campaign_context_enabled: body.campaignContextEnabled,
        p_subject_context_enabled: body.subjectContextEnabled,
        p_legacy_corpus_qualified: body.legacyCorpusQualified,
        p_context_policy_version: body.contextPolicyVersion ?? "shared-context-v1",
        p_correlation_id: context.correlationId,
      });
      if (result.error) {
        if (result.error.code === "42501") {
          throw new DomainError("AUTHORIZATION_ERROR", "Only owners and admins can change memory settings.");
        }
        throw new DomainError("VALIDATION_ERROR", "The memory settings could not be saved.");
      }
      const settings = settingsResponseSchema.parse(result.data);
      return {
        body: {
          settings: {
            organizationId: settings.organizationId,
            captureEnabled: settings.captureEnabled,
            contextPolicyVersion: settings.contextPolicyVersion,
          },
        },
      };
    },
  });
}
