import { notFound } from "next/navigation";

import { RegisterRouteLabel } from "@/components/layout/route-context";
import { OrganizationSettings } from "@/components/organizations/organization-settings";
import { getOrganization } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";

/**
 * Organization settings. Reading needs membership; every tab enforces its own
 * permissions again on the server, so the shell never implies access it does
 * not grant.
 */
export default async function OrganizationSettingsPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const context = await getOrganizationContext(params);
  const organization = await getOrganization(context.supabase, context.organizationId).catch(
    () => null,
  );
  if (!organization) notFound();

  return (
    <>
      <RegisterRouteLabel label="Settings" />
      <OrganizationSettings
        organizationId={context.organizationId}
        organizationName={organization.name}
      />
    </>
  );
}
