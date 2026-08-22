import { z } from "zod";

import { normalizeChannelAlias } from "@/domain/channels/normalization";
import type {
  ChannelAliasInput,
  ChannelBranchMappingInput,
  ChannelCreateInput,
  ChannelUpdateInput,
} from "@/domain/channels/types";
import { DomainError } from "@/lib/errors";
import { assertChannelPermission } from "@/modules/channels/application/authorization";
import type { ChannelRepository } from "@/modules/channels/application/ports";
import type { OrganizationRole } from "@/domain/organizations/types";

export type AuthenticatedChannelContext = {
  organizationId: string;
  actorId: string;
  role: OrganizationRole;
};

const idSchema = z.string().uuid();

function requireFound<T>(value: T | null, entity: string): T {
  if (!value) throw new DomainError("TENANT_SCOPE_ERROR", `${entity} was not found.`);
  return value;
}

export function createChannelService(repository: ChannelRepository) {
  return {
    async listChannels(context: AuthenticatedChannelContext) {
      assertChannelPermission(context.role, "channel.read");
      return repository.listChannels({ organizationId: context.organizationId });
    },

    async listManagementSnapshot(context: AuthenticatedChannelContext) {
      assertChannelPermission(context.role, "channel.read");
      return repository.listManagementSnapshot({ organizationId: context.organizationId });
    },

    async createChannel(context: AuthenticatedChannelContext, body: ChannelCreateInput) {
      assertChannelPermission(context.role, "channel.manage");
      return repository.createChannel({
        organizationId: context.organizationId,
        actorId: context.actorId,
        body,
      });
    },

    async updateChannel(
      context: AuthenticatedChannelContext,
      channelId: string,
      body: ChannelUpdateInput,
    ) {
      assertChannelPermission(context.role, "channel.manage");
      return requireFound(
        await repository.updateChannel({
          organizationId: context.organizationId,
          channelId: idSchema.parse(channelId),
          actorId: context.actorId,
          body,
        }),
        "Channel",
      );
    },

    async upsertBranchMapping(
      context: AuthenticatedChannelContext,
      channelId: string,
      body: ChannelBranchMappingInput,
    ) {
      assertChannelPermission(context.role, "channel.map_branch");
      return requireFound(
        await repository.upsertBranchMapping({
          organizationId: context.organizationId,
          channelId: idSchema.parse(channelId),
          actorId: context.actorId,
          body,
        }),
        "Channel or branch",
      );
    },

    async createAlias(
      context: AuthenticatedChannelContext,
      channelId: string,
      body: ChannelAliasInput,
    ) {
      assertChannelPermission(context.role, "channel.map_branch");
      return requireFound(
        await repository.createAlias({
          organizationId: context.organizationId,
          channelId: idSchema.parse(channelId),
          actorId: context.actorId,
          normalizedAlias: normalizeChannelAlias(body.alias),
          body,
        }),
        "Channel",
      );
    },
  };
}
