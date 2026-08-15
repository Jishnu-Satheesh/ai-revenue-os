import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/organization-context";
import { brandAssetUploadRequestSchema } from "@/modules/campaigns/application/api-schemas";
import { campaignRouteContext, parseJsonBody } from "@/modules/campaigns/application/route-context";
import { createBrandAssetService } from "@/modules/campaigns/application/brand-asset-service";
import {
  createBrandAssetStore,
  createSupabaseBrandAssetObjectStore,
  type BrandAssetPersistence,
} from "@/modules/campaigns/infrastructure/brand-asset-repository";
import { ingestCampaignImage } from "@/modules/campaigns/infrastructure/asset-intake";

/**
 * Reserves an upload slot.
 *
 * The response carries the path the browser must upload to. It is issued by the
 * database, not chosen by the caller, so an upload cannot be aimed at another
 * organization's folder.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const context = await campaignRouteContext(params, "campaign.edit");
    const body = brandAssetUploadRequestSchema.parse(await parseJsonBody(request));

    const service = createBrandAssetService({
      store: createBrandAssetStore(context.supabase as unknown as BrandAssetPersistence),
      objects: createSupabaseBrandAssetObjectStore(
        context.supabase as unknown as Parameters<typeof createSupabaseBrandAssetObjectStore>[0],
      ),
      ingest: ingestCampaignImage,
    });

    const reservation = await service.reserve({
      organizationId: context.organizationId,
      label: body.label,
      assetRole: body.assetRole,
    });

    return NextResponse.json(reservation, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
