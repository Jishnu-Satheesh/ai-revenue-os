import { notFound } from "next/navigation";
import Link from "next/link";
import { Palette } from "lucide-react";

import { PosterStudio } from "@/components/campaigns/studio/poster-studio";
import { RegisterRouteLabel } from "@/components/layout/route-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { hasCampaignPermission } from "@/domain/campaigns/permissions";
import { getOrganization } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { createCampaignReadRepository } from "@/modules/campaigns/infrastructure/repository";
import type { CampaignPersistence } from "@/modules/campaigns/infrastructure/repository";
import {
  readPosterStudioPlates,
  readPosterStudioView,
  readRenderPreviews,
} from "@/modules/campaigns/infrastructure/poster-studio-reader";

/**
 * The Creative Studio for one campaign version.
 *
 * A sub-page of the campaign rather than a section of it, because the questions
 * are different: the campaign page asks "should this be approved", and this one
 * asks "what does it look like printed". Sharing a route would have made the
 * control room longer without making either question easier to answer.
 *
 * Everything is read on the caller's own session. There is no service-role
 * client here, so a campaign belonging to another organization is not filtered
 * out by this page -- it is never returned.
 */

type PageProps = {
  params: Promise<{ organizationId: string; campaignId: string }>;
  searchParams: Promise<{ version?: string }>;
};

export default async function PosterStudioPage({ params, searchParams }: PageProps) {
  const resolved = await params;
  const context = await getOrganizationContext(Promise.resolve(resolved));
  const organization = await getOrganization(context.supabase, context.organizationId);
  const { version } = await searchParams;

  const read = createCampaignReadRepository(context.supabase as unknown as CampaignPersistence);
  const campaign = await read.getCampaign(context.organizationId, resolved.campaignId);
  // "Not found" and "not yours" stay indistinguishable, or the answer confirms
  // another tenant's campaign exists.
  if (!campaign) notFound();

  const versions = await read.listVersions(context.organizationId, resolved.campaignId);
  const versionId = version ?? versions[0]?.id;

  const header = (
    <>
      <RegisterRouteLabel segment={context.organizationId} label={organization.name} />
      <RegisterRouteLabel segment={resolved.campaignId} label={campaign.title} />
      <RegisterRouteLabel segment="studio" label="Creative Studio" />

      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <Palette />
          </span>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Creative Studio</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {campaign.title} · {organization.name}
            </p>
          </div>
        </div>
        <Button asChild variant="outline">
          <Link href={`/organizations/${context.organizationId}/campaigns/${resolved.campaignId}`}>
            Back to the campaign
          </Link>
        </Button>
      </div>
    </>
  );

  if (!versionId) {
    return (
      <div className="flex min-h-0 flex-col gap-6">
        {header}
        <Alert>
          <AlertTitle>There is nothing to compose yet</AlertTitle>
          <AlertDescription>
            A poster quotes the words of an approved proposal and composes them over its picture.
            This campaign has no proposal yet, so there is nothing to draw.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const view = await readPosterStudioView(
    read,
    context.supabase as never,
    context.organizationId,
    resolved.campaignId,
    versionId,
  );

  if (!view) {
    return (
      <div className="flex min-h-0 flex-col gap-6">
        {header}
        <Alert>
          <AlertTitle>That version is not available</AlertTitle>
          <AlertDescription>
            It may have been superseded. Open the campaign and choose a version from there.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Signed against the caller's own session, so the private bucket is reached
  // with the member's permissions rather than around them.
  const [plates, renderPreviews] = await Promise.all([
    readPosterStudioPlates(
      context.supabase as never,
      context.supabase as never,
      context.organizationId,
      versionId,
    ),
    readRenderPreviews(context.supabase as never, view.renders),
  ]);

  const role = context.membership.role;

  return (
    <div className="flex min-h-0 flex-col gap-6">
      {header}
      <PosterStudio
        view={view}
        plates={plates}
        renderPreviews={renderPreviews}
        organizationId={context.organizationId}
        campaignId={resolved.campaignId}
        // The same map the routes read, so the button an operator can see is
        // the one the server will accept. A surface that offered an action the
        // API refuses teaches people the product is broken.
        canRender={hasCampaignPermission(role, "poster.render")}
        canEdit={hasCampaignPermission(role, "campaign.edit")}
      />
    </div>
  );
}
