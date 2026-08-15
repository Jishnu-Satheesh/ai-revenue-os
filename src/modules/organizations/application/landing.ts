import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

// A pure route helper with no React dependency. Importing it keeps one
// definition of the Overview URL: duplicating the shape here is exactly how the
// menu and the redirect would drift apart.
import { overviewPath } from "@/lib/routes";
import { logger } from "@/lib/logger";
import type { Database } from "@/lib/supabase/database.types";

type OrganizationClient = SupabaseClient<Database>;

const LOGIN_PATH = "/login";
const CREATE_ORGANIZATION_PATH = "/organizations/new";
const organizationIdSchema = z.string().uuid();

/**
 * The single answer to "which organization does this user open next?", shared by
 * the root route, the authentication callback, the archive action, and the
 * create wizard's back link so none of them can invent their own rule.
 *
 * Ordering lives in `resolve_landing_organization`, which runs under the
 * caller's RLS: most recent access first, never-visited last, then name
 * ascending, with archived organizations excluded.
 */
export async function resolveLandingPath(supabase: OrganizationClient): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return LOGIN_PATH;

  const { data, error } = await supabase.rpc("resolve_landing_organization");
  // A landing must always resolve somewhere. A failed read is indistinguishable
  // from an empty portfolio at this point, and the create wizard is a safe
  // destination for both: it never claims the user has no organizations.
  if (error || !data) return CREATE_ORGANIZATION_PATH;
  return overviewPath(data);
}

/**
 * Records that the user is inside this organization, so the next landing returns
 * them here. Best-effort by design: the write is authorization-free convenience,
 * and RLS already rejects a position against an organization the user does not
 * belong to.
 */
export async function recordOrganizationAccess(
  supabase: OrganizationClient,
  organizationId: string,
): Promise<void> {
  if (!organizationIdSchema.safeParse(organizationId).success) return;

  const { error } = await supabase.rpc("touch_organization_access", {
    target_organization_id: organizationId,
  });
  // Losing a position means a worse-ordered landing next time, never a broken
  // page, so this is logged rather than thrown.
  if (error) logger.warn("organization_access_not_recorded", { organizationId });
}
