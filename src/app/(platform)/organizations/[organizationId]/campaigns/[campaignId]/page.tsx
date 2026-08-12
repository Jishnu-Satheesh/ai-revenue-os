import { notFound } from "next/navigation";
import { Megaphone } from "lucide-react";

import { CampaignStudio } from "@/components/campaigns/campaign-studio";
import { RegisterRouteLabel } from "@/components/layout/route-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { getOrganization } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { findDemoCampaign } from "@/modules/campaigns/demo/fixtures";

type PageProps = { params: Promise<{ organizationId: string; campaignId: string }> };

export default async function CampaignDetailPage({ params }: PageProps) {
  const resolved = await params;
  const context = await getOrganizationContext(Promise.resolve(resolved));
  const organization = await getOrganization(context.supabase, context.organizationId);
  const campaign = findDemoCampaign(resolved.campaignId);

  if (!campaign) notFound();

  return (
    <div className="flex min-h-0 flex-col gap-6">
      <RegisterRouteLabel segment={context.organizationId} label={organization.name} />
      <RegisterRouteLabel segment={resolved.campaignId} label={campaign.title} />

      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <Megaphone />
          </span>
          <div>
            <h1 className="flex flex-wrap items-center gap-2 text-3xl font-semibold tracking-tight">
              {campaign.title}
              {/* The dry-run state is part of the header, not a footnote: it is
                  the difference between a proposal and a public action. */}
              {campaign.dryRun ? <Badge variant="secondary">Dry run</Badge> : null}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {campaign.sourceLabel} · version {campaign.version} · {organization.name}
            </p>
          </div>
        </div>
      </div>

      <Alert>
        <AlertTitle>Objective and hypothesis</AlertTitle>
        <AlertDescription className="flex flex-col gap-2">
          <span>{campaign.hypothesis}</span>
          <span className="text-xs">{campaign.rationale}</span>
        </AlertDescription>
      </Alert>

      <CampaignStudio campaign={campaign} />
    </div>
  );
}
