import { hasOrganizationPermission, organizationPermissions } from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";

/**
 * Memory's slice of the platform permission catalogue.
 *
 * These keys used to be defined here with their own role map, which made Memory
 * the only module where permission-based authorization was real. They now live
 * in `@/domain/access/permissions` alongside every other permission, seeded in
 * the database and checked for drift. This module stays as the narrow view its
 * callers already import, so folding the catalogue in did not churn thirty call
 * sites.
 *
 * The role mapping is unchanged: `memory.read_sensitive` is still owner and
 * admin only, while an operator may write, verify, supersede, and promote. RLS
 * enforces that boundary again independently.
 *
 * Still pure data with no server dependency. Never import the server-only error
 * module from here.
 */
export const memoryPermissions = organizationPermissions.filter(
  (permission): permission is Extract<typeof permission, `memory.${string}`> =>
    permission.startsWith("memory."),
);

export type MemoryPermission = (typeof memoryPermissions)[number];

export function hasMemoryPermission(role: OrganizationRole, permission: MemoryPermission): boolean {
  return hasOrganizationPermission(role, permission);
}
