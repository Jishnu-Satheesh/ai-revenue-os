import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/organization-context";
import { DomainError } from "@/lib/errors";
import { decideGenerationRetry } from "@/modules/campaigns/application/generation-retry";
import { generateRequestSchema } from "@/modules/campaigns/application/api-schemas";
import {
  campaignRouteContext,
  parseCampaignId,
  parseJsonBody,
} from "@/modules/campaigns/application/route-context";
import { createCampaignReadRepository } from "@/modules/campaigns/infrastructure/repository";
import type { CampaignPersistence } from "@/modules/campaigns/infrastructure/repository";
import { createCampaignRunDispatcher } from "@/modules/campaigns/infrastructure/run-repository";
import { createTriggerGenerationDispatcher } from "@/modules/campaigns/infrastructure/generation-dispatch";
import type { CampaignRunPersistence } from "@/modules/campaigns/infrastructure/run-repository";

/**
 * Queues a generation run. Nothing is generated in the request.
 *
 * The route records durable intent and returns; the worker does the work. A
 * model call inside an HTTP request would tie an expensive, slow operation to a
 * timeout and leave a half-built version behind when it expired.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; campaignId: string }> },
) {
  try {
    const { campaignId: raw } = await params;
    const context = await campaignRouteContext(params, "campaign.edit");
    const body = generateRequestSchema.parse(await parseJsonBody(request));
    const campaignId = parseCampaignId(raw);

    const repository = createCampaignReadRepository(
      context.supabase as unknown as CampaignPersistence,
    );
    const campaign = await repository.getCampaign(context.organizationId, campaignId);
    if (!campaign) return apiErrorResponse(new Error("This campaign is not available."));

    const snapshotId = await latestSnapshotId(context, campaignId);

    // A retry that cannot go differently is refused before anything is queued.
    //
    // "Generate again" wakes a worker and calls an image model. When the last
    // attempt died on something that has not changed since — an out-of-date
    // provider contract, evidence that is gone — pressing it again buys the
    // identical failure and bills for it. A request against different pinned
    // evidence is a different question and is always allowed through.
    const retry = decideGenerationRetry({
      latestRun: await repository.latestGenerationRun(context.organizationId, campaignId),
      requestedSourceSnapshotId: snapshotId,
    });
    if (retry.outcome === "refused") {
      throw new DomainError("DOMAIN_ERROR", `${retry.clientCopy} ${retry.nextAction}`);
    }

    // Enqueues the run *and* hands it to the worker. Recording intent without
    // dispatching is the failure this route exists to recover from, so it must
    // not be the failure this route creates.
    const { runId, replayed } = await createTriggerGenerationDispatcher(
      createCampaignRunDispatcher(context.supabase as unknown as CampaignRunPersistence),
    ).enqueueGeneration({
      organizationId: context.organizationId,
      campaignId,
      sourceSnapshotId: snapshotId,
      idempotencyKey: body.idempotencyKey,
      correlationId: randomUUID(),
    });

    return NextResponse.json({ runId, replayed }, { status: replayed ? 200 : 202 });
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
