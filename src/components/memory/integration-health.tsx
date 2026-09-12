"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, CircleCheck, Clock3, TriangleAlert } from "lucide-react";
import { useState } from "react";

import {
  memoryIntegrationHealthQueryOptions,
  requestCaptureRetry,
  type CaptureRetryOutcome,
  type MemoryHealthAdapterView,
  type MemoryHealthContextView,
  type MemoryHealthView,
} from "@/components/memory/query-options";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { hasMemoryPermission } from "@/domain/memory/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";

function formatInstant(value: string | null): string {
  if (!value) return "Never";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "Date not recorded";
  return `${new Date(parsed).toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

/**
 * Words for one retry attempt. HTTP success with `replayed` or `refused`
 * never reads as a new success: a replay started no work, and a refusal
 * changed nothing. Success copy appears only after the domain confirms a
 * fresh `retried` outcome.
 */
export function retryOutcomeCopy(outcome: CaptureRetryOutcome): {
  title: string;
  description: string;
  success: boolean;
} {
  switch (outcome.status) {
    case "retried":
      return {
        title: "Retry started",
        description: "The capture is pending again. It will project on the next worker pass.",
        success: true,
      };
    case "replayed":
      return {
        title: "Already retried",
        description: "This retry was already recorded. No new work started.",
        success: false,
      };
    case "refused":
      return {
        title: "Retry refused",
        description: `${outcome.reason} Nothing changed.`,
        success: false,
      };
  }
}

function AdapterRow({
  adapter,
  canRetry,
  retryTargets,
  onRetry,
  retryingId,
  outcomeFor,
}: {
  adapter: MemoryHealthAdapterView;
  canRetry: boolean;
  retryTargets: readonly RetryTarget[];
  onRetry: ((captureId: string) => void) | null;
  retryingId: string | null;
  outcomeFor: (captureId: string) => CaptureRetryOutcome | null;
}) {
  const needsAttention = adapter.failed + adapter.quarantined;
  const targets = retryTargets.filter((target) => target.sourceKind === adapter.sourceKind);
  return (
    <li className="flex min-w-0 flex-col gap-1.5 border-b py-2.5 last:border-b-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-medium break-words">{adapter.sourceKind}</span>
        {adapter.backlog > 0 ? (
          <Badge variant="outline" className="gap-1 font-normal">
            <Clock3 aria-hidden="true" className="size-3" />
            {adapter.backlog} pending
          </Badge>
        ) : adapter.completed > 0 && needsAttention === 0 ? (
          <Badge variant="outline" className="gap-1 font-normal text-success">
            <CircleCheck aria-hidden="true" className="size-3" />
            Up to date
          </Badge>
        ) : needsAttention === 0 ? (
          <Badge variant="outline" className="gap-1 font-normal">
            No captures recorded yet
          </Badge>
        ) : null}
        {needsAttention > 0 ? (
          <Badge variant="outline" className="gap-1 font-normal text-destructive">
            <TriangleAlert aria-hidden="true" className="size-3" />
            {needsAttention} need{needsAttention === 1 ? "s" : ""} attention
          </Badge>
        ) : null}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {adapter.completed} completed
        {adapter.failed > 0 ? ` · ${adapter.failed} failed` : ""}
        {adapter.quarantined > 0 ? ` · ${adapter.quarantined} quarantined` : ""}
        {adapter.obsolete > 0 ? ` · ${adapter.obsolete} obsolete` : ""} · Last success:{" "}
        {formatInstant(adapter.lastSuccessAt)}
      </p>
      {canRetry && onRetry
        ? targets.map((target) => {
            const outcome = outcomeFor(target.captureId);
            const copy = outcome ? retryOutcomeCopy(outcome) : null;
            return (
              <div key={target.captureId} className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={retryingId !== null}
                  onClick={() => onRetry(target.captureId)}
                  aria-label={`Retry ${adapter.sourceKind} capture`}
                >
                  {retryingId === target.captureId ? <Spinner className="size-3" /> : null}
                  Retry capture
                </Button>
                {copy ? (
                  <span
                    role="status"
                    className={copy.success ? "text-xs text-success" : "text-xs text-muted-foreground"}
                  >
                    {copy.title} — {copy.description}
                  </span>
                ) : null}
              </div>
            );
          })
        : null}
    </li>
  );
}

function ContextRow({ context }: { context: MemoryHealthContextView }) {
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b py-2.5 last:border-b-0">
      <span className="text-sm font-medium break-words">{context.purpose}</span>
      <span className="text-[11px] text-muted-foreground">
        {context.total === 0
          ? "No context prepared yet"
          : `${context.ready} ready · ${context.partial} partial · ${context.empty} empty · ${context.unavailable} unavailable · ${context.disabled} disabled`}
      </span>
      {context.total > 0 ? (
        <span className="text-[11px] text-muted-foreground">
          Last prepared: {formatInstant(context.lastPreparedAt)}
        </span>
      ) : null}
    </li>
  );
}

export type RetryTarget = {
  /** The exact failed or quarantined capture to requeue. Never a whole adapter. */
  captureId: string;
  sourceKind: string;
};

export type IntegrationHealthPanelProps = {
  organizationId: string;
  role: OrganizationRole;
  /**
   * Concrete retryable captures, read from a real capture listing. The panel
   * never invents a capture id from aggregate counts: without targets there
   * are no retry buttons, for owners and viewers alike.
   */
  retryTargets?: readonly RetryTarget[];
  fetchHealth?: () => Promise<unknown>;
};

/**
 * Compact connection-health panel for the memory workspace (Spec 023 §§13/14).
 *
 * Every number comes from real counts: per-adapter backlog/failures from the
 * capture queue, context use from prepared manifests, embedding backlog from
 * the snapshot counts. An empty adapter reads "No captures recorded yet",
 * never a silent success; a backlog reads as pending. Viewers see the same
 * counts but no retry affordances and no privileged ids. Mutations report
 * success only after the explicit domain outcome confirms it.
 */
export function IntegrationHealthPanel({
  organizationId,
  role,
  retryTargets = [],
  fetchHealth,
}: IntegrationHealthPanelProps) {
  const healthQuery = useQuery(
    memoryIntegrationHealthQueryOptions({ organizationId, fetchHealth }),
  );
  const [outcomes, setOutcomes] = useState<Record<string, CaptureRetryOutcome>>({});
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const privileged =
    hasMemoryPermission(role, "memory.retry_capture") ||
    hasMemoryPermission(role, "memory.manage_integrations");
  const health: MemoryHealthView | undefined = healthQuery.data;
  const canRetry = Boolean(health?.canRetry && privileged);

  const handleRetry = async (captureId: string) => {
    setRetryingId(captureId);
    try {
      const outcome = await requestCaptureRetry({ organizationId, captureId });
      setOutcomes((previous) => ({ ...previous, [captureId]: outcome }));
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <Card aria-label="Connection health">
      <CardContent className="space-y-3 px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <Activity aria-hidden="true" className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Connection health</h3>
          {healthQuery.isFetching ? (
            <span
              role="status"
              aria-label="Refreshing connection health"
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
            >
              <Spinner className="size-3" />
              Refreshing
            </span>
          ) : null}
        </div>

        {healthQuery.isPending ? (
          <div className="space-y-2" data-testid="memory-health-skeleton">
            <Skeleton className="h-8 w-full rounded-lg" />
            <Skeleton className="h-8 w-full rounded-lg" />
          </div>
        ) : healthQuery.isError || !health ? (
          <Alert aria-labelledby="memory-health-unavailable">
            <Clock3 />
            <AlertTitle id="memory-health-unavailable">Connection health is not available yet</AlertTitle>
            <AlertDescription>
              Capture and context counts could not be read. Memory search below still works; backlog
              is unknown rather than zero.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                Capture adapters
              </p>
              {health.adapters.length === 0 ? (
                <p className="py-2 text-xs text-muted-foreground">
                  No capture adapters have recorded work yet. Nothing is pending and nothing has
                  succeeded — this is an empty queue, not a healthy one.
                </p>
              ) : (
                <ul>
                  {health.adapters.map((adapter) => (
                    <AdapterRow
                      key={adapter.sourceKind}
                      adapter={adapter}
                      canRetry={canRetry}
                      retryTargets={retryTargets}
                      onRetry={canRetry ? handleRetry : null}
                      retryingId={retryingId}
                      outcomeFor={(captureId) => outcomes[captureId] ?? null}
                    />
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                Recent context use
              </p>
              {health.contexts.length === 0 ? (
                <p className="py-2 text-xs text-muted-foreground">
                  No context has been prepared yet.
                </p>
              ) : (
                <ul>
                  {health.contexts.map((context) => (
                    <ContextRow key={context.purpose} context={context} />
                  ))}
                </ul>
              )}
            </div>

            <p className="text-[11px] text-muted-foreground">
              Embedding:{" "}
              {health.embeddingBacklog === 0
                ? "up to date."
                : `${health.embeddingBacklog} awaiting embedding.`}{" "}
              Checked {formatInstant(health.serverTime)}.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
