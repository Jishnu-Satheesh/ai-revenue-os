import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { DomainError } from "@/lib/errors";
import { apiErrorResponse } from "@/lib/api/organization-context";
import { checkOperatorSlotText } from "@/domain/campaigns/poster-slots";
import { posterRenderRequestSchema } from "@/modules/campaigns/application/api-schemas";
import {
  campaignRouteContext,
  parseCampaignId,
  parseJsonBody,
} from "@/modules/campaigns/application/route-context";
import { createCampaignReadRepository } from "@/modules/campaigns/infrastructure/repository";
import type { CampaignPersistence } from "@/modules/campaigns/infrastructure/repository";
import { dispatchPosterRender } from "@/modules/campaigns/infrastructure/poster-dispatch";
import { toVariantEvidence } from "@/modules/campaigns/infrastructure/variant-readers";

/**
 * Queues one poster render.
 *
 * Guarded by `poster.render`, which owner, admin and operator hold and a viewer
 * does not -- rendering spends a machine and writes a row nobody can delete,
 * while reading one is `campaign.read`.
 *
 * Nothing is drawn in the request. The route records intent and returns; the
 * worker composites. A render is content-addressed, so a retried request
 * reaches the row it already wrote rather than making a second one.
 *
 * The one interesting check here is the free text box. Everything else a poster
 * draws is quoted from the approved manifest, so it is governed by
 * construction; `extra` is typed by a person and is the one place "50% off"
 * could be smuggled onto artwork no approval covers. It is checked against the
 * campaign's own evidence before anything is queued, using the same rule
 * generated variant copy answers to.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; campaignId: string }> },
) {
  try {
    const { campaignId: raw } = await params;
    const context = await campaignRouteContext(params, "poster.render");
    const body = posterRenderRequestSchema.parse(await parseJsonBody(request));
    const campaignId = parseCampaignId(raw);

    const repository = createCampaignReadRepository(
      context.supabase as unknown as CampaignPersistence,
    );
    const version = await repository.getVersion(context.organizationId, body.bundleVersionId);
    if (!version || version.campaignId !== campaignId) {
      return apiErrorResponse(new Error("This version is not available."));
    }

    // The digest an operator read. A stale tab would otherwise render words
    // from a proposal that has since changed, under a version number that
    // suggests somebody reviewed them.
    if (version.digest !== body.bundleDigest) {
      return apiErrorResponse(
        new Error("This proposal changed since you read it. Reload and try again."),
      );
    }

    if (body.extra !== null) {
      const evidence = toVariantEvidence(version.manifest, await pinnedFacts(context, campaignId));
      const admitted = checkOperatorSlotText(body.extra, evidence);
      if (!admitted.admitted) {
        throw new DomainError(
          "VALIDATION_ERROR",
          `That line cannot be drawn: ${admitted.failures.map((failure) => failure.detail).join(" ")}`,
        );
      }
    }

    const { workerId } = await dispatchPosterRender({
      organizationId: context.organizationId,
      campaignId,
      bundleVersionId: body.bundleVersionId,
      plateAssetId: body.plateAssetId,
      correlationId: randomUUID(),
      templateKey: body.templateKey,
      templateVersion: body.templateVersion,
      script: body.script,
      directionId: body.directionId,
      channel: body.channel,
      extra: body.extra,
    });

    return NextResponse.json({ workerId }, { status: 202 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** The evidence this campaign was pinned to. Read inside RLS. */
async function pinnedFacts(
  context: { supabase: unknown; organizationId: string },
  campaignId: string,
): Promise<Record<string, unknown>> {
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
          ): Promise<{ data: { facts: unknown }[] | null; error: unknown }>;
        };
      };
    };
  };
  const { data } = await client
    .from("campaign_source_snapshots")
    .select("facts")
    .eq("organization_id", context.organizationId)
    .eq("campaign_id", campaignId);
  const [row] = data ?? [];
  // No snapshot means no evidence, which makes every claim unsupported rather
  // than every claim allowed. The check below is stricter, not looser, for it.
  return (row?.facts ?? {}) as Record<string, unknown>;
}
