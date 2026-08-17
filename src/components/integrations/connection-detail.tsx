"use client";

import { PlayCircle, RefreshCw } from "lucide-react";

import { CapabilityList } from "@/components/integrations/capability-list";
import { DisconnectDialog } from "@/components/integrations/disconnect-dialog";
import {
  HealthStatusBadge,
  formatInstant,
  runStatusLabel,
} from "@/components/integrations/health-status";
import { MappingForm, type MappingFormValue } from "@/components/integrations/mapping-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { AlertCircle, Info } from "lucide-react";
import type { ProviderDefinition } from "@/domain/integrations/types";
import type { IntegrationBranchOption } from "@/modules/integrations/application/ports";
import type {
  IntegrationActivity,
  IntegrationHubSnapshot,
} from "@/modules/integrations/application/read-model";

type Connection = IntegrationHubSnapshot["connections"][number];

export type ConnectionAction = "test" | "sync" | "disconnect";

export function ConnectionDetail({
  connection,
  definition,
  branches,
  activity,
  canOperate,
  pendingAction,
  lastAcknowledgement,
  failureMessage,
  timeZone,
  onTest,
  onSync,
  onReplaceMappings,
  onDisconnect,
}: Readonly<{
  connection: Connection;
  definition: ProviderDefinition | undefined;
  branches: readonly IntegrationBranchOption[];
  activity: readonly IntegrationActivity[];
  canOperate: boolean;
  pendingAction: ConnectionAction | null;
  lastAcknowledgement: string | null;
  failureMessage: string | null;
  timeZone: string;
  onTest: () => void;
  onSync: () => void;
  onReplaceMappings: (mappings: MappingFormValue[]) => Promise<void>;
  onDisconnect: (confirmation: string) => void;
}>) {
  const providerName = definition?.displayName ?? connection.provider_key;
  const latestRun = activity.find(
    (entry) => entry.kind === "ingestion_run" && entry.sourceId === connection.id,
  );

  return (
    <Card className="min-h-0">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {connection.external_account_label}
          <HealthStatusBadge state={connection.health.state} />
        </CardTitle>
        <CardDescription>
          {providerName} · account {connection.external_account_id} · adapter v
          {connection.adapter_version}
          {definition ? ` · ${definition.characters.join(" · ")}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {definition?.operatorCopy ? (
          <Alert>
            <Info />
            <AlertTitle>Provider access</AlertTitle>
            <AlertDescription>{definition.operatorCopy}</AlertDescription>
          </Alert>
        ) : null}

        <Alert variant={connection.health.state === "healthy" ? "default" : "destructive"}>
          <AlertCircle />
          <AlertTitle>Connection health</AlertTitle>
          <AlertDescription>
            <p>{connection.health.explanation}</p>
            <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Last tested</dt>
                <dd>{formatInstant(connection.last_tested_at, timeZone)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Last successful sync</dt>
                <dd>{formatInstant(connection.last_successful_sync_at, timeZone)}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-muted-foreground">Next scheduled sync</dt>
                <dd>{formatInstant(connection.next_scheduled_sync_at, timeZone)}</dd>
              </div>
            </dl>
          </AlertDescription>
        </Alert>

        {canOperate ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={onTest} disabled={pendingAction !== null}>
              {pendingAction === "test" ? <Spinner /> : <PlayCircle data-icon="inline-start" />}
              Test connection
            </Button>
            <Button variant="outline" onClick={onSync} disabled={pendingAction !== null}>
              {pendingAction === "sync" ? <Spinner /> : <RefreshCw data-icon="inline-start" />}
              Sync now
            </Button>
            <DisconnectDialog
              connection={connection}
              providerName={providerName}
              isPending={pendingAction === "disconnect"}
              onConfirm={onDisconnect}
            />
          </div>
        ) : null}

        {/* Worker outcomes are only ever reported from persisted state; the
            acknowledgement below says what was accepted, never what succeeded. */}
        <div aria-live="polite" className="flex flex-col gap-2 text-sm">
          {lastAcknowledgement ? <p>{lastAcknowledgement}</p> : null}
          {failureMessage ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>The request could not be accepted</AlertTitle>
              <AlertDescription>{failureMessage}</AlertDescription>
            </Alert>
          ) : null}
          {latestRun && latestRun.kind === "ingestion_run" ? (
            <p>
              Latest run: {runStatusLabel(latestRun.status)} ·{" "}
              {formatInstant(latestRun.occurredAt, timeZone)}
            </p>
          ) : null}
        </div>

        <Separator />
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Capabilities</h3>
          <CapabilityList capabilities={connection.capabilities} />
        </section>

        <Separator />
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Branch mappings</h3>
          <MappingForm
            connectionId={connection.id}
            mappings={connection.mappings}
            branches={branches}
            canEdit={canOperate}
            onSubmit={onReplaceMappings}
          />
        </section>
      </CardContent>
    </Card>
  );
}
