import {
  hasOrganizationPermission,
  organizationRolePermissions,
} from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import { getOrganizationContext } from "@/lib/api/organization-context";
import {
  createCreativeHistoryRouteHandlers,
  type CreativeHistoryRouteContext,
  type CreativeHistoryRouteHandlerDependencies,
} from "@/modules/campaigns/application/creative-history-route-handlers";
import { createCreativeHistoryService } from "@/modules/campaigns/application/creative-history-service";
import { assertCampaignsEnabled } from "@/modules/campaigns/application/feature-access";
import {
  DEFAULT_ASSET_INTAKE_LIMITS,
  ingestCampaignImage,
} from "@/modules/campaigns/infrastructure/asset-intake";
import {
  createCreativeHistoryRepository,
  type CreativeHistoryPersistence,
} from "@/modules/campaigns/infrastructure/creative-history-repository";
import {
  createSupabaseCreativeHistoryObjectStore,
  creativeHistoryStorageConfiguration,
  creativeHistoryStoragePath,
} from "@/modules/campaigns/infrastructure/creative-history-storage";

/**
 * The composition root for the design library.
 *
 * The Supabase client here is the caller's own session client. There is no
 * service-role client on this path and there is not meant to be one: RLS is
 * what makes one client's library invisible to another, and a service role
 * would switch that off for every request that used it.
 *
 * The roles allowed through are derived from the permission map rather than
 * listed, so adding `asset.review` to a role in one place does not require
 * remembering to add it here too.
 */

type CreativeHistoryPermission = Parameters<
  CreativeHistoryRouteHandlerDependencies["context"]
>[1];
type CreativeHistoryRouteParams = Parameters<
  CreativeHistoryRouteHandlerDependencies["context"]
>[0];

function rolesWithPermission(permission: CreativeHistoryPermission): OrganizationRole[] {
  return (Object.keys(organizationRolePermissions) as OrganizationRole[]).filter((role) =>
    hasOrganizationPermission(role, permission),
  );
}

async function productionContext(
  params: CreativeHistoryRouteParams,
  permission: CreativeHistoryPermission,
): Promise<CreativeHistoryRouteContext> {
  const context = await getOrganizationContext(params, rolesWithPermission(permission));
  // Checked after membership, never before: refusing an unknown organization
  // with "not enabled" would let an outsider enumerate which ones exist.
  assertCampaignsEnabled(context.organizationId);
  return context;
}

function productionServiceFor(context: CreativeHistoryRouteContext) {
  return createCreativeHistoryService({
    store: createCreativeHistoryRepository(context.supabase as CreativeHistoryPersistence),
    objects: createSupabaseCreativeHistoryObjectStore(
      context.supabase as Parameters<typeof createSupabaseCreativeHistoryObjectStore>[0],
    ),
    ingest: ingestCampaignImage,
    storage: creativeHistoryStorageConfiguration,
    intakeLimits: DEFAULT_ASSET_INTAKE_LIMITS,
    storagePath: creativeHistoryStoragePath,
  });
}

export const creativeHistoryRouteHandlers = createCreativeHistoryRouteHandlers({
  context: productionContext,
  serviceFor: productionServiceFor,
});
