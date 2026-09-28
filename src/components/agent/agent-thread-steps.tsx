"use client";

import { ArrowUpRightIcon, BrainIcon, CheckIcon, CircleAlertIcon } from "lucide-react";

import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Spinner } from "@/components/ui/spinner";
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

/** Done rows read as a finished checklist: a quiet side line, never a spinner. */
const DONE_ROW_CLASS = "border-l-2 border-emerald-500/40 pl-2";

/**
 * Honest pipeline markers for one agent turn (spec section 5.2). Steps are
 * always visible inline in marker language — no collapse control, no
 * separator divider, no border container: every row is a default-variant
 * Marker (Marker + MarkerIcon + MarkerContent) at marker scale. Exactly one
 * row is ever in progress (role="status" with a Spinner and a pulse); the
 * moment the phase turns done every row is terminal — done rows carry the
 * side-line style with a CheckIcon and plain copy, never a spinner. The
 * narration resolves honestly: Thinking becomes `Understood: <plain
 * intent>`, the memory check becomes `Checked organization memory`, a
 * finished research run becomes `Research complete` with the Growth
 * Intelligence link, and a finished draft becomes `Draft ready`. No research
 * area is ever named — the thread carries none, so the active row reads the
 * plain `Researching…` rather than inventing one. The Growth Intelligence
 * link renders a real focusable anchor via <Marker asChild> wrapping a real
 * <a> child. Decorative icons stay aria-hidden; icon-only Markers carry an
 * aria-label.
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

  const draftSignals =
    intent === "campaign_advice" ||
    thread?.linkedDraftRequestId != null ||
    thread?.linkedCampaignId != null;
  // A bare `running` status never names a lane: the active row stays honest
  // (`Thinking…`) until a real lane signal arrives (intent, DeepThink mode,
  // or a linked project). It also never claims a finished research row on
  // its own — done rows need the same real research signal.
  const researchLane =
    intent === "research_once" ||
    intent === "watch" ||
    thread?.mode === "deepthink" ||
    thread?.linkedResearchProjectId != null;

  // One thing at a time: the single in-progress row names the lane that
  // owns the turn — the draft lane, the research lane (real signal only),
  // the memory check, or the bare classify before the route answers. A bare
  // `running` poll with no lane signal stays `Thinking…`, never
  // `Researching…`. Never two spinners.
  const activeLabel =
    phase !== "routing"
      ? null
      : draftSignals
        ? "Preparing draft…"
        : researchLane
          ? "Researching…"
          : intent === "answer_memory"
            ? "Checking organization memory…"
            : "Thinking…";

  return (
    <div className={cn("flex flex-col gap-2", className)} aria-label="Agent run steps">
      {activeLabel ? (
        <Marker role="status">
          <MarkerIcon>
            <Spinner aria-hidden="true" />
          </MarkerIcon>
          <MarkerContent>
            <span className="animate-pulse">{activeLabel}</span>
          </MarkerContent>
        </Marker>
      ) : null}

      {phase === "done" && intent ? (
        <Marker className={DONE_ROW_CLASS}>
          <MarkerIcon aria-label="Understood">
            <CheckIcon aria-hidden="true" />
          </MarkerIcon>
          <MarkerContent>
            Understood: {INTENT_LABEL[intent]}
            {reasonCodes.length > 0 ? (
              <span className="text-muted-foreground"> · {reasonCodes.join(", ")}</span>
            ) : null}
          </MarkerContent>
        </Marker>
      ) : null}

      {phase === "done" ? (
        <Marker className={DONE_ROW_CLASS}>
          <MarkerIcon aria-label="Memory checked">
            <CheckIcon aria-hidden="true" />
          </MarkerIcon>
          <MarkerContent>Checked organization memory</MarkerContent>
        </Marker>
      ) : null}

      {phase === "done" && researchLane ? (
        giHref ? (
          <Marker asChild className={DONE_ROW_CLASS}>
            <a href={giHref}>
              <MarkerIcon>
                <ArrowUpRightIcon aria-hidden="true" />
              </MarkerIcon>
              <MarkerContent>Research complete — open the Growth Intelligence research tab</MarkerContent>
            </a>
          </Marker>
        ) : (
          <Marker className={DONE_ROW_CLASS}>
            <MarkerIcon aria-label="Research complete">
              <CheckIcon aria-hidden="true" />
            </MarkerIcon>
            <MarkerContent>Research complete</MarkerContent>
          </Marker>
        )
      ) : null}

      {phase === "done" && draftSignals ? (
        <Marker className={DONE_ROW_CLASS}>
          <MarkerIcon aria-label="Draft ready">
            <CheckIcon aria-hidden="true" />
          </MarkerIcon>
          <MarkerContent>Draft ready</MarkerContent>
        </Marker>
      ) : null}

      {thread && thread.mode === "deepthink" ? (
        <Marker>
          <MarkerIcon aria-label="Mode switched">
            <BrainIcon aria-hidden="true" />
          </MarkerIcon>
          <MarkerContent>Switched to DeepThink</MarkerContent>
        </Marker>
      ) : null}

      {phase === "error" ? (
        <Marker role="status">
          <MarkerIcon aria-label="Run failed">
            <CircleAlertIcon aria-hidden="true" className="text-destructive" />
          </MarkerIcon>
          <MarkerContent>
            {error ?? "The run stopped before routing finished. Nothing was spent or changed."}
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
