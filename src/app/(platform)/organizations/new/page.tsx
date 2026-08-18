import Link from "next/link";

import { NewOrganizationWizard } from "@/components/organizations/new-organization-wizard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { resolveLandingPath } from "@/modules/organizations/application/landing";
import { getAccountContext } from "@/lib/api/account-context";
import { hasAccountPermission } from "@/domain/access/permissions";

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

  // An invited member reaches this page from the switcher but cannot create a
  // client: the insert policy refuses without `organization.create`. Saying so
  // here turns a raw database refusal at the end of a five-step form into an
  // answer before the first field.
  const accountRole = await getAccountContext()
    .then((context) => context.accountRole)
    .catch(() => null);

  if (accountRole && !hasAccountPermission(accountRole, "organization.create")) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6 py-12">
        <div className="w-full max-w-md space-y-4">
          <Alert>
            <AlertTitle>Only an agency owner or admin can add a client</AlertTitle>
            <AlertDescription>
              Ask someone with that role to create the client. Once it exists you will reach it like
              every other client in the agency.
            </AlertDescription>
          </Alert>
          {backHref ? (
            <Button asChild variant="outline" className="w-full">
              <Link href={backHref}>Back to your workspace</Link>
            </Button>
          ) : null}
        </div>
      </main>
    );
  }

  return <NewOrganizationWizard backHref={backHref} />;
}
