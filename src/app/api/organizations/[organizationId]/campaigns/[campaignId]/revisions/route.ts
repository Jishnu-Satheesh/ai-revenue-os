import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/organization-context";
import { revisionRequestSchema } from "@/modules/campaigns/application/api-schemas";
import {
  campaignRouteContext,
  parseCampaignId,
  parseJsonBody,
} from "@/modules/campaigns/application/route-context";
import { createCampaignReadRepository } from "@/modules/campaigns/infrastructure/repository";
import type { CampaignPersistence } from "@/modules/campaigns/infrastructure/repository";
import { createCampaignRunDispatcher } from "@/modules/campaigns/infrastructure/run-repository";
import type { CampaignRunPersistence } from "@/modules/campaigns/infrastructure/run-repository";

/**
 * Queues a prompt revision against an exact version.
 *
 * The base version and digest are checked here and again in the worker. If the
 * campaign moved on while the operator was typing, their words must not be
 * applied to a version they never read.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; campaignId: string }> },
) {
  try {
    const { campaignId: raw } = await params;
    const context = await campaignRouteContext(params, "campaign.edit");
    const body = revisionRequestSchema.parse(await parseJsonBody(request));
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

    const { runId, replayed } = await createCampaignRunDispatcher(
      context.supabase as unknown as CampaignRunPersistence,
    ).enqueue({
      organizationId: context.organizationId,
      campaignId,
      // The revision inherits the evidence the base version was built on.
      sourceSnapshotId: base.sourceSnapshotId,
      kind: "revise",
      idempotencyKey: body.idempotencyKey,
      correlationId: randomUUID(),
      baseVersionId: body.baseVersionId,
      baseDigest: body.baseDigest,
      operatorPrompt: body.prompt,
      patchScope: body.scope.kind,
    });

    return NextResponse.json({ runId, replayed }, { status: replayed ? 200 : 202 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
