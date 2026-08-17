import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/organization-context";
import { brandAssetCompleteRequestSchema } from "@/modules/campaigns/application/api-schemas";
import { campaignRouteContext, parseJsonBody } from "@/modules/campaigns/application/route-context";
import { createBrandAssetService } from "@/modules/campaigns/application/brand-asset-service";
import {
  createBrandAssetStore,
  createSupabaseBrandAssetObjectStore,
  type BrandAssetPersistence,
} from "@/modules/campaigns/infrastructure/brand-asset-repository";
import { ingestCampaignImage } from "@/modules/campaigns/infrastructure/asset-intake";

/**
 * Finalizes an upload by reading the bytes back and deciding from them alone.
 *
 * The request carries no MIME type and no dimensions on purpose: those are read
 * out of the stored object. A rejection is a 200 with a reason, not an error —
 * "your file was not a usable image" is an ordinary answer an operator acts on.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; uploadId: string }> },
) {
  try {
    const context = await campaignRouteContext(params, "campaign.edit");
    const body = brandAssetCompleteRequestSchema.parse(await parseJsonBody(request));

    const service = createBrandAssetService({
      store: createBrandAssetStore(context.supabase as unknown as BrandAssetPersistence),
      objects: createSupabaseBrandAssetObjectStore(
        context.supabase as unknown as Parameters<typeof createSupabaseBrandAssetObjectStore>[0],
      ),
      ingest: ingestCampaignImage,
    });

    const result = await service.complete({
      organizationId: context.organizationId,
      versionId: body.versionId,
      storagePath: `${context.organizationId}/${body.brandAssetId}/${body.versionId}/source`,
    });

    return NextResponse.json(result, { status: result.status === "usable" ? 201 : 200 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
