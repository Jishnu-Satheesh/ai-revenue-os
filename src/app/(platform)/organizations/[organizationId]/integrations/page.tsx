import { Cable } from "lucide-react";

import { IntegrationHubClient } from "@/components/integrations/integration-hub-client";
import { RegisterRouteLabel } from "@/components/layout/route-context";
import type { OrganizationRole } from "@/domain/organizations/types";
import { getOrganization } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { createIntegrationHubService } from "@/modules/integrations/application/api-schemas";
import { assertIntegrationHubEnabled } from "@/modules/integrations/application/feature-access";
import { listMetricTargets } from "@/modules/metrics/infrastructure/repository";

type PageProps = { params: Promise<{ organizationId: string }> };

export default async function IntegrationsPage({ params }: PageProps) {
  // Order matters: membership first so a stranger never learns whether the
  // rollout includes this organization, then the allowlist, then any read.
  const context = await getOrganizationContext(params);
  assertIntegrationHubEnabled(context.organizationId);

  const authenticatedContext = {
    organizationId: context.organizationId,
    actorId: context.user.id,
    role: context.membership.role as OrganizationRole,
    correlationId: crypto.randomUUID(),
  };
  const service = createIntegrationHubService({ supabase: context.supabase });
  // Read directly rather than through the Integration Hub service: the metric
  // registry is a separate module, and folding its vocabulary into the hub's
  // snapshot would couple two read models that have no other reason to meet.
  const [organization, snapshot, catalog, metricTargets] = await Promise.all([
    getOrganization(context.supabase, context.organizationId),
    service.getSnapshot(authenticatedContext),
    service.getCatalog(authenticatedContext),
    listMetricTargets(context.supabase, context.organizationId),
  ]);

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-6">
      <RegisterRouteLabel segment={context.organizationId} label={organization.name} />
      <div className="flex shrink-0 items-start gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <Cable />
        </span>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Integrations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {organization.name} · connection health, catalog, data sources, and activity
          </p>
        </div>
      </div>

      <IntegrationHubClient
        organizationId={context.organizationId}
        organizationName={organization.name}
        organizationTimeZone={organization.default_timezone}
        role={authenticatedContext.role}
        initialSnapshot={snapshot}
        initialCatalog={catalog}
        metricTargets={metricTargets}
      />
    </div>
  );
}
