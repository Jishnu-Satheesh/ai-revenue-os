import type { OrganizationRole } from "@/domain/organizations/types";

/**
 * The permission vocabulary and its role mapping are pure data with no server
 * dependency, so the browser can hide controls a role cannot use while the
 * server keeps the only enforcement that matters. Never import the server-only
 * error module from here.
 *
 * `memory.read_sensitive` is deliberately narrower than the other mutation
 * permissions: an operator may create, verify, supersede, and promote memory
 * but may not read `confidential` or `customer_content` items. That boundary is
 * enforced again in RLS, not only here.
 */
export const memoryPermissions = [
  "memory.read",
  "memory.read_sensitive",
  "memory.write",
  "memory.verify",
  "memory.supersede",
  "memory.promote_fact",
] as const;

export type MemoryPermission = (typeof memoryPermissions)[number];

const readOnly: readonly MemoryPermission[] = ["memory.read"];

const operatorPermissions: readonly MemoryPermission[] = [
  "memory.read",
  "memory.write",
  "memory.verify",
  "memory.supersede",
  "memory.promote_fact",
];

const permissionsByRole: Readonly<Record<OrganizationRole, readonly MemoryPermission[]>> = {
  owner: memoryPermissions,
  admin: memoryPermissions,
  operator: operatorPermissions,
  viewer: readOnly,
};

export function hasMemoryPermission(role: OrganizationRole, permission: MemoryPermission): boolean {
  return permissionsByRole[role]?.includes(permission) ?? false;
}
