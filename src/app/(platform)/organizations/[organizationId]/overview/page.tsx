import { OrganizationIntelligenceCockpit } from "@/components/organizations/organization-intelligence-cockpit";
import { RegisterRouteLabel } from "@/components/layout/route-context";
import { getDigitalTwin } from "@/domain/organizations/repository";
import type { OrganizationRole } from "@/domain/organizations/types";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { logger } from "@/lib/logger";
import { demoCampaigns } from "@/modules/campaigns/demo/fixtures";
import { buildEconomicsView, resolveWindow } from "@/modules/economics/application/read-model";
import {
  loadCatalogCoverage,
  loadLedgerEntries,
} from "@/modules/economics/infrastructure/repository";
import { createIntegrationHubService } from "@/modules/integrations/application/api-schemas";
import { isIntegrationHubEnabled } from "@/modules/integrations/application/feature-access";
import {
  buildDigitalTwinReadiness,
  buildOverviewActionQueue,
  buildOverviewEconomics,
  buildOverviewIntegration,
  buildStrategicBriefing,
  getOverviewPermissions,
  selectRecentCampaigns,
  type OverviewEconomics,
  type OverviewIntegrationState,
} from "@/modules/organizations/application/overview";

type PageProps = { params: Promise<{ organizationId: string }> };

export default async function OverviewPage({ params }: PageProps) {
  const context = await getOrganizationContext(params);
  const permissions = getOverviewPermissions(context.membership.role as OrganizationRole);
  const integrationEnabled = isIntegrationHubEnabled(context.organizationId);
  const correlationId = crypto.randomUUID();
  const integrationSnapshotPromise = settle(
    integrationEnabled
      ? createIntegrationHubService({ supabase: context.supabase }).getSnapshot({
          organizationId: context.organizationId,
          actorId: context.user.id,
          role: context.membership.role as OrganizationRole,
          correlationId,
        })
      : Promise.resolve(null),
  );
  const snapshot = await getDigitalTwin(context.supabase, context.organizationId);
  const window = resolveWindow({
    preset: "30d",
    timeZone: snapshot.organization.default_timezone,
    now: new Date(),
  });

  const [[entriesResult, catalogResult], integrationSnapshotResult] = await Promise.all([
    Promise.allSettled([
      loadLedgerEntries(context.supabase, {
        organizationId: context.organizationId,
        branchId: null,
        rangeStart: window.rangeStart,
        rangeEndExclusive: window.rangeEndExclusive,
      }),
      loadCatalogCoverage(context.supabase, context.organizationId),
    ]),
    integrationSnapshotPromise,
  ]);

  if (catalogResult.status === "rejected") {
    logger.warn("organization_overview.cost_coverage_failed", {
      organizationId: context.organizationId,
      correlationId,
    });
  }

  const economics: { status: "ready"; data: OverviewEconomics } | { status: "failed" } =
    entriesResult.status === "fulfilled"
      ? {
          status: "ready",
          data: buildOverviewEconomics({
            view: buildEconomicsView({
              window,
              entries: entriesResult.value,
              catalog: catalogResult.status === "fulfilled" ? catalogResult.value : [],
            }),
            entries: entriesResult.value,
          }),
        }
      : { status: "failed" };

  if (entriesResult.status === "rejected") {
    logger.warn("organization_overview.economics_failed", {
      organizationId: context.organizationId,
      correlationId,
    });
  }

  const integration = !integrationEnabled
    ? ({ status: "disabled" } as const)
    : integrationSnapshotResult.status === "fulfilled" && integrationSnapshotResult.value
      ? ({
          status: "ready",
          data: buildOverviewIntegration(integrationSnapshotResult.value),
        } as const)
      : ({ status: "failed" } as const);

  if (integrationEnabled && integration.status === "failed") {
    logger.warn("organization_overview.integrations_failed", {
      organizationId: context.organizationId,
      correlationId,
    });
  }

  const readiness = buildDigitalTwinReadiness(snapshot);
  const economicsForBriefing =
    economics.status === "ready" ? economics.data : ({ status: "failed" } as const);
  const integrationForBriefing: OverviewIntegrationState =
    integration.status === "ready"
      ? { status: "ready", ...integration.data }
      : { status: integration.status };
  const reportingWindow: OverviewEconomics["window"] = {
    rangeStart: window.rangeStart.toISOString(),
    rangeEndExclusive: window.rangeEndExclusive.toISOString(),
    timeZone: window.timeZone,
  };

  return (
    <>
      <RegisterRouteLabel segment={context.organizationId} label={snapshot.organization.name} />
      <OrganizationIntelligenceCockpit
        snapshot={snapshot}
        readiness={readiness}
        permissions={permissions}
        reportingWindow={reportingWindow}
        economics={economics}
        integration={integration}
        campaigns={selectRecentCampaigns(demoCampaigns)}
        briefing={buildStrategicBriefing({
          readiness,
          economics: economicsForBriefing,
          integration: integrationForBriefing,
        })}
        actions={buildOverviewActionQueue({
          organizationId: context.organizationId,
          readiness,
          economics: economicsForBriefing,
          integration: integrationForBriefing,
          permissions,
        })}
      />
    </>
  );
}

function settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  return promise.then(
    (value) => ({ status: "fulfilled", value }),
    (reason: unknown) => ({ status: "rejected", reason }),
  );
}
