import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/organization-context";
import { campaignRouteContext } from "@/modules/campaigns/application/route-context";
import {
  readPosterTemplates,
  type PosterStudioPersistence,
} from "@/modules/campaigns/infrastructure/poster-studio-reader";

/**
 * The poster template catalogue this member may choose from.
 *
 * Organization-scoped rather than campaign-scoped because the catalogue is not
 * a property of any one campaign: core templates are platform registry, and an
 * organization's own templates belong to the tenant. RLS decides which rows
 * come back -- a template owned by another organization is never returned
 * rather than filtered out here.
 *
 * Guarded by `campaign.read`, which a viewer holds. Reading what a poster could
 * look like is not producing one; `poster.render` guards that.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const context = await campaignRouteContext(params, "campaign.read");

    const { templates, unreadable } = await readPosterTemplates(
      context.supabase as unknown as PosterStudioPersistence,
    );

    return NextResponse.json({
      templates,
      // Named rather than dropped. A catalogue row the application cannot read
      // means the two disagree, and a silent gap reads as a missing feature.
      unreadableTemplates: unreadable,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
