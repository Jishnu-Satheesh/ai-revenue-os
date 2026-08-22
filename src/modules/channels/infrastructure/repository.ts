import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ChannelRepository } from "@/modules/channels/application/ports";
import type { Database } from "@/lib/supabase/database.types";
import { DomainError } from "@/lib/errors";

type AuthenticatedClient = SupabaseClient<Database>;

function persistenceFailure(message: string, cause: unknown): never {
  throw new DomainError("DOMAIN_ERROR", message, cause);
}

export function createAuthenticatedChannelRepository(
  supabase: AuthenticatedClient,
): ChannelRepository {
  async function channelExists(organizationId: string, channelId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from("organization_channels")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("id", channelId)
      .maybeSingle();
    if (error) persistenceFailure("Channel access could not be checked.", error);
    return Boolean(data);
  }

  async function branchExists(organizationId: string, branchId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from("branches")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("id", branchId)
      .maybeSingle();
    if (error) persistenceFailure("Branch access could not be checked.", error);
    return Boolean(data);
  }

  return {
    async listChannels({ organizationId }) {
      const { data, error } = await supabase
        .from("organization_channels")
        .select("*")
        .eq("organization_id", organizationId)
        .order("status", { ascending: true })
        .order("display_name", { ascending: true });
      if (error) persistenceFailure("Channels could not be loaded.", error);
      return data ?? [];
    },

    async listManagementSnapshot({ organizationId }) {
      const [channels, branches, branchMappings, aliases] = await Promise.all([
        supabase
          .from("organization_channels")
          .select("*")
          .eq("organization_id", organizationId)
          .order("status", { ascending: true })
          .order("display_name", { ascending: true }),
        supabase
          .from("branches")
          .select("*")
          .eq("organization_id", organizationId)
          .eq("is_active", true)
          .order("name", { ascending: true }),
        supabase
          .from("organization_channel_branches")
          .select("*")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: true }),
        supabase
          .from("channel_source_aliases")
          .select("*")
          .eq("organization_id", organizationId)
          .eq("status", "active")
          .order("alias", { ascending: true }),
      ]);
      const resultSets = [channels, branches, branchMappings, aliases];
      const failure = resultSets.find((result) => result.error)?.error;
      if (failure) persistenceFailure("Channel mappings could not be loaded.", failure);
      return {
        channels: channels.data ?? [],
        branches: branches.data ?? [],
        branchMappings: branchMappings.data ?? [],
        aliases: aliases.data ?? [],
      };
    },

    async createChannel({ organizationId, actorId, body }) {
      const { data, error } = await supabase
        .from("organization_channels")
        .insert({
          organization_id: organizationId,
          key: body.key,
          display_name: body.displayName,
          category: body.category,
          template_key: body.templateKey ?? null,
          created_by: actorId,
        })
        .select("*")
        .single();
      if (error || !data) persistenceFailure("Channel could not be created.", error);
      return data;
    },

    async updateChannel({ organizationId, channelId, actorId, body }) {
      const update = {
        ...(body.displayName === undefined ? {} : { display_name: body.displayName }),
        ...(body.category === undefined ? {} : { category: body.category }),
        ...(body.templateKey === undefined ? {} : { template_key: body.templateKey }),
        ...(body.status === undefined
          ? {}
          : body.status === "archived"
            ? {
                status: "archived" as const,
                archived_at: new Date().toISOString(),
                archived_by: actorId,
              }
            : { status: "active" as const, archived_at: null, archived_by: null }),
      };
      const { data, error } = await supabase
        .from("organization_channels")
        .update(update)
        .eq("organization_id", organizationId)
        .eq("id", channelId)
        .select("*")
        .maybeSingle();
      if (error) persistenceFailure("Channel could not be updated.", error);
      return data;
    },

    async upsertBranchMapping({ organizationId, channelId, actorId, body }) {
      if (!(await channelExists(organizationId, channelId))) return null;
      if (!(await branchExists(organizationId, body.branchId))) return null;
      const { data, error } = await supabase
        .from("organization_channel_branches")
        .upsert(
          {
            organization_id: organizationId,
            channel_id: channelId,
            branch_id: body.branchId,
            status: body.applicability,
            effective_from: body.effectiveFrom ?? null,
            effective_to: body.effectiveTo ?? null,
            created_by: actorId,
          },
          { onConflict: "organization_id,channel_id,branch_id" },
        )
        .select("*")
        .maybeSingle();
      if (error) persistenceFailure("Channel branch mapping could not be saved.", error);
      return data;
    },

    async createAlias({ organizationId, channelId, actorId, normalizedAlias, body }) {
      if (!(await channelExists(organizationId, channelId))) return null;
      const { data, error } = await supabase
        .from("channel_source_aliases")
        .insert({
          organization_id: organizationId,
          channel_id: channelId,
          alias: body.alias,
          normalized_alias: normalizedAlias,
          source_scope: body.sourceScope,
          effective_from: body.effectiveFrom ?? null,
          effective_to: body.effectiveTo ?? null,
          confirmed_at: new Date().toISOString(),
          created_by: actorId,
        })
        .select("*")
        .maybeSingle();
      if (error) persistenceFailure("Channel alias could not be created.", error);
      return data;
    },
  };
}
