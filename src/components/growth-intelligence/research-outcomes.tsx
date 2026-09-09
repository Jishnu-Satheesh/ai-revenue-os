"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  ResearchPipelineView,
  ResearchSourceDescriptor,
} from "@/modules/growth-intelligence/application/research-read-model";

function formatDay(value: string): string {
  return new Date(value).toLocaleDateString("en-AE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function OutcomeSources({ sources }: { sources: readonly ResearchSourceDescriptor[] }) {
  if (sources.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
      {sources.map((source) =>
        source.availability === "source-unavailable" ? (
          <li key={source.id}>Source evidence no longer available · {source.domain}</li>
        ) : (
          <li key={source.id}>
            <a
              className="font-medium break-all underline underline-offset-4"
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {source.publisher ?? source.url}
            </a>
          </li>
        ),
      )}
    </ul>
  );
}

function OutcomeCard({
  organizationId,
  outcome,
  canManage,
  lastSuccessLabel,
}: {
  organizationId: string;
  outcome: ResearchPipelineView;
  canManage: boolean;
  lastSuccessLabel: boolean;
}) {
  const [retryState, setRetryState] = useState<"idle" | "working" | "requested" | "failed">("idle");
  const retryable = canManage && outcome.retry.eligible && outcome.outcomeLinks.retry !== null;

  async function retry() {
    if (!outcome.outcomeLinks.retry) return;
    setRetryState("working");
    try {
      const response = await fetch(outcome.outcomeLinks.retry, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
      });
      if (!response.ok) {
        setRetryState("failed");
        return;
      }
      setRetryState("requested");
    } catch {
      setRetryState("failed");
    }
  }

  return (
    <Card data-testid={`research-outcome-${outcome.pipelineId}`}>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{outcome.stageDisplay}</CardTitle>
          <Badge variant="secondary">{outcome.scopeLabel}</Badge>
          {lastSuccessLabel || outcome.settingsMatchCurrent === false ? (
            <Badge variant="outline">Earlier research settings</Badge>
          ) : null}
        </div>
        <CardDescription>
          {formatDay(outcome.stageChangedAt)}
          {outcome.settingsSummary?.city ? ` · ${outcome.settingsSummary.city}` : null}
          {outcome.safeFailureCode ? ` · ${outcome.safeFailureCode}` : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {outcome.settingsSummary &&
        (outcome.settingsSummary.topics.length > 0 ||
          outcome.settingsSummary.competitorNames.length > 0) ? (
          <p className="text-xs text-muted-foreground">
            Followed{" "}
            {[...outcome.settingsSummary.topics, ...outcome.settingsSummary.competitorNames].join(
              ", ",
            )}
          </p>
        ) : null}
        {outcome.retry.eligible && outcome.retry.reason === null ? (
          <p className="text-muted-foreground">
            Findings are saved. Only the analysis step runs again — research is not refetched.
          </p>
        ) : null}
        {!outcome.retry.eligible && outcome.retry.reason ? (
          <p className="text-xs text-muted-foreground">{outcome.retry.reason}</p>
        ) : null}
        <OutcomeSources sources={outcome.sources} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <a
            className="font-medium text-primary underline-offset-4 hover:underline"
            href={outcome.outcomeLinks.self}
          >
            View status
          </a>
          {outcome.outcomeLinks.workspace ? (
            <a
              className="font-medium text-primary underline-offset-4 hover:underline"
              href={outcome.outcomeLinks.workspace}
            >
              Open in insights
            </a>
          ) : null}
          {retryable ? (
            <Button
              variant="outline"
              size="sm"
              disabled={retryState === "working" || retryState === "requested"}
              onClick={retry}
            >
              <RotateCcw aria-hidden="true" />
              Retry analysis
            </Button>
          ) : null}
          {retryState === "requested" ? (
            <span className="text-muted-foreground">Retry requested.</span>
          ) : null}
          {retryState === "failed" ? (
            <span className="text-destructive">Retry did not complete. Nothing changed.</span>
          ) : null}
        </div>
        <span className="hidden">{organizationId}</span>
      </CardContent>
    </Card>
  );
}

/**
 * Retained research outcomes inside Insights & market: same-branch history
 * with prior settings marked as earlier settings (never current support),
 * the last successful result kept visible across replacement and failure,
 * exact status/workspace links per outcome, and the eligible analysis retry.
 */
export function ResearchOutcomes({
  organizationId,
  history,
  lastSuccess,
  canManage,
}: {
  organizationId: string;
  history: readonly ResearchPipelineView[];
  lastSuccess: ResearchPipelineView | null;
  canManage: boolean;
}) {
  const retained =
    lastSuccess && !history.some((outcome) => outcome.pipelineId === lastSuccess.pipelineId)
      ? [lastSuccess, ...history]
      : history;
  if (retained.length === 0) return null;
  return (
    <section aria-label="Research outcomes" className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">Research outcomes</h3>
      {retained.map((outcome, index) => (
        <OutcomeCard
          key={outcome.pipelineId}
          organizationId={organizationId}
          outcome={outcome}
          canManage={canManage}
          lastSuccessLabel={index === 0 && lastSuccess !== null}
        />
      ))}
    </section>
  );
}
