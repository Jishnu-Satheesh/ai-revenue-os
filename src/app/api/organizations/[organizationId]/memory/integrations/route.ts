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

const settingsRowSchema = z
  .object({
    organization_id: z.string().uuid(),
    capture_enabled: z.boolean(),
    channel_context_enabled: z.boolean(),
    growth_context_enabled: z.boolean(),
    campaign_context_enabled: z.boolean(),
    subject_context_enabled: z.boolean(),
    legacy_corpus_qualified: z.boolean(),
    context_policy_version: z.string(),
  })
  .strict();

/**
 * Current memory integration settings, readable by every member.
 *
 * Reads ride the caller's RLS session through the member select policy, so a
 * reader only ever sees their own organization's row. Null is "never
 * configured", never a default: the Settings page says so and saves nothing
 * until someone decides. An unreadable row is an error, never a null — the
 * page must not invite a first save on top of settings it failed to load.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  return runMemoryRoute({
    request,
    params,
    paramsSchema,
    handler: async ({ context }) => {
      const client = context.supabase as unknown as {
        from(table: string): {
          select(columns: string): {
            eq(
              column: string,
              value: string,
            ): {
              maybeSingle(): PromiseLike<{
                data: unknown;
                error: { code?: string; message?: string } | null;
              }>;
            };
          };
        };
      };
      const result = await client
        .from("memory_integration_settings")
        .select(
          "organization_id,capture_enabled,channel_context_enabled,growth_context_enabled,campaign_context_enabled,subject_context_enabled,legacy_corpus_qualified,context_policy_version",
        )
        .eq("organization_id", context.organizationId)
        .maybeSingle();
      if (result.error) {
        throw new Error("The memory settings could not be read.");
      }
      if (result.data === null) {
        return { body: { settings: null } };
      }
      const row = settingsRowSchema.parse(result.data);
      return {
        body: {
          settings: {
            organizationId: row.organization_id,
            captureEnabled: row.capture_enabled,
            channelContextEnabled: row.channel_context_enabled,
            growthContextEnabled: row.growth_context_enabled,
            campaignContextEnabled: row.campaign_context_enabled,
            subjectContextEnabled: row.subject_context_enabled,
            legacyCorpusQualified: row.legacy_corpus_qualified,
            contextPolicyVersion: row.context_policy_version,
          },
        },
      };
    },
  });
}

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
        throw new DomainError(
          "AUTHORIZATION_ERROR",
          "Only owners and admins can change memory settings.",
        );
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
          throw new DomainError(
            "AUTHORIZATION_ERROR",
            "Only owners and admins can change memory settings.",
          );
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
