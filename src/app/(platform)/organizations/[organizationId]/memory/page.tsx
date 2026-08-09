import { BrainCircuit } from "lucide-react";

import { RegisterRouteLabel } from "@/components/layout/route-context";
import { MemoryWorkspaceClient } from "@/components/memory/memory-workspace-client";
import { getOrganization } from "@/domain/organizations/repository";
import type { OrganizationRole } from "@/domain/organizations/types";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { createMemoryWorkspaceApi } from "@/modules/memory/application/api";

type PageProps = { params: Promise<{ organizationId: string }> };

export default async function MemoryPage({ params }: PageProps) {
  // Membership resolves first, so the composition below is only ever built with
  // a session client whose RLS context already covers this organization.
  const context = await getOrganizationContext(params);
  const role = context.membership.role as OrganizationRole;
  const { service } = createMemoryWorkspaceApi({
    supabase: context.supabase,
    actor: { userId: context.user.id, role },
  });

  const [organization, snapshot] = await Promise.all([
    getOrganization(context.supabase, context.organizationId),
    service.getSnapshot({
      organizationId: context.organizationId,
      actor: { userId: context.user.id, role },
    }),
  ]);

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-6">
      <RegisterRouteLabel segment={context.organizationId} label={organization.name} />
      <div className="flex shrink-0 items-start gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <BrainCircuit />
        </span>
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight">Business Memory</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {organization.name} · search verified context, inspect provenance, and review proposals
          </p>
        </div>
      </div>

      <MemoryWorkspaceClient
        organizationId={context.organizationId}
        organizationName={organization.name}
        role={role}
        initialSnapshot={snapshot}
      />
    </div>
  );
}
