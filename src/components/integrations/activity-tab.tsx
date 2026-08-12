"use client";

import {
  AlertTriangle,
  CircleCheck,
  CircleSlash,
  History,
  ListChecks,
  type LucideIcon,
} from "lucide-react";

import { formatInstant, runStatusLabel } from "@/components/integrations/health-status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import type { IntegrationActivity } from "@/modules/integrations/application/read-model";

type Presentation = { icon: LucideIcon; title: string; detail: string };

/**
 * Every entry reads as a sentence with an icon and a correlation identifier.
 * Audit payloads, provider bodies, and error causes are deliberately absent —
 * only the safe, already-normalized fields reach this list.
 */
function describe(entry: IntegrationActivity): Presentation {
  if (entry.kind === "ingestion_run") {
    const failed = entry.status === "failed" || entry.status === "cancelled";
    return {
      icon: failed ? AlertTriangle : entry.status === "succeeded" ? CircleCheck : History,
      title: `Run ${runStatusLabel(entry.status)}`,
      detail: `Source ${entry.sourceId}`,
    };
  }
  if (entry.kind === "health_check") {
    return {
      icon:
        entry.outcome === "passed"
          ? CircleCheck
          : entry.outcome === "warning"
            ? AlertTriangle
            : CircleSlash,
      title: `Health check ${entry.outcome}`,
      detail: `Connection ${entry.connectionId}`,
    };
  }
  return {
    icon: ListChecks,
    title: entry.eventName,
    detail: entry.entityId ? `Entity ${entry.entityId}` : "Organization-wide",
  };
}

export function ActivityTab({
  activity,
  isRefreshing,
  timeZone,
}: Readonly<{
  activity: readonly IntegrationActivity[];
  isRefreshing: boolean;
  timeZone: string;
}>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Activity
          {isRefreshing ? (
            <span
              role="status"
              aria-label="Refreshing activity"
              className="flex items-center gap-1 text-xs font-normal text-muted-foreground"
            >
              <Spinner className="size-3" />
              Refreshing
            </span>
          ) : null}
        </CardTitle>
        <CardDescription>
          Tests, syncs, imports, disconnects, and health checks, newest first, in your local time.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {activity.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <History aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No integration activity yet</EmptyTitle>
              <EmptyDescription>
                Connecting a provider, testing, syncing, or importing a source records an entry
                here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ol aria-label="Integration activity" className="flex flex-col gap-3">
            {activity.map((entry) => {
              const { icon: Icon, title, detail } = describe(entry);
              return (
                <li key={`${entry.kind}-${entry.id}`} className="flex items-start gap-3">
                  <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <div className="flex min-w-0 flex-col">
                    <span className="text-sm font-medium">{title}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {formatInstant(entry.occurredAt, timeZone)} · {detail} · correlation{" "}
                      {entry.correlationId}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
