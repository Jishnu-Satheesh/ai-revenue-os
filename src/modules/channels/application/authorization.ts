import type { OrganizationPermission } from "@/domain/access/permissions";
import { hasOrganizationPermission } from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import { DomainError } from "@/lib/errors";

export type ChannelPermission = Extract<OrganizationPermission, `channel.${string}`>;

export function assertChannelPermission(
  role: OrganizationRole,
  permission: ChannelPermission,
): void {
  if (!hasOrganizationPermission(role, permission)) {
    throw new DomainError(
      "AUTHORIZATION_ERROR",
      "You do not have permission for this channel action.",
    );
  }
}
