import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/organization-context";
import { variantsRequestSchema } from "@/modules/campaigns/application/api-schemas";
import {
  campaignRouteContext,
  parseCampaignId,
  parseJsonBody,
} from "@/modules/campaigns/application/route-context";
import { createCampaignReadRepository } from "@/modules/campaigns/infrastructure/repository";
import type { CampaignPersistence } from "@/modules/campaigns/infrastructure/repository";
import { createCampaignRunDispatcher } from "@/modules/campaigns/infrastructure/run-repository";
import type { CampaignRunPersistence } from "@/modules/campaigns/infrastructure/run-repository";
import { createTriggerVariantDispatcher } from "@/modules/campaigns/infrastructure/generation-dispatch";
import { createCampaignVariantStore } from "@/modules/campaigns/infrastructure/variant-repository";
import type { CampaignVariantPersistence } from "@/modules/campaigns/infrastructure/variant-repository";
import { remainingCapacity } from "@/modules/campaigns/application/variant-service";

/**
 * Queues a variant run for an already-approved version.
 *
 * Guarded by `campaign.edit`, which is the permission that changes a campaign's
 * creative. It is also the one campaign permission that appears identically —
 * same name, same roles — in both the role map this route reads and the newer
 * account catalogue, so this route lands on the same answer whichever of the
 * two becomes authoritative. Inventing a permission would have added a third
 * spelling to an area that already has two.
 *
 * Nothing is generated in the request. The route records durable intent and
 * returns; a model call inside an HTTP request would tie forty minutes of image
 * work to a timeout.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; campaignId: string }> },
) {
  try {
    const { campaignId: raw } = await params;
    const context = await campaignRouteContext(params, "campaign.edit");
    const body = variantsRequestSchema.parse(await parseJsonBody(request));
    const campaignId = parseCampaignId(raw);

    const repository = createCampaignReadRepository(
      context.supabase as unknown as CampaignPersistence,
    );
    const version = await repository.getVersion(context.organizationId, body.bundleVersionId);
    if (!version || version.campaignId !== campaignId) {
      return apiErrorResponse(new Error("This version is not available."));
    }

    // The digest an operator read, checked before anything is queued. A stale
    // tab would otherwise ask for creative under a proposal that has changed.
    if (version.digest !== body.bundleDigest) {
      return apiErrorResponse(
        new Error("This proposal changed since you read it. Reload and try again."),
      );
    }

    const snapshotId = await latestSnapshotId(context, campaignId);

    const { runId, replayed } = await createTriggerVariantDispatcher(
      createCampaignRunDispatcher(context.supabase as unknown as CampaignRunPersistence),
    ).enqueueVariants({
      organizationId: context.organizationId,
      campaignId,
      sourceSnapshotId: snapshotId,
      bundleVersionId: body.bundleVersionId,
      bundleDigest: body.bundleDigest,
      perDirection: body.perDirection,
      idempotencyKey: body.idempotencyKey,
      correlationId: randomUUID(),
    });

    return NextResponse.json({ runId, replayed }, { status: replayed ? 200 : 202 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * What has been produced under this version so far, and what room is left.
 *
 * Remaining capacity is returned rather than left for the caller to compute:
 * the caps live in the manifest, and a screen that did the arithmetic itself
 * would eventually do it differently from the database.
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
    if (!bundleVersionId) {
      return apiErrorResponse(new Error("A bundle version is required."));
    }

    const repository = createCampaignReadRepository(
      context.supabase as unknown as CampaignPersistence,
    );
    const version = await repository.getVersion(context.organizationId, bundleVersionId);
    if (!version || version.campaignId !== campaignId) {
      return apiErrorResponse(new Error("This version is not available."));
    }

    const store = createCampaignVariantStore(
      context.supabase as unknown as CampaignVariantPersistence,
    );
    const capacity = await store.readCapacity(context.organizationId, bundleVersionId);

    return NextResponse.json({
      usedInTotal: capacity.usedInTotal,
      usedByDirection: capacity.usedByDirection,
      remaining: Object.fromEntries(
        version.manifest.directions.map((direction) => [
          direction.id,
          remainingCapacity(version.manifest, {
            usedInDirection: capacity.usedByDirection[direction.id] ?? 0,
            usedInTotal: capacity.usedInTotal,
          }),
        ]),
      ),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** The snapshot this campaign was created with. Reads stay inside RLS. */
async function latestSnapshotId(
  context: { supabase: unknown; organizationId: string },
  campaignId: string,
): Promise<string> {
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
          ): Promise<{ data: { id: string }[] | null; error: unknown }>;
        };
      };
    };
  };
  const { data } = await client
    .from("campaign_source_snapshots")
    .select("id")
    .eq("organization_id", context.organizationId)
    .eq("campaign_id", campaignId);
  const [row] = data ?? [];
  if (!row) throw new Error("This campaign has no pinned evidence to generate from.");
  return row.id;
}
