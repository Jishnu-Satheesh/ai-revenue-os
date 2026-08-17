import { createClient } from "@/lib/supabase/server";
import { recordOrganizationAccess } from "@/modules/organizations/application/landing";

/**
 * Marks where the reader is so the next landing returns them here.
 *
 * This layout deliberately does not authorize. Every page below it already
 * resolves its own organization context with the roles it needs, and throwing
 * here would move their failures to the root error boundary instead of each
 * segment's own. The access write is guarded by RLS, which rejects a position
 * against an organization the caller does not belong to.
 */
export default async function OrganizationLayout({
  children,
  params,
}: Readonly<{ children: React.ReactNode; params: Promise<{ organizationId: string }> }>) {
  const { organizationId } = await params;
  const supabase = await createClient();
  await recordOrganizationAccess(supabase, organizationId);

  return children;
}
