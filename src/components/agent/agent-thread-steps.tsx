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
  /**
   * Genuine clarify card on screen: the turn settled and now waits on the
   * user, not the pipeline. Renders an awaiting row with no spinner and no
   * status role — never a second in-progress row.
   */
  awaitingUser?: boolean;
  /** Base path for the Growth Intelligence research tab link. */
  growthIntelligenceHref?: string;
  className?: string;
};

const INTENT_LABEL: Record<AgentIntent, string> = {
  answer_memory: "Memory answer",
  business_advice: "Business advice",
  channel_assessment: "Channel assessment",
  report_intake: "Report intake",
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
 * intent>`, the context step becomes `Reviewed available business context`, and
 * saved source references become `Linked research project`, `Linked draft
 * request`, or `Linked campaign`. Intent and mode never prove source completion. No research
 * area is ever named — the thread carries none, so the active row reads the
 * plain `Researching…` rather than inventing one. A genuine clarify card
 * (model-judged low-confidence ambiguous only) leaves the turn settled and
 * waiting on the user: `awaitingUser` renders one muted awaiting row with
 * no spinner and no status role, so the steps never spin as if working
 * while the question sits with the user. The Growth Intelligence
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
  awaitingUser = false,
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
  // (`Thinking…`) until a real lane signal arrives (intent or
  // or a linked project). It also never claims a finished research row on
  // its own — done rows need the same real research signal.
  const researchLane =
    intent === "research_once" ||
    intent === "watch" ||
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
          <MarkerIcon aria-label="Context reviewed">
            <CheckIcon aria-hidden="true" />
          </MarkerIcon>
          <MarkerContent>Reviewed available business context</MarkerContent>
        </Marker>
      ) : null}

      {phase === "done" && thread?.linkedResearchProjectId && giHref ? (
        <Marker asChild className={DONE_ROW_CLASS} data-source-id={thread.linkedResearchProjectId}>
          <a href={giHref}>
            <MarkerIcon>
              <ArrowUpRightIcon aria-hidden="true" />
            </MarkerIcon>
            <MarkerContent>Linked research project · Open Market Intelligence</MarkerContent>
          </a>
        </Marker>
      ) : null}

      {phase === "done" && thread?.linkedDraftRequestId ? (
        <Marker asChild className={DONE_ROW_CLASS} data-source-id={thread.linkedDraftRequestId}>
          <a href={`/organizations/${thread.organizationId}/campaigns`}>
            <MarkerIcon>
              <ArrowUpRightIcon aria-hidden="true" />
            </MarkerIcon>
            <MarkerContent>Linked draft request · Open campaigns</MarkerContent>
          </a>
        </Marker>
      ) : null}

      {phase === "done" && thread?.linkedCampaignId ? (
        <Marker asChild className={DONE_ROW_CLASS} data-source-id={thread.linkedCampaignId}>
          <a href={`/organizations/${thread.organizationId}/campaigns/${thread.linkedCampaignId}`}>
            <MarkerIcon>
              <ArrowUpRightIcon aria-hidden="true" />
            </MarkerIcon>
            <MarkerContent>Linked campaign · Open campaign</MarkerContent>
          </a>
        </Marker>
      ) : null}

      {thread && thread.mode === "deepthink" ? (
        <Marker>
          <MarkerIcon aria-label="DeepThink mode">
            <BrainIcon aria-hidden="true" />
          </MarkerIcon>
          <MarkerContent>DeepThink mode</MarkerContent>
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

      {phase === "done" && awaitingUser ? (
        <Marker>
          <MarkerContent className="text-muted-foreground">
            Waiting for your answer — nothing is running.
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
