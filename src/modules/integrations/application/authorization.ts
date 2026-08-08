import type { OrganizationRole } from "@/domain/organizations/types";
import { IntegrationError } from "@/domain/integrations/errors";

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

export function assertIntegrationPermission(
  role: OrganizationRole,
  permission: IntegrationPermission,
): void {
  if (!hasIntegrationPermission(role, permission)) {
    throw new IntegrationError(
      "AUTHORIZATION_ERROR",
      "You do not have permission for this integration action.",
      false,
    );
  }
}
