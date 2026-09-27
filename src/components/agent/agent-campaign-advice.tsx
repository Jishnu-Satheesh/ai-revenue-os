"use client";

import { useState } from "react";
import { ArrowUpRightIcon, CheckIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  buildCampaignMarkerReceipts,
  campaignBundleLink,
  type AdviseCampaignSeams,
  type CampaignEstimate,
  type CampaignEvidenceSnapshot,
  type IdeaDraftOutcome,
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
  /** Retained for call-site stability; the form-first flow is removed (see below). */
  opportunity?: CampaignAdviceOpportunity | null;
  /** Retained for call-site stability; the form-first flow is removed (see below). */
  advice?: CampaignAdviceContext | null;
  /**
   * Retained for call-site stability; ignored. Drafts are requested
   * server-side on pick through the answers route — the client-side draft
   * path (and its seams) is removed.
   */
  seams?: AdviseCampaignSeams;
  /**
   * Pick-to-draft envelope from the answers route: draft id plus inline
   * approve action plus Studio hyperlink in one payload — or the retained
   * pre-filled brief when the pick was ineligible.
   */
  ideaDraft?: IdeaDraftOutcome | null;
};

type RecommendationState = "idle" | "saved" | "planned" | "snoozed" | "dismissed";

/**
 * The `Draft advice for your review` card (spec section 11, ideas-first).
 *
 * There is no form here: the pick happens on the ideas questionnaire card,
 * and the answers route calls the draft seam immediately in the same POST.
 * This card renders the result — the picked idea, the draft receipt with
 * its exact-version binding, the inline review-and-approve button, and the
 * Studio hyperlink — or the pre-filled `/campaigns/new` brief with named
 * reason codes when the pick was ineligible. Draft creation is never
 * approval, never publish, never spend; approval binds the exact version
 * in review, and material edits need a new request. The secondary button
 * saves a manual outside-platform recommendation with plan/snooze/dismiss
 * semantics that never auto-completes.
 */
export function AgentCampaignAdvice({
  organizationId,
  thread,
  canDraft,
  isViewer,
  ideaDraft = null,
}: AgentCampaignAdviceProps) {
  const [recommendation, setRecommendation] = useState<RecommendationState>("idle");

  const gated = !canDraft || isViewer;
  const draftRequestId =
    ideaDraft?.outcome === "draft_requested" ? ideaDraft.draftRequestId : null;
  const priorDraftRequestId = draftRequestId ?? thread?.linkedDraftRequestId ?? null;
  const markers =
    ideaDraft?.outcome === "draft_requested"
      ? ideaDraft.markers
      : buildCampaignMarkerReceipts("requested");

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          Draft advice for your review. Pick an idea above — the draft request starts from your
          pick, and approval stays in review.
        </p>

        {ideaDraft ? (
          <div className="flex flex-col gap-1 rounded-lg border border-border p-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <span>{ideaDraft.idea.title}</span>
              {ideaDraft.idea.recommended ? <Badge variant="secondary">Recommended</Badge> : null}
            </p>
            <p className="text-xs text-muted-foreground">{ideaDraft.idea.description}</p>
          </div>
        ) : null}

        {ideaDraft?.outcome === "draft_requested" ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-2">
            {ideaDraft.replayed ? (
              <p className="text-xs text-muted-foreground">
                Already requested — showing the kept draft. Nothing was created twice.
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Version {ideaDraft.adviceFingerprint.slice(0, 8)} — approval binds this exact
              version; edits need a new request. Draft creation is never approval, never publish,
              never spend.
            </p>
            <div className="flex flex-wrap gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button
                      type="button"
                      disabled={gated}
                      asChild={!gated}
                      title={
                        gated
                          ? "Needs the campaign.create grant — enforcement stays server-side."
                          : "Opens review for this exact version. Approval binds the version shown; edits need a new request."
                      }
                    >
                      {gated ? (
                        <span>Review and approve this version</span>
                      ) : (
                        <a href={ideaDraft.approveAction.href}>Review and approve this version</a>
                      )}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {gated
                    ? "Needs the campaign.create grant — enforcement stays server-side."
                    : "Opens review for this exact version. Approval binds the version shown; edits need a new request."}
                </TooltipContent>
              </Tooltip>
              <Button type="button" variant="outline" asChild>
                <a href={ideaDraft.studioLink.href}>Open in Studio</a>
              </Button>
            </div>
          </div>
        ) : null}

        {priorDraftRequestId ? (
          <div className="flex flex-col gap-2" aria-label="Draft request progress">
            {markers.map((marker) => (
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
              const link =
                ideaDraft?.outcome === "draft_requested"
                  ? ideaDraft.studioLink
                  : campaignBundleLink(organizationId, {
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

        {ideaDraft?.outcome === "brief_prefilled" ? (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-2">
            <p className="text-xs text-muted-foreground">
              No draft was created ({ideaDraft.reasonCodes.join(", ")}). Continue in the campaign
              brief with your intent pre-filled — never a silent upgrade.
            </p>
            <a
              className="text-xs font-medium text-primary underline-offset-4 hover:underline"
              href={ideaDraft.briefUrl}
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
