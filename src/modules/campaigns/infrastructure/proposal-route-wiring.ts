import {
  hasOrganizationPermission,
  organizationRolePermissions,
} from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import { getOrganizationContext } from "@/lib/api/organization-context";
import {
  createProposalRouteHandlers,
  type ProposalRouteContext,
  type ProposalRouteHandlerDependencies,
} from "@/modules/campaigns/application/proposal-route-handlers";
import { createCampaignProposalService } from "@/modules/campaigns/application/proposal-service";
import { assertCampaignsEnabled } from "@/modules/campaigns/application/feature-access";
import {
  createProposalRepository,
  type ProposalPersistence,
} from "@/modules/campaigns/infrastructure/proposal-repository";

/**
 * The composition root for proposals.
 *
 * The Supabase client is the caller's own session client, never a service role.
 * That matters twice over here: RLS is what keeps one client's proposals
 * invisible to another, and the approval function reads `auth.uid()` for the
 * actor — under a service role there would be no actor to read, and an
 * approval with no person behind it is exactly what must not exist.
 *
 * Allowed roles are derived from the permission map rather than listed, so
 * moving `campaign.proposal_approve` between roles in one place does not
 * require remembering to change it here as well.
 */

type ProposalPermission = Parameters<ProposalRouteHandlerDependencies["context"]>[1];
type ProposalRouteParams = Parameters<ProposalRouteHandlerDependencies["context"]>[0];

function rolesWithPermission(permission: ProposalPermission): OrganizationRole[] {
  return (Object.keys(organizationRolePermissions) as OrganizationRole[]).filter((role) =>
    hasOrganizationPermission(role, permission),
  );
}

async function productionContext(
  params: ProposalRouteParams,
  permission: ProposalPermission,
): Promise<ProposalRouteContext> {
  const context = await getOrganizationContext(params, rolesWithPermission(permission));
  // Checked after membership, never before: refusing an unknown organization
  // with "not enabled" would let an outsider enumerate which ones exist.
  assertCampaignsEnabled(context.organizationId);
  return context;
}

function productionServiceFor(context: ProposalRouteContext) {
  return createCampaignProposalService({
    store: createProposalRepository(context.supabase as ProposalPersistence),
  });
}

export const proposalRouteHandlers = createProposalRouteHandlers({
  context: productionContext,
  serviceFor: productionServiceFor,
});
