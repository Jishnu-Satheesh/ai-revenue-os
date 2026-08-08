"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Archive, Database, PlayCircle, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import {
  DataSourceForm,
  type CsvSourceSubmission,
  type ManualSourceSubmission,
} from "@/components/integrations/data-source-form";
import { formatInstant, runStatusLabel } from "@/components/integrations/health-status";
import {
  integrationQueryKeys,
  integrationRequest,
  integrationsBasePath,
} from "@/components/integrations/query-options";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import type { OrganizationRole } from "@/domain/organizations/types";
import { hasIntegrationPermission } from "@/domain/integrations/permissions";
import type { IntegrationDataSourceRow } from "@/modules/integrations/application/ports";
import type { IntegrationHubSnapshot } from "@/modules/integrations/application/read-model";

type QueuedOperation = { runId: string; status: string };

const sourceStatusLabels: Readonly<Record<IntegrationDataSourceRow["status"], string>> = {
  pending: "Pending upload",
  ready: "Ready",
  processing: "Processing",
  failed: "Failed",
  archived: "Archived",
};

/** A stable, sufficiently long key for a one-shot operator action. */
function operationKey(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

export function DataSourcesTab({
  organizationId,
  snapshot,
  role,
}: Readonly<{
  organizationId: string;
  snapshot: IntegrationHubSnapshot;
  role: OrganizationRole;
}>) {
  const queryClient = useQueryClient();
  const [acknowledgement, setAcknowledgement] = useState<string | null>(null);
  const canImport = hasIntegrationPermission(role, "integration.import");

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: integrationQueryKeys.snapshot(organizationId) });
    void queryClient.invalidateQueries({
      queryKey: integrationQueryKeys.dataSources(organizationId),
    });
    void queryClient.invalidateQueries({ queryKey: integrationQueryKeys.activity(organizationId) });
  }

  function reportFailure(error: unknown) {
    const message =
      error instanceof Error ? error.message : "The request could not be completed. Try again.";
    toast.error(message);
    throw error instanceof Error ? error : new Error(message);
  }

  const registerManual = useMutation({
    mutationFn: async (input: ManualSourceSubmission) =>
      integrationRequest<{ dataSource: IntegrationDataSourceRow }>(
        `${integrationsBasePath(organizationId)}/data-sources`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sourceType: "manual",
            name: input.name,
            branchId: input.branchId,
            idempotencyKey: operationKey("manual-source"),
          }),
        },
      ),
    onSuccess: () => {
      toast.success("Manual source registered.");
      setAcknowledgement("Manual source registered.");
      invalidate();
    },
  });

  const uploadCsv = useMutation({
    mutationFn: async (input: CsvSourceSubmission) => {
      const body = new FormData();
      body.set("sourceType", "csv_import");
      body.set("name", input.name);
      body.set("idempotencyKey", operationKey("csv-source"));
      if (input.branchId) body.set("branchId", input.branchId);
      body.set("columnMapping", JSON.stringify(input.columnMapping));
      body.set("file", input.file);
      return integrationRequest<{ dataSource: IntegrationDataSourceRow }>(
        `${integrationsBasePath(organizationId)}/data-sources`,
        { method: "POST", body },
      );
    },
    onSuccess: () => {
      toast.success("CSV stored privately. Start an import when you are ready.");
      setAcknowledgement("CSV stored privately. Start an import when you are ready.");
      invalidate();
    },
  });

  const startImport = useMutation({
    mutationFn: async (dataSourceId: string) =>
      integrationRequest<QueuedOperation>(
        `${integrationsBasePath(organizationId)}/data-sources/${dataSourceId}/import`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idempotencyKey: operationKey("import") }),
        },
      ),
    // Imports are background work: the acknowledgement repeats the persisted
    // run status and never upgrades it to success.
    onSuccess: (result) => {
      setAcknowledgement(`Import ${result.status} · run ${result.runId}`);
      toast.info(`Import ${result.status}`);
      invalidate();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Import failed."),
  });

  const archiveSource = useMutation({
    mutationFn: async (dataSourceId: string) =>
      integrationRequest<{ dataSource: IntegrationDataSourceRow }>(
        `${integrationsBasePath(organizationId)}/data-sources/${dataSourceId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            status: "archived",
            idempotencyKey: operationKey("archive"),
          }),
        },
      ),
    onSuccess: () => {
      setAcknowledgement("Source archived. Uploads, runs, and activity are retained.");
      toast.success("Source archived. History is retained.");
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The source could not be archived."),
  });

  const latestRunBySource = new Map(
    snapshot.recentActivity
      .filter((entry) => entry.kind === "ingestion_run")
      .map((entry) => [entry.kind === "ingestion_run" ? entry.sourceId : "", entry]),
  );

  return (
    <div className="flex flex-col gap-4">
      {canImport ? (
        <Card>
          <CardHeader>
            <CardTitle>Add a data source</CardTitle>
            <CardDescription>
              Manual and imported sources are organization records, not provider connections.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DataSourceForm
              branches={snapshot.branches}
              isSubmitting={registerManual.isPending || uploadCsv.isPending}
              onRegisterManual={async (input) => {
                try {
                  await registerManual.mutateAsync(input);
                } catch (error) {
                  reportFailure(error);
                }
              }}
              onUploadCsv={async (input) => {
                try {
                  await uploadCsv.mutateAsync(input);
                } catch (error) {
                  reportFailure(error);
                }
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      <div aria-live="polite" className="text-sm">
        {acknowledgement ? <p>{acknowledgement}</p> : null}
      </div>

      {snapshot.dataSources.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Database aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No data sources yet</EmptyTitle>
            <EmptyDescription>
              Register a manual source or upload a UTF-8 CSV to bring data in without a provider
              connection.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul aria-label="Data sources" className="flex flex-col gap-3">
          {snapshot.dataSources.map((dataSource) => {
            const latestRun = latestRunBySource.get(dataSource.id);
            const archived = dataSource.status === "archived";
            const importable =
              canImport &&
              !archived &&
              dataSource.source_type === "csv_import" &&
              Boolean(dataSource.storage_path);
            return (
              <li key={dataSource.id}>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex flex-wrap items-center gap-2">
                      {dataSource.name}
                      <Badge variant={archived ? "outline" : "secondary"}>
                        {sourceStatusLabels[dataSource.status]}
                      </Badge>
                      <Badge variant="outline">
                        {dataSource.source_type === "manual" ? "Manual" : "Imported"}
                      </Badge>
                    </CardTitle>
                    <CardDescription>
                      {dataSource.original_filename ?? "No uploaded file"} · last successful import{" "}
                      {formatInstant(dataSource.last_successful_import_at)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    {latestRun && latestRun.kind === "ingestion_run" ? (
                      <p className="text-sm">
                        Latest run: {runStatusLabel(latestRun.status)} ·{" "}
                        {formatInstant(latestRun.occurredAt)}
                      </p>
                    ) : null}
                    {archived ? (
                      <p className="text-sm text-muted-foreground">
                        Archived sources keep their file, runs, and activity, and cannot be imported
                        again.
                      </p>
                    ) : null}
                    <Separator />
                    <div className="flex flex-wrap gap-2">
                      {importable ? (
                        <Button
                          onClick={() => startImport.mutate(dataSource.id)}
                          disabled={startImport.isPending}
                        >
                          {dataSource.status === "failed" ? (
                            <RotateCcw data-icon="inline-start" />
                          ) : (
                            <PlayCircle data-icon="inline-start" />
                          )}
                          {dataSource.status === "failed" ? "Retry import" : "Import"}
                        </Button>
                      ) : null}
                      {canImport && !archived ? (
                        <Button
                          variant="outline"
                          onClick={() => archiveSource.mutate(dataSource.id)}
                          disabled={archiveSource.isPending}
                        >
                          <Archive data-icon="inline-start" />
                          Archive
                        </Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
