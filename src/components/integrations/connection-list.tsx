"use client";

import { HealthStatusBadge, formatInstant } from "@/components/integrations/health-status";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Plug } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IntegrationHubSnapshot } from "@/modules/integrations/application/read-model";

type Connection = IntegrationHubSnapshot["connections"][number];

export function ConnectionList({
  connections,
  selectedConnectionId,
  onSelect,
  providerNames,
}: Readonly<{
  connections: readonly Connection[];
  selectedConnectionId: string | null;
  onSelect: (connectionId: string) => void;
  providerNames: Readonly<Record<string, string>>;
}>) {
  if (connections.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Plug aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No connections yet</EmptyTitle>
          <EmptyDescription>
            Open the Catalog tab to connect a provider. Manual and CSV data live under Data sources.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ul aria-label="Connections" className="flex flex-col gap-3">
      {connections.map((connection) => {
        const selected = connection.id === selectedConnectionId;
        return (
          <li key={connection.id}>
            <Card
              // The whole card is the control so pointer and keyboard reach the
              // same target; Radix has no list-selection primitive to compose.
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              onClick={() => onSelect(connection.id)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onSelect(connection.id);
              }}
              className={cn(
                "cursor-pointer transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring",
                selected && "border-primary",
              )}
            >
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {connection.external_account_label}
                  <HealthStatusBadge state={connection.health.state} />
                </CardTitle>
                <CardDescription>
                  {providerNames[connection.provider_key] ?? connection.provider_key} ·{" "}
                  {connection.connection_mode === "fixture" ? "Fixture" : "OAuth"} · last sync{" "}
                  {formatInstant(connection.last_successful_sync_at)}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {connection.capabilities.length === 0 ? (
                  <Badge variant="outline">No capabilities derived</Badge>
                ) : (
                  connection.capabilities.map((grant) => (
                    <Badge key={grant.id} variant="outline">
                      {grant.maturity}
                    </Badge>
                  ))
                )}
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
