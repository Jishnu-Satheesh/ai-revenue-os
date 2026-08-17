import { NextResponse } from "next/server";
import { z } from "zod";

import { apiErrorResponse } from "@/lib/api/organization-context";
import {
  applyOperatorEdit,
  operatorEditSchema,
} from "@/modules/campaigns/application/operator-edit";
import {
  campaignRouteContext,
  parseCampaignId,
  parseJsonBody,
} from "@/modules/campaigns/application/route-context";
import {
  createCampaignReadRepository,
  createCampaignVersionWriter,
} from "@/modules/campaigns/infrastructure/repository";
import type { CampaignPersistence } from "@/modules/campaigns/infrastructure/repository";
import { readAssetStoragePaths } from "@/modules/campaigns/infrastructure/asset-preview";
import { readRestrictedTerms } from "@/modules/campaigns/infrastructure/snapshot-reader";

const editRequestSchema = z.strictObject({
  baseVersionId: z.string().uuid(),
  baseDigest: z.string().regex(/^[0-9a-f]{64}$/),
  edit: operatorEditSchema,
});

/**
 * Writes an operator's own words as a new version, immediately.
 *
 * No model, no run to wait on: the operator typed it, the platform validates
 * it, and a version exists when the response arrives. That is the difference
 * from the revision endpoint next door, and it is why they are two calls rather
 * than one button — telling someone their edit is "queued" when it is already
 * saved, or "saved" when a model has yet to see it, would be a lie in one
 * direction or the other.
 *
 * The base version and digest are exact. An operator editing in a tab left open
 * since yesterday must not overwrite work they never read.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; campaignId: string }> },
) {
  try {
    const { campaignId: raw } = await params;
    const context = await campaignRouteContext(params, "campaign.edit");
    const body = editRequestSchema.parse(await parseJsonBody(request));
    const campaignId = parseCampaignId(raw);

    const repository = createCampaignReadRepository(
      context.supabase as unknown as CampaignPersistence,
    );
    const base = await repository.getVersion(context.organizationId, body.baseVersionId);
    if (!base || base.campaignId !== campaignId) {
      return apiErrorResponse(new Error("This version is not available."));
    }
    if (base.digest !== body.baseDigest) {
      return apiErrorResponse(
        new Error("This proposal changed since you read it. Reload and try again."),
      );
    }

    // Read from the snapshot this version was pinned to, so hand-typed copy is
    // held to the same restricted terms the generated copy was.
    const restrictedTerms = await readRestrictedTerms(context.supabase as never, {
      organizationId: context.organizationId,
      sourceSnapshotId: base.sourceSnapshotId,
    });
    if (restrictedTerms === null) {
      return apiErrorResponse(
        new Error("The evidence this campaign was built on could not be read. Try again."),
      );
    }

    const applied = applyOperatorEdit({
      base: base.manifest,
      edit: body.edit,
      restrictedTerms,
    });

    if (applied.outcome === "rejected") {
      return apiErrorResponse(new Error(applied.message));
    }

    // Assets are never patchable, so the new version carries exactly the images
    // the base version did. Re-deriving the paths rather than trusting the
    // client keeps the only route to stored bytes on the server.
    const assetStoragePaths = await readAssetStoragePaths(context.supabase as never, {
      organizationId: context.organizationId,
      bundleVersionId: base.id,
    });

    const created = await createCampaignVersionWriter(
      context.supabase as unknown as CampaignPersistence,
    ).createVersion({
      organizationId: context.organizationId,
      campaignId,
      sourceSnapshotId: base.sourceSnapshotId,
      manifest: applied.manifest,
      digest: applied.digest,
      assetStoragePaths,
    });

    return NextResponse.json(
      {
        bundleVersionId: created.bundleVersionId,
        version: created.version,
        digest: applied.digest,
        changeCount: applied.diff.changes.length,
        invalidatesApproval: applied.diff.invalidatesApproval,
      },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
