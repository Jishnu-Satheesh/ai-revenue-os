"use client";

import { AlertTriangle, CalendarClock, HeartPulse, Timer } from "lucide-react";

import { formatInstant, isActionRequired } from "@/components/integrations/health-status";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { IntegrationHubSnapshot } from "@/modules/integrations/application/read-model";

type Connection = IntegrationHubSnapshot["connections"][number];

function earliest(values: readonly (string | null)[]): string | null {
  const parsed = values.filter((value): value is string => Boolean(value)).sort();
  return parsed[0] ?? null;
}

function latest(values: readonly (string | null)[]): string | null {
  const parsed = values.filter((value): value is string => Boolean(value)).sort();
  return parsed.at(-1) ?? null;
}

/**
 * The workspace opens on operational truth: how many connections are healthy,
 * which ones need an operator, and when data was last and will next be
 * refreshed. Provider promotion belongs in the Catalog, not here.
 */
export function HealthSummary({
  connections,
  summary,
  timeZone,
}: Readonly<{
  connections: readonly Connection[];
  summary: IntegrationHubSnapshot["summary"];
  timeZone: string;
}>) {
  const needsAttention = connections.filter((connection) =>
    isActionRequired(connection.health.state),
  );
  const freshestSync = latest(connections.map((connection) => connection.last_successful_sync_at));
  const nextSync = earliest(connections.map((connection) => connection.next_scheduled_sync_at));

  return (
    <Card role="region" aria-label="Operational health">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HeartPulse aria-hidden="true" className="size-4" />
          Operational health
        </CardTitle>
        <CardDescription>
          {summary.healthyConnections} of {summary.totalConnections} connections healthy
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1">
            <dt className="flex items-center gap-2 text-xs text-muted-foreground uppercase">
              <AlertTriangle aria-hidden="true" className="size-3.5" />
              Action required
            </dt>
            <dd className="text-sm font-medium">
              {needsAttention.length === 1
                ? "1 connection needs attention"
                : `${needsAttention.length} connections need attention`}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="flex items-center gap-2 text-xs text-muted-foreground uppercase">
              <Timer aria-hidden="true" className="size-3.5" />
              Freshest successful sync
            </dt>
            <dd className="text-sm font-medium">{formatInstant(freshestSync, timeZone)}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="flex items-center gap-2 text-xs text-muted-foreground uppercase">
              <CalendarClock aria-hidden="true" className="size-3.5" />
              Next scheduled sync
            </dt>
            <dd className="text-sm font-medium">{formatInstant(nextSync, timeZone)}</dd>
          </div>
        </dl>

        {needsAttention.length > 0 ? (
          <>
            <Separator />
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>These connections need an operator</AlertTitle>
              <AlertDescription>
                <ul className="flex flex-col gap-1">
                  {needsAttention.map((connection) => (
                    <li key={connection.id}>
                      {connection.external_account_label} — {connection.health.explanation}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
