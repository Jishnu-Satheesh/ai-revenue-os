import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { apiErrorResponse, publishOrganizationEvent } from "@/lib/api/organization-context";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  createApprovedGenerationCapReader,
  generationDispatchAllowed,
  type ProposalCapPersistence,
} from "@/modules/campaigns/application/generation-cap";
import { decideGenerationRetry } from "@/modules/campaigns/application/generation-retry";
import { generateRequestSchema } from "@/modules/campaigns/application/api-schemas";
import { generationCostCeilingMinor } from "@/modules/campaigns/infrastructure/generation-dispatch";
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
 *
 * Never auto-fires: this only runs on an explicit POST from the Generate
 * control. Approval authorized the purse; this click spends it, inside the
 * approved ceiling checked below.
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

    // The approved purse, checked before anything billable is queued. A
    // proposal-born campaign spends its proposal's generation ceiling; any
    // other campaign has no proposal behind it and keeps existing behavior.
    if (campaign.sourceKind === "campaign_proposal") {
      const approval = await createApprovedGenerationCapReader(
        context.supabase as unknown as ProposalCapPersistence,
      ).readApprovedCeiling({ organizationId: context.organizationId, campaignId });
      const decision = generationDispatchAllowed({
        approvedCeilingMinor: approval.ceilingMinor,
        dispatchCeilingMinor: generationCostCeilingMinor(),
      });
      if (!decision.allowed) {
        throw new DomainError(
          "DOMAIN_ERROR",
          decision.reasonCode === "generation_budget_exceeded"
            ? "Starting generation would allow more preparation spend than the approved proposal permits. Ask an owner to review the proposal first."
            : "The approved proposal behind this campaign could not be read, so generation cannot start. Reload and try again.",
        );
      }
    }

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

    // Announced once per run, not per click: a double-click replays the same
    // run and must not announce a second generation that never started.
    if (!replayed) {
      try {
        await publishOrganizationEvent({
          organizationId: context.organizationId,
          userId: context.user.id,
          eventName: "campaign.generation_started",
          payload: { campaignId, runId },
        });
      } catch {
        // The run stands with or without its announcement: the run row is the
        // record, the event is a notification about it. Failing the request
        // here would report an error over work that happened — and the button
        // mints a fresh idempotency key per click, so the retry would enqueue
        // a second run and spend the purse twice. So the loss is logged, with
        // the identifiers needed to reconcile it, and the saved run is still
        // returned.
        logger.warn("campaign.generation_started_announcement_failed", {
          organizationId: context.organizationId,
          campaignId,
          runId,
        });
      }
    }

    return NextResponse.json({ runId, replayed }, { status: replayed ? 200 : 202 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * The evidence this campaign would generate from now. Reads stay inside RLS.
 *
 * Explicitly the newest. A campaign used to have exactly one snapshot, so this
 * took whichever row came back and the question never arose; repairing a
 * campaign's evidence pins a second one, and "whichever row the planner
 * happened to return" would then decide what a run is built from.
 */
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
          ): {
            order(
              column: string,
              options: { ascending: boolean },
            ): {
              order(
                column: string,
                options: { ascending: boolean },
              ): {
                limit(count: number): Promise<{ data: { id: string }[] | null; error: unknown }>;
              };
            };
          };
        };
      };
    };
  };
  const { data } = await client
    .from("campaign_source_snapshots")
    .select("id")
    .eq("organization_id", context.organizationId)
    .eq("campaign_id", campaignId)
    // The id breaks a tie between two snapshots captured in the same instant,
    // so the answer is stable rather than whichever the planner returned first.
    .order("captured_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  const [row] = data ?? [];
  if (!row) throw new Error("This campaign has no pinned evidence to generate from.");
  return row.id;
}
