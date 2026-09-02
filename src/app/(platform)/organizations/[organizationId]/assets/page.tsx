import { Images } from "lucide-react";

import { AssetWorkspace } from "@/components/assets/asset-workspace";
import { RegisterRouteLabel } from "@/components/layout/route-context";
import { hasOrganizationPermission } from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import { getOrganization } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { createAssetLibraryService } from "@/modules/campaigns/application/asset-library-service";
import {
  createAssetLibraryRepository,
  type AssetLibraryPersistence,
} from "@/modules/campaigns/infrastructure/asset-library-repository";
import {
  readCampaignOutput,
  type CampaignOutputPersistence,
} from "@/modules/campaigns/infrastructure/campaign-output-reader";
import {
  createSubjectRepository,
  type SubjectPersistence,
} from "@/modules/campaigns/infrastructure/subject-repository";

type PageProps = { params: Promise<{ organizationId: string }> };

/**
 * The asset library.
 *
 * Every read on this page uses the session's own client, so RLS decides what
 * this member may see. There is no service-role read here.
 *
 * The two role questions are answered on the server and passed down as plain
 * booleans, so the interface never offers a control the API would refuse. In
 * particular, confirming a dish description is reserved for an owner or admin
 * even though managing one is not.
 */
export default async function AssetsPage({ params }: PageProps) {
  const context = await getOrganizationContext(params);
  const organization = await getOrganization(context.supabase, context.organizationId);
  const role = context.membership.role as OrganizationRole;

  const library = createAssetLibraryService({
    store: createAssetLibraryRepository(context.supabase as unknown as AssetLibraryPersistence),
  });
  const subjectStore = createSubjectRepository(context.supabase as unknown as SubjectPersistence);

  const [references, subjects, campaignOutput] = await Promise.all([
    library.list({ organizationId: context.organizationId, includeArchived: true }),
    subjectStore.list(context.organizationId),
    readCampaignOutput(
      context.supabase as unknown as CampaignOutputPersistence,
      context.organizationId,
    ),
  ]);

  return (
    <div className="flex min-h-0 flex-col gap-6">
      <RegisterRouteLabel segment={context.organizationId} label={organization.name} />
      <div className="flex shrink-0 items-start gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <Images />
        </span>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Asset library</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {organization.name} · what we taught it, what it drew, and what we sell
          </p>
        </div>
      </div>

      <AssetWorkspace
        organizationId={context.organizationId}
        references={references.map((reference) => ({
          brandAssetId: reference.brandAssetId,
          brandAssetVersionId: reference.brandAssetVersionId,
          label: reference.label,
          assetRole: reference.assetRole,
          conditioningRoles: reference.conditioningRoles,
          tags: reference.tags,
          scripts: reference.scripts,
          ownership: reference.ownership,
          archivedAt: reference.archivedAt,
          version: reference.version,
          previewUrl: null,
          currentVerdict: reference.currentVerdict,
          currentReasonCodes: reference.currentReasonCodes,
          currentReviewedAt: reference.currentReviewedAt,
        }))}
        campaignOutput={campaignOutput}
        subjects={subjects.map((subject) => ({
          id: subject.id,
          name: subject.name,
          description: subject.description,
          namesByScript: subject.namesByScript,
          tags: subject.tags,
          state: subject.state,
          archivedAt: subject.archivedAt,
        }))}
        canConfirmSubjects={role === "owner" || role === "admin"}
        canReview={hasOrganizationPermission(role, "asset.review")}
      />
    </div>
  );
}
