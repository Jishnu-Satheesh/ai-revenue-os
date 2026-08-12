import { Megaphone } from "lucide-react";

import { CampaignPortfolio } from "@/components/campaigns/campaign-portfolio";
import { RegisterRouteLabel } from "@/components/layout/route-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getOrganization } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { demoCampaigns } from "@/modules/campaigns/demo/fixtures";

type PageProps = { params: Promise<{ organizationId: string }> };

export default async function CampaignsPage({ params }: PageProps) {
  const context = await getOrganizationContext(params);
  const organization = await getOrganization(context.supabase, context.organizationId);

  return (
    <div className="flex min-h-0 flex-col gap-6">
      <RegisterRouteLabel segment={context.organizationId} label={organization.name} />
      <div className="flex shrink-0 items-start gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <Megaphone />
        </span>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Campaigns</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {organization.name} · proposals, review, approval, and business proof
          </p>
        </div>
      </div>

      {/* Stated once, at the top, so nothing further down has to carry the
          caveat and nobody mistakes a proposal for something already running. */}
      <Alert>
        <AlertTitle>Preview with sample campaigns</AlertTitle>
        <AlertDescription>
          These campaigns are illustrative. No provider is connected, nothing has been published,
          and no business result is shown, because none has been measured.
        </AlertDescription>
      </Alert>

      <CampaignPortfolio
        organizationId={context.organizationId}
        campaigns={demoCampaigns}
        timeZone={organization.default_timezone}
      />
    </div>
  );
}
