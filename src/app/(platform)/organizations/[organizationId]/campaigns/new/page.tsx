import { Megaphone } from "lucide-react";

import { NewCampaignBrief } from "@/components/campaigns/new-campaign-brief";
import { RegisterRouteLabel } from "@/components/layout/route-context";
import { getOrganization } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";

type PageProps = {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ objective?: string; audience?: string; offer?: string }>;
};

export default async function NewCampaignPage({ params, searchParams }: PageProps) {
  const context = await getOrganizationContext(params);
  const organization = await getOrganization(context.supabase, context.organizationId);
  // Prefill from the agent advice handoff (or any caller linking here):
  // plain strings, capped to the brief field limits. The form stays fully
  // editable — prefill is intent carried forward, never a decision made.
  const query = await searchParams;
  const initial = {
    objective: typeof query.objective === "string" ? query.objective.slice(0, 600) : "",
    audience: typeof query.audience === "string" ? query.audience.slice(0, 600) : "",
    offer: typeof query.offer === "string" ? query.offer.slice(0, 600) : "",
  };

  return (
    <div className="flex min-h-0 flex-col gap-6">
      <RegisterRouteLabel segment={context.organizationId} label={organization.name} />
      <RegisterRouteLabel segment="new" label="New brief" />

      <div className="flex shrink-0 items-start gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <Megaphone />
        </span>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">New campaign brief</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {organization.name} · the same pipeline a Decision Engine opportunity enters
          </p>
        </div>
      </div>

      <NewCampaignBrief
        organizationId={context.organizationId}
        initialObjective={initial.objective}
        initialAudience={initial.audience}
        initialOffer={initial.offer}
      />
    </div>
  );
}
