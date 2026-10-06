import { Suspense } from "react";

import { hasOrganizationPermission } from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import { createClient } from "@/lib/supabase/server";
import { requireOrganizationAccess } from "@/modules/organizations/application/authorization";
import { isAgentChatEnabled } from "@/modules/integrations/application/feature-access";
import { recordOrganizationAccess } from "@/modules/organizations/application/landing";
import { UniversalAgentShellHost } from "@/components/agent/universal-agent-shell";

const AGENT_SHELL_ROLES: readonly OrganizationRole[] = ["viewer", "operator", "admin", "owner"];

/**
 * Resolves the shell's caller role server-side from the membership — never
 * client claims. Best-effort: any failure falls back to the viewer-safe
 * defaults, and the agent routes recheck the role anyway, so a wrong-or-
 * missing value here only ever hides buttons, never grants access.
 */
async function resolveAgentShellIdentity(
  organizationId: string,
): Promise<{ role: OrganizationRole; permissions: string[]; actorId?: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { role: "viewer", permissions: [] };
    const access = await requireOrganizationAccess(supabase, organizationId, user.id);
    const role = AGENT_SHELL_ROLES.includes(access.role) ? access.role : "viewer";
    const permissions: string[] = [];
    if (hasOrganizationPermission(role, "growth_intelligence.manage")) {
      permissions.push("growth_intelligence.manage");
    }
    if (hasOrganizationPermission(role, "campaign.create")) {
      permissions.push("campaign.create");
    }
    return { role, permissions, actorId: user.id };
  } catch {
    return { role: "viewer", permissions: [] };
  }
}

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

  // Rollout gate (spec section 16, M2): the shell mounts only for
  // allowlisted organizations. Default off; routes and workers enforce
  // the same flag, so an unlisted org has no agent surface at all.
  if (!isAgentChatEnabled(organizationId)) {
    return <>{children}</>;
  }
  const shellIdentity = await resolveAgentShellIdentity(organizationId);

  return (
    <>
      {children}
      <Suspense fallback={null}>
        <UniversalAgentShellHost
          organizationId={organizationId}
          role={shellIdentity.role}
          permissions={shellIdentity.permissions}
          actorId={shellIdentity.actorId}
        />
      </Suspense>
    </>
  );
}
