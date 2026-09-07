import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/organization-context";
import {
  campaignRouteContext,
  parseCampaignId,
} from "@/modules/campaigns/application/route-context";
import { createCampaignReadRepository } from "@/modules/campaigns/infrastructure/repository";
import type { CampaignPersistence } from "@/modules/campaigns/infrastructure/repository";
import {
  readPosterStudioView,
  type PosterStudioPersistence,
} from "@/modules/campaigns/infrastructure/poster-studio-reader";

/**
 * What the Creative Studio can offer for one version of one campaign.
 *
 * Every template is returned, usable or not, with the reason attached when it
 * is not. That is the whole shape of the response and it is deliberate: an
 * operator who cannot find a template concludes the platform is broken, while
 * one who sees it greyed out with "this campaign has no governed offer line"
 * learns what is actually missing.
 *
 * `campaign.read` guards it, so a viewer can see what a poster would say
 * without being able to produce one.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; campaignId: string }> },
) {
  try {
    const { campaignId: raw } = await params;
    const context = await campaignRouteContext(params, "campaign.read");
    const campaignId = parseCampaignId(raw);

    const url = new URL(request.url);
    const bundleVersionId = url.searchParams.get("bundleVersionId");

    // Defaulting to "the newest version" would quietly change what an operator
    // is looking at the moment a revision lands, so the version is named.
    const versionId = bundleVersionId ?? (await newestVersionId(context, campaignId));
    if (!versionId) {
      return apiErrorResponse(new Error("This campaign has no version to render from yet."));
    }

    const view = await readPosterStudioView(
      createCampaignReadRepository(context.supabase as unknown as CampaignPersistence),
      context.supabase as unknown as PosterStudioPersistence,
      context.organizationId,
      campaignId,
      versionId,
    );

    if (!view) return apiErrorResponse(new Error("This version is not available."));

    return NextResponse.json(view);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** The version an operator would be looking at if they named none. */
async function newestVersionId(
  context: { supabase: unknown; organizationId: string },
  campaignId: string,
): Promise<string | null> {
  const repository = createCampaignReadRepository(
    context.supabase as unknown as CampaignPersistence,
  );
  const versions = await repository.listVersions(context.organizationId, campaignId);
  return versions[0]?.id ?? null;
}
