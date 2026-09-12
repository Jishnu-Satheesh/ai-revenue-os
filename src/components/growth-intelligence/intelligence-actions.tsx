"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, ThumbsDown, ThumbsUp, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type {
  InsightCard,
  RecommendationCard,
} from "@/modules/growth-intelligence/application/read-model";

type ActionCard = RecommendationCard | InsightCard;

export function IntelligenceActions({
  card,
  organizationId,
  canManage,
}: {
  card: ActionCard;
  organizationId: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [snoozeUntil, setSnoozeUntil] = useState("");
  const [dismissOpen, setDismissOpen] = useState(false);
  const [dismissReason, setDismissReason] = useState("");

  const root =
    card.source.kind === "channel_recommendation"
      ? `/api/organizations/${organizationId}/channel-recommendations/${card.source.id}`
      : `/api/organizations/${organizationId}/growth-intelligence/items/${card.source.id}`;

  async function post(path: "decisions" | "feedback", body: Record<string, unknown>) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`${root}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setError(
          response.status === 403
            ? "Your role cannot record this answer."
            : "That answer was not saved. Your current view is unchanged.",
        );
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("That answer was not saved. Your current view is unchanged.");
      return false;
    } finally {
      setPending(false);
    }
  }

  function decisionBody(decision: string, extra: Record<string, unknown> = {}) {
    return card.source.kind === "synthesized_item"
      ? { decision, itemFingerprint: card.itemFingerprint, ...extra }
      : { decision, ...extra };
  }

  async function submitSnooze() {
    const timestamp = Date.parse(snoozeUntil);
    if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
      setError("Choose a future date and time.");
      return;
    }
    const saved = await post(
      "decisions",
      decisionBody("snoozed", { snoozedUntil: new Date(timestamp).toISOString() }),
    );
    if (saved) setSnoozeOpen(false);
  }

  const mayDecide = canManage && card.decision === null;
  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 border-t border-emerald-100 pt-3">
        {mayDecide ? (
          <>
            <Button
              size="sm"
              variant="outline"
              className="min-h-[38px] bg-white max-sm:min-h-[42px]"
              disabled={pending}
              onClick={() => post("decisions", decisionBody("acknowledged"))}
            >
              Acknowledge
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="min-h-[38px] bg-white max-sm:min-h-[42px]"
              disabled={pending}
              onClick={() => post("decisions", decisionBody("planned"))}
            >
              Planned
            </Button>
          </>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="icon"
            variant={card.myFeedback === true ? "default" : "outline"}
            className={
              card.myFeedback === true
                ? "min-h-[38px] min-w-[38px] max-sm:min-h-[42px] max-sm:min-w-[42px]"
                : "min-h-[38px] min-w-[38px] bg-white max-sm:min-h-[42px] max-sm:min-w-[42px]"
            }
            aria-label={`Helpful: ${card.title}`}
            aria-pressed={card.myFeedback === true}
            disabled={pending}
            onClick={() => post("feedback", { helpful: true })}
          >
            <ThumbsUp aria-hidden="true" />
          </Button>
          <Button
            size="icon"
            variant={card.myFeedback === false ? "default" : "outline"}
            className={
              card.myFeedback === false
                ? "min-h-[38px] min-w-[38px] max-sm:min-h-[42px] max-sm:min-w-[42px]"
                : "min-h-[38px] min-w-[38px] bg-white max-sm:min-h-[42px] max-sm:min-w-[42px]"
            }
            aria-label={`Not helpful: ${card.title}`}
            aria-pressed={card.myFeedback === false}
            disabled={pending}
            onClick={() => post("feedback", { helpful: false })}
          >
            <ThumbsDown aria-hidden="true" />
          </Button>
          {mayDecide ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="min-h-[38px] border-transparent bg-transparent max-sm:min-h-[42px]"
                disabled={pending}
                onClick={() => setSnoozeOpen(true)}
              >
                <Clock aria-hidden="true" />
                Snooze
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="min-h-[38px] min-w-[38px] border-transparent bg-transparent px-2 max-sm:min-h-[42px] max-sm:min-w-[42px]"
                aria-label={`Dismiss: ${card.title}`}
                disabled={pending}
                onClick={() => setDismissOpen(true)}
              >
                <X aria-hidden="true" />
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <Dialog open={snoozeOpen} onOpenChange={setSnoozeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Snooze this item</DialogTitle>
            <DialogDescription>
              It will return after the date and time you choose.
            </DialogDescription>
          </DialogHeader>
          <Input
            type="datetime-local"
            aria-label="Snooze until"
            value={snoozeUntil}
            onChange={(event) => setSnoozeUntil(event.target.value)}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSnoozeOpen(false)}>
              Cancel
            </Button>
            <Button disabled={pending || snoozeUntil === ""} onClick={submitSnooze}>
              Snooze
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dismissOpen} onOpenChange={setDismissOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dismiss this item</DialogTitle>
            <DialogDescription>
              Add a short reason so the decision remains understandable.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="Dismissal reason"
            value={dismissReason}
            onChange={(event) => setDismissReason(event.target.value)}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDismissOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending || dismissReason.trim().length < 3}
              onClick={async () => {
                const saved = await post(
                  "decisions",
                  decisionBody("dismissed", { reason: dismissReason.trim() }),
                );
                if (saved) setDismissOpen(false);
              }}
            >
              Dismiss
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
