import { OverviewReport } from "@/components/organizations/overview-report";
import { RegisterRouteLabel } from "@/components/layout/route-context";
import { getDigitalTwin } from "@/domain/organizations/repository";
import type { OrganizationRole } from "@/domain/organizations/types";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { logger } from "@/lib/logger";
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
  buildOverviewComparison,
  buildOverviewEconomics,
  buildOverviewIntegration,
  buildOverviewMoneyScale,
  getOverviewPermissions,
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

  const priorWindow = {
    rangeStart: new Date(
      window.rangeStart.getTime() - (window.rangeEndExclusive.getTime() - window.rangeStart.getTime()),
    ),
    rangeEndExclusive: window.rangeStart,
  };

  const [[entriesResult, catalogResult, priorEntriesResult], integrationSnapshotResult] =
    await Promise.all([
      Promise.allSettled([
        loadLedgerEntries(context.supabase, {
          organizationId: context.organizationId,
          branchId: null,
          rangeStart: window.rangeStart,
          rangeEndExclusive: window.rangeEndExclusive,
        }),
        loadCatalogCoverage(context.supabase, context.organizationId),
        // The window immediately before this one, same length and timezone.
        // A failed read costs the comparison and nothing else, so it settles
        // separately rather than failing the page.
        loadLedgerEntries(context.supabase, {
          organizationId: context.organizationId,
          branchId: null,
          rangeStart: priorWindow.rangeStart,
          rangeEndExclusive: priorWindow.rangeEndExclusive,
        }),
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
  const reportingWindow: OverviewEconomics["window"] = {
    rangeStart: window.rangeStart.toISOString(),
    rangeEndExclusive: window.rangeEndExclusive.toISOString(),
    timeZone: window.timeZone,
  };
  const economicsForActions =
    economics.status === "ready" ? economics.data : ({ status: "failed" } as const);
  const integrationForActions: OverviewIntegrationState =
    integration.status === "ready"
      ? { status: "ready", ...integration.data }
      : { status: integration.status };

  const scale = economics.status === "ready" ? buildOverviewMoneyScale(economics.data) : null;
  const comparison =
    economics.status === "ready" && priorEntriesResult.status === "fulfilled"
      ? buildOverviewComparison({
          economics: economics.data,
          priorEntries: priorEntriesResult.value,
        })
      : null;

  if (priorEntriesResult.status === "rejected") {
    logger.warn("organization_overview.comparison_failed", {
      organizationId: context.organizationId,
      correlationId,
    });
  }

  return (
    <>
      <RegisterRouteLabel segment={context.organizationId} label={snapshot.organization.name} />
      <OverviewReport
        snapshot={snapshot}
        readiness={readiness}
        permissions={permissions}
        reportingWindow={reportingWindow}
        economics={economics}
        integration={integration}
        scale={scale}
        comparison={comparison}
        actions={buildOverviewActionQueue({
          organizationId: context.organizationId,
          readiness,
          economics: economicsForActions,
          integration: integrationForActions,
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
