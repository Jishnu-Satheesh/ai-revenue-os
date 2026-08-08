import type { OrganizationRole } from "@/domain/organizations/types";
import { IntegrationError } from "@/domain/integrations/errors";
import {
  hasIntegrationPermission,
  integrationPermissions,
  type IntegrationPermission,
} from "@/domain/integrations/permissions";

// The role mapping itself lives in a client-safe domain module; this file adds
// the server-only enforcement that raises a public integration error.
export { hasIntegrationPermission, integrationPermissions };
export type { IntegrationPermission };

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
