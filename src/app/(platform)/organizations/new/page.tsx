import { NewOrganizationWizard } from "@/components/organizations/new-organization-wizard";
import { createClient } from "@/lib/supabase/server";
import { resolveLandingPath } from "@/modules/organizations/application/landing";

/**
 * Reachable two ways: from the switcher while inside an organization, and as the
 * landing for a user who has none. The back link follows the same resolution as
 * every other doorway, and is omitted when it would resolve to this page.
 */
export default async function NewOrganizationPage() {
  const supabase = await createClient();
  const landingPath = await resolveLandingPath(supabase);
  // Only an organization is somewhere to go back to; the resolver's other
  // answers are this page itself and the login route.
  const backHref = landingPath.endsWith("/overview") ? landingPath : undefined;

  return <NewOrganizationWizard backHref={backHref} />;
}
