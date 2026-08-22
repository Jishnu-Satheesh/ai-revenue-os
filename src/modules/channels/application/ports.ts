import type {
  ChannelAliasInput,
  ChannelBranchMappingInput,
  ChannelCreateInput,
  ChannelUpdateInput,
} from "@/domain/channels/types";
import type { Database } from "@/lib/supabase/database.types";

export type OrganizationChannelRow = Database["public"]["Tables"]["organization_channels"]["Row"];
export type OrganizationChannelBranchRow =
  Database["public"]["Tables"]["organization_channel_branches"]["Row"];
export type ChannelSourceAliasRow = Database["public"]["Tables"]["channel_source_aliases"]["Row"];
export type OrganizationBranchRow = Database["public"]["Tables"]["branches"]["Row"];

export type ChannelManagementSnapshot = {
  channels: OrganizationChannelRow[];
  branches: OrganizationBranchRow[];
  branchMappings: OrganizationChannelBranchRow[];
  aliases: ChannelSourceAliasRow[];
};

export type ChannelRepository = {
  listChannels(input: { organizationId: string }): Promise<OrganizationChannelRow[]>;
  listManagementSnapshot(input: { organizationId: string }): Promise<ChannelManagementSnapshot>;
  createChannel(input: {
    organizationId: string;
    actorId: string;
    body: ChannelCreateInput;
  }): Promise<OrganizationChannelRow>;
  updateChannel(input: {
    organizationId: string;
    channelId: string;
    actorId: string;
    body: ChannelUpdateInput;
  }): Promise<OrganizationChannelRow | null>;
  upsertBranchMapping(input: {
    organizationId: string;
    channelId: string;
    actorId: string;
    body: ChannelBranchMappingInput;
  }): Promise<OrganizationChannelBranchRow | null>;
  createAlias(input: {
    organizationId: string;
    channelId: string;
    actorId: string;
    normalizedAlias: string;
    body: ChannelAliasInput;
  }): Promise<ChannelSourceAliasRow | null>;
};
