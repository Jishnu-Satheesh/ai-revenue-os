"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, BookOpen, Database, Eye, Plug } from "lucide-react";

import { ActivityTab } from "@/components/integrations/activity-tab";
import { CatalogTab } from "@/components/integrations/catalog-tab";
import { ConnectionsTab } from "@/components/integrations/connections-tab";
import { DataSourcesTab } from "@/components/integrations/data-sources-tab";
import type { MetricTargetChoice } from "@/components/integrations/csv-mapping-form";
import {
  integrationCatalogQueryOptions,
  integrationSnapshotQueryOptions,
} from "@/components/integrations/query-options";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ProviderDefinition } from "@/domain/integrations/types";
import type { OrganizationRole } from "@/domain/organizations/types";
import { hasIntegrationPermission } from "@/domain/integrations/permissions";
import type { IntegrationHubSnapshot } from "@/modules/integrations/application/read-model";

export type IntegrationHubClientProps = {
  organizationId: string;
  organizationName: string;
  organizationTimeZone: string;
  role: OrganizationRole;
  initialSnapshot: IntegrationHubSnapshot;
  initialCatalog: readonly ProviderDefinition[];
  /**
   * When the server payload was read. Tests and streamed navigations use it to
   * decide whether the first client render should refetch.
   */
  initialDataUpdatedAt?: number;
  /** Registered metric keys this organization can map a CSV column onto. */
  metricTargets: readonly MetricTargetChoice[];
};

const tabs = [
  { value: "connections", label: "Connections", icon: Plug },
  { value: "catalog", label: "Catalog", icon: BookOpen },
  { value: "data-sources", label: "Data sources", icon: Database },
  { value: "activity", label: "Activity", icon: Activity },
] as const;

export function IntegrationHubClient({
  organizationId,
  organizationName,
  organizationTimeZone,
  role,
  initialSnapshot,
  initialCatalog,
  initialDataUpdatedAt,
  metricTargets,
}: IntegrationHubClientProps) {
  const snapshotQuery = useQuery(
    integrationSnapshotQueryOptions({
      organizationId,
      initialData: initialSnapshot,
      initialDataUpdatedAt,
    }),
  );
  const catalogQuery = useQuery(
    integrationCatalogQueryOptions({
      organizationId,
      initialData: initialCatalog,
      initialDataUpdatedAt,
    }),
  );

  // Never blank data that is already on screen: a refetch only adds a status
  // line, and the last successful payload keeps rendering underneath it.
  const snapshot = snapshotQuery.data ?? initialSnapshot;
  const catalog = catalogQuery.data ?? initialCatalog;
  const isRefreshing = snapshotQuery.isFetching || catalogQuery.isFetching;
  const canOperate = hasIntegrationPermission(role, "integration.connect");

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
      <div aria-live="polite" className="flex h-5 items-center gap-2 text-xs text-muted-foreground">
        {isRefreshing ? (
          <span
            role="status"
            aria-label="Refreshing integration data"
            className="flex items-center gap-2"
          >
            <Spinner className="size-3" />
            Refreshing integration data
          </span>
        ) : null}
      </div>

      <p className="text-sm text-muted-foreground">
        Showing integration state for {organizationName}.
      </p>

      {canOperate ? null : (
        <Alert>
          <Eye />
          <AlertTitle>Read-only access</AlertTitle>
          <AlertDescription>
            You can review integration health and history. Connecting, testing, importing, and
            disconnecting require an operator role.
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="connections" className="min-h-0 flex-1">
        <TabsList aria-label="Integration Hub views" className="w-full sm:w-fit">
          {tabs.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value}>
              <Icon data-icon="inline-start" aria-hidden="true" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="connections" className="min-h-0">
          <ConnectionsTab
            organizationId={organizationId}
            snapshot={snapshot}
            catalog={catalog}
            role={role}
            timeZone={organizationTimeZone}
          />
        </TabsContent>
        <TabsContent value="catalog" className="min-h-0">
          <CatalogTab
            organizationId={organizationId}
            catalog={catalog}
            connections={snapshot.connections}
            role={role}
          />
        </TabsContent>
        <TabsContent value="data-sources" className="min-h-0">
          <DataSourcesTab
            organizationId={organizationId}
            snapshot={snapshot}
            metricTargets={metricTargets}
            role={role}
            timeZone={organizationTimeZone}
          />
        </TabsContent>
        <TabsContent value="activity" className="min-h-0">
          <ActivityTab
            activity={snapshot.recentActivity}
            isRefreshing={isRefreshing}
            timeZone={organizationTimeZone}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
