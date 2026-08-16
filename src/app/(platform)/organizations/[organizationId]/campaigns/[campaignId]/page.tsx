import { notFound } from "next/navigation";
import { Megaphone } from "lucide-react";

import { CampaignStudio } from "@/components/campaigns/campaign-studio";
import { RegisterRouteLabel } from "@/components/layout/route-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getOrganization } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { createCampaignReadRepository } from "@/modules/campaigns/infrastructure/repository";
import type { CampaignPersistence } from "@/modules/campaigns/infrastructure/repository";
import { readStudioView } from "@/modules/campaigns/infrastructure/studio-reader";

type PageProps = {
  params: Promise<{ organizationId: string; campaignId: string }>;
  searchParams: Promise<{ version?: string }>;
};

export default async function CampaignDetailPage({ params, searchParams }: PageProps) {
  const resolved = await params;
  const context = await getOrganizationContext(Promise.resolve(resolved));
  const organization = await getOrganization(context.supabase, context.organizationId);
  const { version } = await searchParams;

  const view = await readStudioView(
    createCampaignReadRepository(context.supabase as unknown as CampaignPersistence),
    context.organizationId,
    resolved.campaignId,
    {
      versionId: version,
      // Signed against the caller's own session, so the private bucket is
      // reached with the member's permissions rather than around them.
      previews: {
        database: context.supabase as never,
        storage: context.supabase as never,
      },
    },
  );

  // The same answer for "no such campaign", "not yours", and "no version yet".
  // Distinguishing the first two would confirm another tenant's campaign exists.
  if (!view) notFound();

  return (
    <div className="flex min-h-0 flex-col gap-6">
      <RegisterRouteLabel segment={context.organizationId} label={organization.name} />
      <RegisterRouteLabel segment={resolved.campaignId} label={view.title} />

      <div className="flex shrink-0 items-start gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <Megaphone />
        </span>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{view.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {view.sourceLabel} · version {view.versionNumber} · {organization.name}
          </p>
        </div>
      </div>

      <Alert>
        <AlertTitle>Objective</AlertTitle>
        <AlertDescription className="flex flex-col gap-2">
          <span>{view.objective}</span>
          <span className="text-xs">{view.rationale}</span>
        </AlertDescription>
      </Alert>

      <CampaignStudio
        view={view}
        organizationId={context.organizationId}
        organizationName={organization.name}
        timeZone={organization.default_timezone}
      />
    </div>
  );
}
