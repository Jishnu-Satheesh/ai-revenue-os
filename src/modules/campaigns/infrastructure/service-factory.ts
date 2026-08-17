import type { SupabaseClient } from "@supabase/supabase-js";

import { createEventPublisher } from "@/domain/events/publisher";
import { createCampaignService } from "@/modules/campaigns/application/service";
import { createCampaignReadRepository } from "@/modules/campaigns/infrastructure/repository";
import type { CampaignPersistence } from "@/modules/campaigns/infrastructure/repository";
import {
  createGenerationDispatcher,
  createOrganizationFactsReader,
  type CampaignCreationPersistence,
} from "@/modules/campaigns/infrastructure/creation-repository";
import { createCampaignRunDispatcher } from "@/modules/campaigns/infrastructure/run-repository";
import type { CampaignRunPersistence } from "@/modules/campaigns/infrastructure/run-repository";

/**
 * The campaign service, wired for a read or review request.
 *
 * Every dependency is built over the caller's own session client, so RLS is the
 * boundary throughout. The creation store is deliberately absent: creating a
 * campaign needs the pinned evidence in hand and is composed in its own route.
 */
export function campaignServiceFor(context: { supabase: SupabaseClient<never> | unknown }) {
  const client = context.supabase;
  const repository = createCampaignReadRepository(client as CampaignPersistence);

  return createCampaignService({
    read: repository,
    review: repository,
    store: {
      // Reached only by `create`, which this factory does not serve. Failing
      // loudly beats returning a plausible id nobody wrote.
      createBrief: () => Promise.reject(new Error("Campaign creation uses its own composition.")),
      createCampaign: () =>
        Promise.reject(new Error("Campaign creation uses its own composition.")),
      createSourceSnapshot: () =>
        Promise.reject(new Error("Campaign creation uses its own composition.")),
    },
    facts: createOrganizationFactsReader(client as CampaignCreationPersistence),
    generation: createGenerationDispatcher(
      createCampaignRunDispatcher(client as CampaignRunPersistence),
    ),
    events: createEventPublisher(),
  });
}
