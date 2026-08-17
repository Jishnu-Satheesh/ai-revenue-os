import { notFound } from "next/navigation";

import { ReviseWorkspace } from "@/components/campaigns/revise-workspace";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { createCampaignReadRepository } from "@/modules/campaigns/infrastructure/repository";
import type { CampaignPersistence } from "@/modules/campaigns/infrastructure/repository";

type PageProps = {
  params: Promise<{ organizationId: string; campaignId: string }>;
  searchParams: Promise<{ version?: string; direction?: string; intent?: string }>;
};

/**
 * The revise workspace, at its own URL.
 *
 * Loads the full manifest rather than the Studio's view model, because the diff
 * on this screen compares two manifests and a view model has already dropped
 * the fields the comparison is about.
 */
export default async function CampaignRevisePage({ params, searchParams }: PageProps) {
  const resolved = await params;
  const context = await getOrganizationContext(Promise.resolve(resolved));
  const { version, direction, intent } = await searchParams;

  const repository = createCampaignReadRepository(
    context.supabase as unknown as CampaignPersistence,
  );

  const campaign = await repository.getCampaign(context.organizationId, resolved.campaignId);
  if (!campaign) notFound();

  const versions = await repository.listVersions(context.organizationId, resolved.campaignId);
  const targetId = version ?? versions[0]?.id;
  if (!targetId) notFound();

  const detail = await repository.getVersion(context.organizationId, targetId);
  // A version id from the query string is a request parameter, so it is checked
  // against this campaign rather than trusted to belong to it.
  if (!detail || detail.campaignId !== resolved.campaignId) notFound();

  const directionId = detail.manifest.directions.some((entry) => entry.id === direction)
    ? direction!
    : (detail.manifest.directions[0]?.id ?? "");
  if (!directionId) notFound();

  return (
    <ReviseWorkspace
      organizationId={context.organizationId}
      campaignId={resolved.campaignId}
      campaignTitle={campaign.title}
      versionId={detail.id}
      versionNumber={detail.version}
      digest={detail.digest}
      manifest={detail.manifest}
      directionId={directionId}
      intent={intent === "edit" ? "edit" : "revise"}
    />
  );
}
