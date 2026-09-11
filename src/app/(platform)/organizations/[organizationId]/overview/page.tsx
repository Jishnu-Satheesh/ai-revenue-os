import { OrganizationHome } from "@/components/organizations/home/organization-home";
import { OrganizationManagement } from "@/components/organizations/digital-twin-workspace";
import { RegisterRouteLabel } from "@/components/layout/route-context";
import { getDigitalTwin } from "@/domain/organizations/repository";
import type { OrganizationRole } from "@/domain/organizations/types";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { getOverviewPermissions } from "@/modules/organizations/application/overview";
import { loadOrganizationHome } from "@/modules/organizations/infrastructure/home-loader";

type PageProps = { params: Promise<{ organizationId: string }> };

export default async function OverviewPage({ params }: PageProps) {
  const context = await getOrganizationContext(params);
  const permissions = getOverviewPermissions(context.membership.role as OrganizationRole);
  const correlationId = crypto.randomUUID();
  const snapshot = await getDigitalTwin(context.supabase, context.organizationId);
  const now = new Date().toISOString();
  const view = await loadOrganizationHome({
    supabase: context.supabase,
    organizationId: context.organizationId,
    role: context.membership.role as OrganizationRole,
    snapshot,
    correlationId,
    now,
  });

  return (
    <>
      <RegisterRouteLabel segment={context.organizationId} label={snapshot.organization.name} />
      <OrganizationHome view={view} />
      {/* Editing the organization's own record stays on this route. The home
          header's "Manage organization" link points at this anchor.
          OrganizationManagement owns the canManageCore gate itself, as it
          always has, so the role-derived props stay exact for every role. */}
      <OrganizationManagement
        organizationId={context.organizationId}
        snapshot={snapshot}
        permissions={permissions}
      />
    </>
  );
}
