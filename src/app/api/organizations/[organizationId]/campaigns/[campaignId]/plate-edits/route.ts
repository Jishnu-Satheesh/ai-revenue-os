import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { DomainError } from "@/lib/errors";
import { apiErrorResponse } from "@/lib/api/organization-context";
import { admitPlateEdit } from "@/domain/campaigns/plate-edit";
import { approvalStatus } from "@/domain/campaigns/state-machine";
import { plateEditRequestSchema } from "@/modules/campaigns/application/api-schemas";
import {
  campaignRouteContext,
  parseCampaignId,
  parseJsonBody,
} from "@/modules/campaigns/application/route-context";
import { createCampaignReadRepository } from "@/modules/campaigns/infrastructure/repository";
import type { CampaignPersistence } from "@/modules/campaigns/infrastructure/repository";
import { dispatchPlateEdit } from "@/modules/campaigns/infrastructure/poster-dispatch";

/**
 * Queues one plate edit.
 *
 * Guarded by `campaign.edit`, which is the permission that changes a campaign's
 * creative. No new permission was invented: an edit is a creative change like
 * any other, and a third spelling in an area that already has two maps would
 * make the next reader guess which one decides.
 *
 * **The approval consequence is told before the edit, not after.** An edited
 * plate is a new version with a new digest, so an approval standing against the
 * parent stops applying the moment the worker writes. The response says whether
 * that is about to happen, because discovering it later -- when a dispatch
 * refuses for want of an approval nobody knew had lapsed -- is the failure this
 * feature is most likely to cause.
 *
 * The regions are admitted here as well as in the worker. Not belt and braces:
 * refusing an unusable region in the request lets the operator fix it while
 * they are still looking at the canvas, instead of finding a refused row later.
 *
 * This check reads the size `campaign_assets` records, which is a declaration
 * rather than a measurement -- the worker decodes the bytes and admits again
 * against what it finds. So this one is advisory and the worker is
 * authoritative, which is the safe direction: an over-large declared size can
 * let a bad region through to a worker that refuses it, where an under-large
 * one would reject a region that is genuinely inside the picture.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; campaignId: string }> },
) {
  try {
    const { campaignId: raw } = await params;
    const context = await campaignRouteContext(params, "campaign.edit");
    const body = plateEditRequestSchema.parse(await parseJsonBody(request));
    const campaignId = parseCampaignId(raw);

    const repository = createCampaignReadRepository(
      context.supabase as unknown as CampaignPersistence,
    );
    const version = await repository.getVersion(context.organizationId, body.bundleVersionId);
    if (!version || version.campaignId !== campaignId) {
      return apiErrorResponse(new Error("This version is not available."));
    }

    if (version.digest !== body.bundleDigest) {
      return apiErrorResponse(
        new Error("This proposal changed since you read it. Reload and try again."),
      );
    }

    // Read from `campaign_assets` rather than from the manifest, because the
    // request names a row id and the manifest is keyed by the asset key that
    // survives every version. The row carries the pixel size anyway, so
    // translating between the two identifiers would buy nothing.
    const plate = await plateOfVersion(context, body.parentPlateAssetId, body.bundleVersionId);
    if (plate === null) {
      return apiErrorResponse(new Error("That plate is not part of this version."));
    }

    // Admitted against the plate's real size, so a stray drag or a region that
    // covers most of the image is refused while the operator can still see it.
    const admission = admitPlateEdit({
      annotations: body.annotations,
      plateWidthPx: plate.widthPx,
      plateHeightPx: plate.heightPx,
    });
    if (!admission.admitted) {
      throw new DomainError(
        "VALIDATION_ERROR",
        admission.refusals.map((refusal) => refusal.detail).join(" "),
      );
    }

    const approval = await repository.getLiveApproval(context.organizationId, campaignId);
    const invalidatesApproval = approvalStatus(
      approval,
      { bundleVersionId: body.bundleVersionId, bundleDigest: version.digest },
      new Date(),
    ).isApproved;

    const { workerId } = await dispatchPlateEdit({
      organizationId: context.organizationId,
      campaignId,
      bundleVersionId: body.bundleVersionId,
      parentPlateAssetId: body.parentPlateAssetId,
      correlationId: randomUUID(),
      editedBy: context.user.id,
      idempotencyKey: body.idempotencyKey,
      annotations: body.annotations,
    });

    return NextResponse.json(
      {
        workerId,
        unionCoverageRatio: admission.unionCoverageRatio,
        /**
         * Said out loud, before the edit runs. The operator is withdrawing an
         * approval by editing, and that should not be a surprise found later.
         */
        invalidatesApproval,
      },
      { status: 202 },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * The plate row, if it belongs to this tenant and this version.
 *
 * The version check is not redundant with the worker's: editing one version's
 * plate under another version's identity would produce a successor whose parent
 * is not the version it claims, and catching it here means the operator is told
 * rather than left watching a run that declines silently.
 */
async function plateOfVersion(
  context: { supabase: unknown; organizationId: string },
  plateAssetId: string,
  bundleVersionId: string,
): Promise<{ widthPx: number; heightPx: number } | null> {
  const client = context.supabase as {
    from(table: string): {
      select(columns: string): {
        eq(
          column: string,
          value: string,
        ): {
          eq(
            column: string,
            value: string,
          ): Promise<{
            data: { width_px: number; height_px: number; bundle_version_id: string }[] | null;
            error: unknown;
          }>;
        };
      };
    };
  };
  const { data } = await client
    .from("campaign_assets")
    .select("width_px, height_px, bundle_version_id")
    .eq("organization_id", context.organizationId)
    .eq("id", plateAssetId);

  const [row] = data ?? [];
  if (!row || row.bundle_version_id !== bundleVersionId) return null;
  return { widthPx: row.width_px, heightPx: row.height_px };
}
