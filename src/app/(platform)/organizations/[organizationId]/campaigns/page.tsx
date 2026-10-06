import { Megaphone } from "lucide-react";

import { CampaignPortfolio } from "@/components/campaigns/campaign-portfolio";
import { RegisterRouteLabel } from "@/components/layout/route-context";
import { getOrganization } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { createCampaignReadRepository } from "@/modules/campaigns/infrastructure/repository";
import type { CampaignPersistence } from "@/modules/campaigns/infrastructure/repository";
import { readCampaignList } from "@/modules/campaigns/infrastructure/studio-reader";
import {
  readListPreviewUrls,
  type ListAssetPathReader,
} from "@/modules/campaigns/infrastructure/asset-preview";
import { listMetricTargets } from "@/modules/metrics/infrastructure/repository";

type PageProps = { params: Promise<{ organizationId: string }> };

export default async function CampaignsPage({ params }: PageProps) {
  const context = await getOrganizationContext(params);
  const organization = await getOrganization(context.supabase, context.organizationId);

  // The session's own client, so RLS decides what this member may list. There
  // is no service-role read anywhere in this path.
  const campaigns = await readCampaignList(
    createCampaignReadRepository(context.supabase as unknown as CampaignPersistence),
    context.organizationId,
  );

  // Signed against the caller's own session, so the private bucket is reached
  // with the member's permissions rather than around them. A signing failure
  // costs a thumbnail and nothing else.
  const previewUrls = await readListPreviewUrls(
    context.supabase as unknown as ListAssetPathReader,
    context.supabase as never,
    {
      organizationId: context.organizationId,
      bundleVersionIds: campaigns
        .map((campaign) => campaign.bundleVersionId)
        .filter((id): id is string => id !== null),
    },
  );

  // The measures a campaign missing its primary metric may be repaired with:
  // shared vocabulary plus this organization's own. Read here rather than
  // fetched by the dialog, so opening it costs nothing. A read failure costs
  // the dropdown and nothing else — the page still renders.
  const metricOptions = await listMetricTargets(
    context.supabase as never,
    context.organizationId,
  ).catch(() => []);

  return (
    <div className="flex min-h-0 flex-col gap-6">
      <RegisterRouteLabel segment={context.organizationId} label={organization.name} />
      <div className="flex shrink-0 items-start gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <Megaphone />
        </span>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Campaigns</h1>
          <p className="mt-1 text-sm text-muted-foreground">{organization.name}</p>
        </div>
      </div>

      <CampaignPortfolio
        organizationId={context.organizationId}
        campaigns={campaigns}
        timeZone={organization.default_timezone}
        previewUrls={previewUrls}
        metricOptions={metricOptions.map((option) => ({
          key: option.key,
          label: option.label,
          valueKind: option.valueKind,
        }))}
        currency={organization.base_currency}
      />
    </div>
  );
}
