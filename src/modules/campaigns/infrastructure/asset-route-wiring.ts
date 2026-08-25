import {
  hasOrganizationPermission,
  organizationRolePermissions,
} from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import { getOrganizationContext } from "@/lib/api/organization-context";
import {
  createAssetRouteHandlers,
  type AssetRouteContext,
  type AssetRouteHandlerDependencies,
} from "@/modules/campaigns/application/asset-route-handlers";
import { createAssetLibraryService } from "@/modules/campaigns/application/asset-library-service";
import { createBrandAssetService } from "@/modules/campaigns/application/brand-asset-service";
import { assertCampaignsEnabled } from "@/modules/campaigns/application/feature-access";
import { ingestCampaignImage } from "@/modules/campaigns/infrastructure/asset-intake";
import {
  createAssetLibraryRepository,
  type AssetLibraryPersistence,
} from "@/modules/campaigns/infrastructure/asset-library-repository";
import {
  createBrandAssetStore,
  createSupabaseBrandAssetObjectStore,
  type BrandAssetPersistence,
} from "@/modules/campaigns/infrastructure/brand-asset-repository";

type AssetPermission = Parameters<AssetRouteHandlerDependencies["context"]>[1];
type AssetRouteParams = Parameters<AssetRouteHandlerDependencies["context"]>[0];

function rolesWithAssetPermission(permission: AssetPermission): OrganizationRole[] {
  return (Object.keys(organizationRolePermissions) as OrganizationRole[]).filter((role) =>
    hasOrganizationPermission(role, permission),
  );
}

async function productionContext(
  params: AssetRouteParams,
  permission: AssetPermission,
): Promise<AssetRouteContext> {
  const context = await getOrganizationContext(params, rolesWithAssetPermission(permission));
  assertCampaignsEnabled(context.organizationId);
  return context;
}

function productionServicesFor(context: AssetRouteContext) {
  return {
    library: createAssetLibraryService({
      store: createAssetLibraryRepository(context.supabase as AssetLibraryPersistence),
    }),
    brandAssets: createBrandAssetService({
      store: createBrandAssetStore(context.supabase as BrandAssetPersistence),
      objects: createSupabaseBrandAssetObjectStore(
        context.supabase as Parameters<typeof createSupabaseBrandAssetObjectStore>[0],
      ),
      ingest: ingestCampaignImage,
    }),
  };
}

export const assetRouteHandlers = createAssetRouteHandlers({
  context: productionContext,
  servicesFor: productionServicesFor,
});
