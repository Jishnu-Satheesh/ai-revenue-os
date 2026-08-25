"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ThumbsDown, ThumbsUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import type { WorkspaceRecommendationView } from "@/modules/analysis/application/read-model";

/**
 * What the narrator said, and the two ways a member may answer it.
 *
 * The triage row records a decision; the review row records whether the words
 * helped. They sit apart because they mean different things -- "we acted on
 * this" is not "this was useful" -- and both answers travel to fenced routes
 * that re-check who the member is inside the database.
 */

const LABELS: Record<WorkspaceRecommendationView["label"], string> = {
  observation: "Observation",
  recommendation: "Recommendation",
  needs_data: "Needs data",
};

const DECISION_PAST_TENSE: Record<
  NonNullable<WorkspaceRecommendationView["decision"]>["decision"],
  string
> = {
  acknowledged: "Acknowledged",
  dismissed: "Dismissed",
  planned: "Marked planned",
};

type DecisionKind = "acknowledged" | "dismissed" | "planned";

export function RecommendationControls({
  organizationId,
  recommendation,
}: {
  organizationId: string;
  recommendation: WorkspaceRecommendationView;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissOpen, setDismissOpen] = useState(false);
  const [dismissReason, setDismissReason] = useState("");

  async function answer(body: Record<string, unknown>, path: "decisions" | "feedback"): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/organizations/${organizationId}/channel-recommendations/${recommendation.id}/${path}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      // The stored answer arrives with the refreshed page. A refusal keeps
      // every control — and every typed word — exactly where it was, with a
      // line saying so: a silent failure would read as an answer nobody gave.
      if (response.ok) {
        router.refresh();
        return true;
      }
      setError(
        response.status === 403
          ? "Your role cannot record this answer."
          : "The answer could not be recorded just now. It is kept below — try again.",
      );
      return false;
    } catch {
      setError("The answer could not be recorded just now. It is kept below — try again.");
      return false;
    } finally {
      setPending(false);
    }
  }

  function decide(kind: DecisionKind, reason?: string) {
    return answer(
      reason === undefined ? { decision: kind } : { decision: kind, reason },
      "decisions",
    );
  }

  const reasonLength = dismissReason.trim().length;

  return (
    <section
      aria-label={`Recommendation: ${recommendation.headline}`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3"
    >
      <div className="flex items-center gap-1.5">
        <StatusBadge label={LABELS[recommendation.label]} tone="neutral" />
      </div>

      <p className="text-sm font-medium leading-snug">{recommendation.headline}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">{recommendation.detail}</p>

      {recommendation.supportedActions.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs leading-relaxed">
          {recommendation.supportedActions.map((action) => (
            <li key={action} className="flex gap-1.5">
              <span aria-hidden="true" className="text-muted-foreground">
                →
              </span>
              <span>{action}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {recommendation.limitations.length > 0 ? (
        <p className="text-[11px] italic leading-relaxed text-muted-foreground">
          {recommendation.limitations.join(" ")}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-[11px] font-medium text-warning">
          {error}
        </p>
      ) : null}

      {recommendation.decision ? (
        <p className="text-[11px] font-medium text-muted-foreground">
          {DECISION_PAST_TENSE[recommendation.decision.decision]} ·{" "}
          {recommendation.decision.actorName} ·{" "}
          {new Date(recommendation.decision.createdAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
          {recommendation.decision.reason ? (
            <span className="block font-normal italic">
              “{recommendation.decision.reason}”
            </span>
          ) : null}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => decide("acknowledged")}
          >
            Acknowledge
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => decide("planned")}
          >
            Mark planned
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={pending}
            onClick={() => setDismissOpen(true)}
          >
            Dismiss
          </Button>
        </div>
      )}

      <div className="flex items-center gap-1 border-t border-border pt-2">
        <span className="sr-only">Was this helpful?</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1 text-muted-foreground"
          aria-pressed={recommendation.myFeedback === true}
          disabled={pending}
          onClick={() => answer({ helpful: true }, "feedback")}
        >
          <ThumbsUp aria-hidden="true" className="size-3.5" />
          Helpful
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1 text-muted-foreground"
          aria-pressed={recommendation.myFeedback === false}
          disabled={pending}
          onClick={() => answer({ helpful: false }, "feedback")}
        >
          <ThumbsDown aria-hidden="true" className="size-3.5" />
          Not helpful
        </Button>
      </div>

      <Dialog open={dismissOpen} onOpenChange={setDismissOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dismiss this recommendation</DialogTitle>
            <DialogDescription>
              Say why in a few words. The reason is kept with the answer so the
              record explains itself later.
            </DialogDescription>
          </DialogHeader>
          <textarea
            aria-label="Dismissal reason"
            className="min-h-20 w-full rounded-lg border border-border bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={dismissReason}
            onChange={(event) => setDismissReason(event.target.value)}
            placeholder="What makes this wrong or not useful for us?"
          />
          {error ? (
            <p role="alert" className="text-[11px] font-medium text-warning">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDismissOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pending || reasonLength < 3}
              onClick={async () => {
                // The dialog stays open on a refused answer: the member's
                // words outlive the failure and the reason is shown inline.
                const recorded = await decide("dismissed", dismissReason.trim());
                if (recorded) {
                  setDismissOpen(false);
                  setDismissReason("");
                }
              }}
            >
              Dismiss
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
