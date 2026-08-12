import type { OrganizationRole } from "@/domain/organizations/types";

/**
 * The permission vocabulary and its role mapping are pure data with no server
 * dependency, so the browser can hide controls a role cannot use while the
 * server keeps the only enforcement that matters. Never import the server-only
 * error module from here.
 */
export const integrationPermissions = [
  "integration.read",
  "integration.connect",
  "integration.test",
  "integration.sync",
  "integration.map",
  "integration.import",
  "integration.disconnect",
] as const;

export type IntegrationPermission = (typeof integrationPermissions)[number];

const readOnly: readonly IntegrationPermission[] = ["integration.read"];
const operatorPermissions: readonly IntegrationPermission[] = integrationPermissions;

const permissionsByRole: Readonly<Record<OrganizationRole, readonly IntegrationPermission[]>> = {
  owner: operatorPermissions,
  admin: operatorPermissions,
  operator: operatorPermissions,
  viewer: readOnly,
};

export function hasIntegrationPermission(
  role: OrganizationRole,
  permission: IntegrationPermission,
): boolean {
  return permissionsByRole[role].includes(permission);
}

/**
 * Permission to operate the Hub never upgrades a derived provider grant. This
 * helper is intentionally narrow until an action endpoint exists in Task 3.
 */
export function hasUsableIntegrationGrant(input: {
  availability: "available" | "blocked" | "disabled";
  connectionStatus: "pending" | "active" | "degraded" | "disconnected" | "revoked";
}): boolean {
  return (
    input.availability === "available" &&
    input.connectionStatus !== "pending" &&
    input.connectionStatus !== "disconnected" &&
    input.connectionStatus !== "revoked"
  );
}
