"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, BookOpen, Database, Eye, Plug } from "lucide-react";

import {
  integrationCatalogQueryOptions,
  integrationSnapshotQueryOptions,
} from "@/components/integrations/query-options";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ProviderDefinition } from "@/domain/integrations/types";
import type { OrganizationRole } from "@/domain/organizations/types";
import { hasIntegrationPermission } from "@/modules/integrations/application/authorization";
import type { IntegrationHubSnapshot } from "@/modules/integrations/application/read-model";

export type IntegrationHubClientProps = {
  organizationId: string;
  organizationName: string;
  role: OrganizationRole;
  initialSnapshot: IntegrationHubSnapshot;
  initialCatalog: readonly ProviderDefinition[];
  /**
   * When the server payload was read. Tests and streamed navigations use it to
   * decide whether the first client render should refetch.
   */
  initialDataUpdatedAt?: number;
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
  role,
  initialSnapshot,
  initialCatalog,
  initialDataUpdatedAt,
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
          {snapshot.connections.length === 0 ? (
            <PlaceholderTab
              icon={Plug}
              title="No connections yet"
              description={`${organizationName} has no provider connections. Open the Catalog to add one.`}
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {snapshot.connections.map((connection) => (
                <li key={connection.id}>
                  <Card>
                    <CardHeader>
                      <CardTitle>{connection.external_account_label}</CardTitle>
                      <CardDescription>{connection.health.explanation}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Badge variant="outline">{connection.health.state}</Badge>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="catalog" className="min-h-0">
          <PlaceholderTab
            icon={BookOpen}
            title="Catalog"
            description={`${catalog.length} provider definition(s) published by the server registry.`}
          />
        </TabsContent>
        <TabsContent value="data-sources" className="min-h-0">
          <PlaceholderTab
            icon={Database}
            title="Data sources"
            description={`${snapshot.summary.dataSources} manual or imported source(s).`}
          />
        </TabsContent>
        <TabsContent value="activity" className="min-h-0">
          <PlaceholderTab
            icon={Activity}
            title="Activity"
            description={`${snapshot.recentActivity.length} recent event(s).`}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PlaceholderTab({
  icon: Icon,
  title,
  description,
}: Readonly<{ icon: typeof Plug; title: string; description: string }>) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
