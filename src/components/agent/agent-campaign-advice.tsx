"use client";

import { useState } from "react";
import { ArrowUpRightIcon, CheckIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  adviseCampaign,
  buildCampaignMarkerReceipts,
  buildPrefilledBriefUrl,
  campaignBundleLink,
  labelCampaignEstimate,
  type AdviseCampaignOutcome,
  type AdviseCampaignSeams,
  type CampaignAdviceReasonCode,
  type CampaignEstimate,
  type CampaignEvidenceSnapshot,
} from "@/modules/agent-chat/application/campaign-advise";
import type { ThreadSummary } from "@/modules/agent-chat/infrastructure/thread-repository";

/** Opportunity binding the draft request admits. Absent in the drawer today. */
export type CampaignAdviceOpportunity = { id: string; version: number };

/** Full advice context. Absent in the drawer today — nothing is invented to fill it. */
export type CampaignAdviceContext = {
  assertions: Array<{ key: string; expectedOutcome: string }>;
  evidenceSnapshot: CampaignEvidenceSnapshot;
  evidenceSnapshotFreezable: boolean;
  marketProfile: { versionId: string; digest: string } | null;
  policyPass: boolean;
  capabilityPass: boolean;
  schedulePass: boolean;
  audienceReady: boolean;
  estimate: CampaignEstimate;
};

export type AgentCampaignAdviceProps = {
  organizationId: string;
  actorId?: string;
  threadId: string | null;
  thread: ThreadSummary | null;
  canDraft: boolean;
  isViewer: boolean;
  opportunity?: CampaignAdviceOpportunity | null;
  advice?: CampaignAdviceContext | null;
  /** Injected seams for tests and future wiring; defaults post to the live routes. */
  seams?: AdviseCampaignSeams;
};

type Outcome =
  | { kind: "draft"; result: Extract<AdviseCampaignOutcome, { outcome: "draft_requested" }> }
  | { kind: "brief"; briefUrl: string; reasonCodes: CampaignAdviceReasonCode[] };

type RecommendationState = "idle" | "saved" | "planned" | "snoozed" | "dismissed";

function defaultFetchSeams(organizationId: string, opportunityId: string): AdviseCampaignSeams {
  async function postJson(path: string, payload: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
      outcome?: unknown;
      requestId?: unknown;
      draftRequestStatus?: unknown;
    } | null;
    if (!response.ok) {
      throw new Error(body?.error?.message ?? `Request failed (${response.status}).`);
    }
    return body;
  }
  return {
    drafts: {
      requestDraft: async (args) => {
        const body = (await postJson(
          `/api/organizations/${organizationId}/opportunities/${opportunityId}/campaign-draft`,
          {
            opportunityVersion: args.opportunityVersion,
            objective: args.objective,
            audience: args.audience,
            assertions: args.assertions,
            idempotencyKey: args.idempotencyKey,
          },
        )) as { outcome: unknown; requestId: unknown; draftRequestStatus: unknown };
        if (
          (body.outcome !== "created" && body.outcome !== "replayed") ||
          typeof body.requestId !== "string"
        ) {
          throw new Error("The draft request could not be recorded. Nothing was created.");
        }
        return {
          outcome: body.outcome,
          requestId: body.requestId,
          draftRequestStatus:
            typeof body.draftRequestStatus === "string" ? body.draftRequestStatus : "pending",
        };
      },
    },
    links: {
      setThreadLinks: async (args) => {
        await postJson(
          `/api/organizations/${organizationId}/agent/threads/${args.threadId}/links`,
          { draftRequestId: args.draftRequestId },
        );
        return { threadId: args.threadId };
      },
    },
  };
}

/**
 * The `Draft advice for your review` tab card (spec section 11).
 *
 * Advice renders with citations, the exact evidence window, limitations,
 * and cost/impact inputs labeled as estimates with assumptions on the
 * same surface. The primary button initiates campaign creation through
 * `adviseCampaign`: eligible advice admits one atomic governed draft
 * request (never approval, never publish, never spend); anything else
 * resolves to a pre-filled `/campaigns/new` brief with named reason
 * codes — never a silent upgrade. The secondary button saves a manual
 * outside-platform recommendation with plan/snooze/dismiss semantics
 * that never auto-completes.
 */
export function AgentCampaignAdvice({
  organizationId,
  actorId,
  threadId,
  thread,
  canDraft,
  isViewer,
  opportunity = null,
  advice = null,
  seams,
}: AgentCampaignAdviceProps) {
  const [objective, setObjective] = useState("");
  const [audience, setAudience] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [requestedIntent, setRequestedIntent] = useState<{
    objective: string;
    audience: string;
  } | null>(null);
  const [recommendation, setRecommendation] = useState<RecommendationState>("idle");

  const gated = !canDraft || isViewer;
  const ready = objective.trim().length > 0 && audience.trim().length > 0;
  const invalidated =
    outcome?.kind === "draft" &&
    requestedIntent !== null &&
    (requestedIntent.objective !== objective.trim() ||
      requestedIntent.audience !== audience.trim());

  const linkedDraftRequestId = outcome?.kind === "draft" ? outcome.result.draftRequestId : null;
  const priorDraftRequestId = linkedDraftRequestId ?? thread?.linkedDraftRequestId ?? null;

  async function initiate() {
    if (!ready || pending) return;
    if (!threadId) {
      setError("No conversation yet. Send a message first — the draft links back to this chat.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (opportunity && advice && actorId) {
        const result = await adviseCampaign(
          {
            organizationId,
            actorId,
            threadId,
            permissions: gated ? [] : ["campaign.create"],
            opportunity: { id: opportunity.id, version: opportunity.version },
            objective: objective.trim(),
            audience: audience.trim(),
            assertions: advice.assertions,
            evidenceSnapshot: advice.evidenceSnapshot,
            evidenceSnapshotFreezable: advice.evidenceSnapshotFreezable,
            marketProfile: advice.marketProfile,
            policyPass: advice.policyPass,
            capabilityPass: advice.capabilityPass,
            schedulePass: advice.schedulePass,
            audienceReady: advice.audienceReady,
            estimate: advice.estimate,
          },
          seams ?? defaultFetchSeams(organizationId, opportunity.id),
        );
        if (result.outcome === "draft_requested") {
          setOutcome({ kind: "draft", result });
          setRequestedIntent({ objective: objective.trim(), audience: audience.trim() });
        } else {
          setOutcome({ kind: "brief", briefUrl: result.briefUrl, reasonCodes: result.reasonCodes });
        }
      } else {
        // No opportunity is bound to this chat, so there is no draft path:
        // resolve to the pre-filled brief with the reason named. The draft
        // seams are never touched on this path.
        const reasonCodes: CampaignAdviceReasonCode[] = [];
        if (gated) reasonCodes.push("CAMPAIGN_REQUIRES_CREATE");
        reasonCodes.push("ADVICE_NO_OPPORTUNITY");
        setOutcome({
          kind: "brief",
          briefUrl: buildPrefilledBriefUrl({
            organizationId,
            objective: objective.trim(),
            audience: audience.trim(),
            reasonCodes,
          }),
          reasonCodes,
        });
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The draft request could not be recorded. Nothing was created.",
      );
    } finally {
      setPending(false);
    }
  }

  const estimate =
    outcome?.kind === "draft"
      ? outcome.result.estimate
      : advice
        ? labelCampaignEstimate(advice.estimate)
        : null;

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          Draft advice for your review. Estimates on this surface state their inputs and assumptions
          next to the numbers.
        </p>

        {estimate ? (
          <div className="flex flex-col gap-1 rounded-lg border border-border p-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Badge variant="secondary">Estimate</Badge>
              <span>{estimate.valueText}</span>
            </p>
            <p className="text-xs text-muted-foreground">Inputs: {estimate.inputs.join("; ")}</p>
            <p className="text-xs text-muted-foreground">
              Assumptions: {estimate.assumptions.join("; ")}
            </p>
          </div>
        ) : null}

        {priorDraftRequestId ? (
          <div className="flex flex-col gap-2" aria-label="Draft request progress">
            {(outcome?.kind === "draft"
              ? outcome.result.markers
              : buildCampaignMarkerReceipts("requested")
            ).map((marker) => (
              <Marker key={marker.stage} variant="border">
                <MarkerIcon
                  aria-label={marker.state === "pending" ? `${marker.label} pending` : marker.label}
                >
                  {marker.state === "pending" ? null : <CheckIcon aria-hidden="true" />}
                </MarkerIcon>
                <MarkerContent>
                  {marker.label}
                  {marker.stage === "requested" ? (
                    <span className="text-muted-foreground"> · {priorDraftRequestId}</span>
                  ) : null}
                </MarkerContent>
              </Marker>
            ))}
            {(() => {
              const link = campaignBundleLink(organizationId, {
                draftRequestId: priorDraftRequestId,
                ...(thread?.linkedCampaignId ? { campaignId: thread.linkedCampaignId } : {}),
              });
              return (
                <Marker asChild>
                  <a href={link.href}>
                    <MarkerIcon>
                      <ArrowUpRightIcon aria-hidden="true" />
                    </MarkerIcon>
                    <MarkerContent>Campaign Bundle review</MarkerContent>
                  </a>
                </Marker>
              );
            })()}
          </div>
        ) : null}

        <label className="flex flex-col gap-1 text-xs font-medium">
          Objective
          <input
            aria-label="Objective"
            className="rounded-lg border border-border bg-background p-2 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            placeholder="What the draft must achieve"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Audience
          <input
            aria-label="Audience"
            className="rounded-lg border border-border bg-background p-2 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={audience}
            onChange={(event) => setAudience(event.target.value)}
            placeholder="Who the draft speaks to"
          />
        </label>

        {invalidated ? (
          <p role="alert" className="text-xs font-medium text-warning">
            Advice changed since the draft was requested — review again before relying on it. A
            fresh request replaces the stale one; nothing was approved or published.
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-xs font-medium text-warning">
            {error}
          </p>
        ) : null}

        {outcome?.kind === "brief" ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-2">
            <p className="text-xs text-muted-foreground">
              No draft was created ({outcome.reasonCodes.join(", ")}). Continue in the campaign
              brief with your intent pre-filled — never a silent upgrade.
            </p>
            <a
              className="text-xs font-medium text-primary underline-offset-4 hover:underline"
              href={outcome.briefUrl}
            >
              Open prefilled brief
            </a>
          </div>
        ) : null}

        <div className="flex gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  type="button"
                  disabled={gated || !ready || pending}
                  onClick={initiate}
                  title={
                    gated
                      ? "Needs the campaign.create grant — enforcement stays server-side."
                      : !ready
                        ? "State the objective and audience first."
                        : "Request one governed draft. Draft creation is never approval, never publish, never spend."
                  }
                >
                  Initiate campaign draft
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {gated
                ? "Needs the campaign.create grant — enforcement stays server-side."
                : "Request one governed draft. Draft creation is never approval, never publish, never spend."}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isViewer}
                  onClick={() => setRecommendation("saved")}
                  title={
                    isViewer
                      ? "Viewers read answers only — ask an operator to save this."
                      : "Save a manual outside-platform action. It never completes itself."
                  }
                >
                  Save to recommendations
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {isViewer
                ? "Viewers read answers only — ask an operator to save this."
                : "Save a manual outside-platform action. It never completes itself."}
            </TooltipContent>
          </Tooltip>
        </div>

        {recommendation !== "idle" ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-2">
            <p className="text-xs text-muted-foreground">
              Saved as a manual outside-platform action
              {recommendation === "saved" ? "" : ` — ${recommendation}`}. It never completes itself;
              the work happens outside the platform.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRecommendation("planned")}
              >
                Plan
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRecommendation("snoozed")}
              >
                Snooze
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRecommendation("dismissed")}
              >
                Dismiss
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
