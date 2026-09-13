import {
  hasOrganizationPermission,
  organizationRolePermissions,
} from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import { getOrganizationContext } from "@/lib/api/organization-context";
import {
  createLaunchRouteHandlers,
  type LaunchRouteContext,
  type LaunchRouteHandlerDependencies,
} from "@/modules/campaigns/application/launch-route-handlers";
import { createLaunchService } from "@/modules/campaigns/application/launch-service";
import { assertCampaignsEnabled } from "@/modules/campaigns/application/feature-access";
import {
  createLaunchRepository,
  type LaunchPersistence,
} from "@/modules/campaigns/infrastructure/launch-repository";

/**
 * The composition root for publication authority.
 *
 * The caller's own session client, never a service role — for the same reason
 * as everywhere else in this module, but it matters most here. The approval
 * function reads `auth.uid()` to record who authorized a publication, and an
 * authorization with no person attached to it would be the one record in this
 * system with nothing behind it.
 */

type LaunchPermission = Parameters<LaunchRouteHandlerDependencies["context"]>[1];
type LaunchRouteParams = Parameters<LaunchRouteHandlerDependencies["context"]>[0];

function rolesWithPermission(permission: LaunchPermission): OrganizationRole[] {
  return (Object.keys(organizationRolePermissions) as OrganizationRole[]).filter((role) =>
    hasOrganizationPermission(role, permission),
  );
}

async function productionContext(
  params: LaunchRouteParams,
  permission: LaunchPermission,
): Promise<LaunchRouteContext> {
  const context = await getOrganizationContext(params, rolesWithPermission(permission));
  assertCampaignsEnabled(context.organizationId);
  return context;
}

function productionServiceFor(context: LaunchRouteContext) {
  return createLaunchService({
    store: createLaunchRepository(context.supabase as LaunchPersistence),
  });
}

export const launchRouteHandlers = createLaunchRouteHandlers({
  context: productionContext,
  serviceFor: productionServiceFor,
});
