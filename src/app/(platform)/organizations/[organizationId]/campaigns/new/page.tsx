import { Megaphone } from "lucide-react";

import { NewCampaignBrief } from "@/components/campaigns/new-campaign-brief";
import { RegisterRouteLabel } from "@/components/layout/route-context";
import { getOrganization } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";

type PageProps = { params: Promise<{ organizationId: string }> };

export default async function NewCampaignPage({ params }: PageProps) {
  const context = await getOrganizationContext(params);
  const organization = await getOrganization(context.supabase, context.organizationId);

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

      <NewCampaignBrief organizationId={context.organizationId} />
    </div>
  );
}
