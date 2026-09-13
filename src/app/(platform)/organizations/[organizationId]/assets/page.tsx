import { AssetWorkspace } from "@/components/assets/asset-workspace";
import { RegisterRouteLabel } from "@/components/layout/route-context";
import { hasOrganizationPermission } from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import { getOrganization } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { createAssetLibraryService } from "@/modules/campaigns/application/asset-library-service";
import {
  createAssetLibraryRepository,
  signBrandAssetPreviews,
  type AssetLibraryPersistence,
  type BrandAssetPreviewSigner,
} from "@/modules/campaigns/infrastructure/asset-library-repository";
import {
  createSubjectRepository,
  type SubjectPersistence,
} from "@/modules/campaigns/infrastructure/subject-repository";

type PageProps = { params: Promise<{ organizationId: string }> };

/**
 * The asset library: Creative History, Products & Subjects, and Brand Kit.
 *
 * Every read on this page uses the session's own client, so RLS decides what
 * this member may see. There is no service-role read here, and the signed
 * preview URLs below are minted from that same session — a private preview
 * that this member could not otherwise read cannot be signed for them either.
 *
 * Creative History's own folders and designs are fetched client-side by
 * `AssetWorkspace` (Task 2's API, behind TanStack Query); this page supplies
 * only what a server component actually has for free: the organization,
 * this member's exact permissions, and the two brand-asset reference lists
 * that predate this rework.
 *
 * Role questions are answered here and passed down as plain booleans, so the
 * interface never offers a control the API would refuse. Confirming a subject
 * is reserved for an owner or admin even though managing one is not.
 */
export default async function AssetsPage({ params }: PageProps) {
  const context = await getOrganizationContext(params);
  const organization = await getOrganization(context.supabase, context.organizationId);
  const role = context.membership.role as OrganizationRole;

  const library = createAssetLibraryService({
    store: createAssetLibraryRepository(context.supabase as unknown as AssetLibraryPersistence),
  });
  const subjectStore = createSubjectRepository(context.supabase as unknown as SubjectPersistence);

  const [references, subjects] = await Promise.all([
    library.list({ organizationId: context.organizationId, includeArchived: true }),
    subjectStore.list(context.organizationId),
  ]);

  // The library previously set every preview to `null` here, so the grid
  // showed taxonomy labels and no pictures. Each reference already carries
  // its own storage path; this is the fix, not a new capability — a private,
  // bounded-expiry signed URL per path, degrading to no preview only for a
  // path that fails to sign.
  const previewUrls = await signBrandAssetPreviews(
    context.supabase as unknown as BrandAssetPreviewSigner,
    references.map((reference) => reference.storagePath),
    { organizationId: context.organizationId },
  );

  return (
    <div className="flex min-h-0 flex-col gap-6">
      <RegisterRouteLabel segment={context.organizationId} label={organization.name} />

      <AssetWorkspace
        organizationId={context.organizationId}
        timeZone={organization.default_timezone}
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
          previewUrl: previewUrls[reference.storagePath] ?? null,
          currentVerdict: reference.currentVerdict,
          currentReasonCodes: reference.currentReasonCodes,
          currentReviewedAt: reference.currentReviewedAt,
        }))}
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
        canManageSubjects={hasOrganizationPermission(role, "subject.manage")}
        canManageAssets={hasOrganizationPermission(role, "asset.manage")}
        canReviewAssets={hasOrganizationPermission(role, "asset.review")}
      />
    </div>
  );
}
