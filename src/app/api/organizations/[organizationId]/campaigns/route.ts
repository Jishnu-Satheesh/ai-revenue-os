import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/lib/api/organization-context";
import { createCampaignRequestSchema } from "@/modules/campaigns/application/api-schemas";
import { createCampaignService } from "@/modules/campaigns/application/service";
import { campaignRouteContext, parseJsonBody } from "@/modules/campaigns/application/route-context";
import { createCampaignReadRepository } from "@/modules/campaigns/infrastructure/repository";
import type { CampaignPersistence } from "@/modules/campaigns/infrastructure/repository";
import {
  createCampaignCreationStore,
  createOrganizationFactsReader,
  type CampaignCreationPersistence,
} from "@/modules/campaigns/infrastructure/creation-repository";
import { createTriggerGenerationDispatcher } from "@/modules/campaigns/infrastructure/generation-dispatch";
import { createCampaignRunDispatcher } from "@/modules/campaigns/infrastructure/run-repository";
import type { CampaignRunPersistence } from "@/modules/campaigns/infrastructure/run-repository";
import { createEventPublisher } from "@/domain/events/publisher";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const context = await campaignRouteContext(params, "campaign.read");
    const repository = createCampaignReadRepository(
      context.supabase as unknown as CampaignPersistence,
    );
    const campaigns = await repository.listCampaigns(context.organizationId);
    return NextResponse.json({ campaigns });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const context = await campaignRouteContext(params, "campaign.create");
    const body = createCampaignRequestSchema.parse(await parseJsonBody(request));

    const creation = context.supabase as unknown as CampaignCreationPersistence;
    const facts = createOrganizationFactsReader(creation);

    // Read before the write so the campaign and its pinned snapshot are created
    // in one call with the evidence already in hand.
    const verified = await facts.readVerifiedFacts(context.organizationId);

    const service = createCampaignService({
      read: createCampaignReadRepository(context.supabase as unknown as CampaignPersistence),
      review: createCampaignReadRepository(context.supabase as unknown as CampaignPersistence),
      store: createCampaignCreationStore(creation, {
        title: body.title,
        brief: body.brief ?? null,
        facts: verified.facts,
        brandAssetVersionIds: verified.brandAssetVersionIds,
        assertions: [],
      }),
      facts,
      generation: createTriggerGenerationDispatcher(
        createCampaignRunDispatcher(context.supabase as unknown as CampaignRunPersistence),
      ),
      events: createEventPublisher(),
    });

    const created = await service.create(context.organizationId, context.user.id, body);

    // A replay is not a creation. Reporting 201 twice would tell a retrying
    // client it made two campaigns.
    return NextResponse.json(created, { status: created.replayed ? 200 : 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
