"use client";

import { ArrowUpRightIcon, CheckIcon, CircleAlertIcon } from "lucide-react";

import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AgentIntent } from "@/domain/agent-router/intents";
import type { ThreadSummary } from "@/modules/agent-chat/infrastructure/thread-repository";

export type AgentStepPhase = "idle" | "routing" | "done" | "error";

export type AgentThreadStepsProps = {
  phase: AgentStepPhase;
  /** Intent returned by the classify-only route (null until routed). */
  intent?: AgentIntent | null;
  /** Safe reason codes returned alongside the intent. */
  reasonCodes?: string[];
  /** Active or reopened thread (links drive the receipt markers). */
  thread?: ThreadSummary | null;
  /** Honest failure copy when the pipeline fails. */
  error?: string | null;
  /** Base path for the Growth Intelligence research tab link. */
  growthIntelligenceHref?: string;
  className?: string;
};

const INTENT_LABEL: Record<AgentIntent, string> = {
  answer_memory: "Memory answer",
  research_once: "One-time research",
  watch: "Keep monitoring",
  campaign_advice: "Campaign advice",
  profile_scope_change: "Profile scope change",
};

/**
 * Honest pipeline markers for one agent turn (spec section 5.2). Steps use
 * the installed Marker primitive exactly: Marker + MarkerIcon +
 * MarkerContent. The in-progress step carries role="status" with a Spinner;
 * streaming text uses a pulse shimmer; labeled dividers use
 * variant="separator"; row boundaries use variant="border"; the
 * Growth Intelligence link renders a real focusable anchor via
 * render={<a href>}. Decorative icons stay aria-hidden; icon-only Markers
 * carry an aria-label.
 */
export function AgentThreadSteps({
  phase,
  intent = null,
  reasonCodes = [],
  thread = null,
  error = null,
  growthIntelligenceHref,
  className,
}: AgentThreadStepsProps) {
  const giHref =
    growthIntelligenceHref ??
    (thread ? `/organizations/${thread.organizationId}/growth-intelligence` : null);

  return (
    <div className={cn("flex flex-col gap-2", className)} aria-label="Agent run steps">
      <Marker variant="separator">
        <MarkerContent>This run</MarkerContent>
      </Marker>

      {phase === "routing" ? (
        <Marker role="status">
          <MarkerIcon>
            <Spinner aria-hidden="true" />
          </MarkerIcon>
          <MarkerContent>
            <span className="animate-pulse">Routing your message…</span>
          </MarkerContent>
        </Marker>
      ) : null}

      {phase === "done" && intent ? (
        <Marker variant="border">
          <MarkerIcon aria-label="Routed">
            <CheckIcon aria-hidden="true" />
          </MarkerIcon>
          <MarkerContent>
            Routed to <Badge variant="secondary">{INTENT_LABEL[intent]}</Badge>
            {reasonCodes.length > 0 ? (
              <span className="text-muted-foreground"> · {reasonCodes.join(", ")}</span>
            ) : null}
          </MarkerContent>
        </Marker>
      ) : null}

      {phase === "error" ? (
        <Marker role="status" variant="border">
          <MarkerIcon aria-label="Run failed">
            <CircleAlertIcon aria-hidden="true" className="text-destructive" />
          </MarkerIcon>
          <MarkerContent>
            {error ?? "The run stopped before routing finished. Nothing was spent or changed."}
          </MarkerContent>
        </Marker>
      ) : null}

      {thread?.linkedResearchProjectId && giHref ? (
        <Marker asChild>
          <a href={giHref}>
            <MarkerIcon>
              <ArrowUpRightIcon aria-hidden="true" />
            </MarkerIcon>
            <MarkerContent>
              Linked research — open the Growth Intelligence research tab
            </MarkerContent>
          </a>
        </Marker>
      ) : null}

      {thread?.linkedDraftRequestId ? (
        <Marker variant="border">
          <MarkerIcon aria-label="Draft requested">
            <CheckIcon aria-hidden="true" />
          </MarkerIcon>
          <MarkerContent>
            Draft advice requested
            <span className="text-muted-foreground"> · {thread.linkedDraftRequestId}</span>
          </MarkerContent>
        </Marker>
      ) : null}

      {phase === "idle" && !thread ? (
        <Marker>
          <MarkerContent className="text-muted-foreground">
            Send a message to start. Steps appear here as the run moves.
          </MarkerContent>
        </Marker>
      ) : null}
    </div>
  );
}
