import {
  hasOrganizationPermission,
  organizationRolePermissions,
} from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import { getOrganizationContext } from "@/lib/api/organization-context";
import {
  createDeliverableRouteHandlers,
  type DeliverableRouteContext,
  type DeliverableRouteHandlerDependencies,
} from "@/modules/campaigns/application/deliverable-route-handlers";
import { createDeliverableService } from "@/modules/campaigns/application/deliverable-service";
import { assertCampaignsEnabled } from "@/modules/campaigns/application/feature-access";
import {
  createDeliverableRepository,
  type DeliverablePersistence,
} from "@/modules/campaigns/infrastructure/deliverable-repository";

/**
 * The composition root for finished outputs.
 *
 * The Supabase client is the caller's own session client, never a service role.
 * RLS is what keeps one client's outputs invisible to another, and the review
 * function reads `auth.uid()` for the reviewer — under a service role there
 * would be no person to read, and a review with nobody behind it is exactly
 * what must not exist.
 *
 * Allowed roles are derived from the permission map rather than listed, so
 * moving `campaign.approve` between roles in one place does not require
 * remembering to change it here as well.
 */

type DeliverablePermission = Parameters<DeliverableRouteHandlerDependencies["context"]>[1];
type DeliverableRouteParams = Parameters<DeliverableRouteHandlerDependencies["context"]>[0];

function rolesWithPermission(permission: DeliverablePermission): OrganizationRole[] {
  return (Object.keys(organizationRolePermissions) as OrganizationRole[]).filter((role) =>
    hasOrganizationPermission(role, permission),
  );
}

async function productionContext(
  params: DeliverableRouteParams,
  permission: DeliverablePermission,
): Promise<DeliverableRouteContext> {
  const context = await getOrganizationContext(params, rolesWithPermission(permission));
  // Checked after membership, never before: refusing an unknown organization
  // with "not enabled" would let an outsider enumerate which ones exist.
  assertCampaignsEnabled(context.organizationId);
  return context;
}

function productionServiceFor(context: DeliverableRouteContext) {
  return createDeliverableService({
    store: createDeliverableRepository(context.supabase as DeliverablePersistence),
  });
}

export const deliverableRouteHandlers = createDeliverableRouteHandlers({
  context: productionContext,
  serviceFor: productionServiceFor,
});
