"use client";

import { useRef, useState } from "react";
import { Check, FileText, Lightbulb } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { reportReaderPath } from "@/modules/growth-intelligence/application/report-reader";

export type ReviewableAdviceItem = {
  itemKey: string;
  kind: "action" | "finding";
  title: string;
  detail: string;
  destinationLabel: string;
};

export type ReviewAcceptOutcome = {
  itemKey: string;
  title: string;
  destination: string;
  outcome: "accepted" | "already_accepted";
};

export function acceptErrorMessage(status: number): string {
  if (status === 403) {
    return "You do not have permission to accept research for this organization.";
  }
  if (status === 404) {
    return "This report could not be found in your organization.";
  }
  return "The selection could not be accepted. Nothing was added — try again.";
}

/**
 * Review-and-accept for one report's selected draft advice. Posts the
 * selection exactly once per click (single-flight guard plus a fresh
 * idempotency key); a repeated acceptance answers already-accepted with
 * an explanation and creates nothing.
 */
export function ReportReviewDialog({
  open,
  onOpenChange,
  organizationId,
  reportVersionId,
  briefRevisionNumber,
  reportTitle,
  reportDateLabel,
  items,
  canAccept,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  reportVersionId: string;
  briefRevisionNumber: number;
  reportTitle: string;
  reportDateLabel: string;
  items: ReviewableAdviceItem[];
  canAccept: boolean;
}) {
  const [phase, setPhase] = useState<"idle" | "pending" | "done" | "failed">("idle");
  const [outcomes, setOutcomes] = useState<ReviewAcceptOutcome[]>([]);
  const [error, setError] = useState<string | null>(null);
  const flightRef = useRef(false);

  // Closing resets the review cycle so the next open starts clean. State
  // settles during render, after the reader dialog's close-seed pattern.
  const [closeSeed, setCloseSeed] = useState({ open, reportVersionId });
  if (closeSeed.open !== open || closeSeed.reportVersionId !== reportVersionId) {
    setCloseSeed({ open, reportVersionId });
    if (!open) {
      setPhase("idle");
      setOutcomes([]);
      setError(null);
    }
  }

  const toRecommendations = items.filter((item) => item.kind === "action").length;
  const toInsights = items.length - toRecommendations;
  const allReplayed =
    phase === "done" &&
    outcomes.length > 0 &&
    outcomes.every((outcome) => outcome.outcome === "already_accepted");

  async function acceptSelected() {
    if (flightRef.current) return;
    flightRef.current = true;
    setPhase("pending");
    setError(null);
    try {
      const response = await fetch(`${reportReaderPath(organizationId, reportVersionId)}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          items: items.map((item) => ({ itemKey: item.itemKey, kind: item.kind })),
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        items?: { itemKey: string; destination: string; outcome: string }[];
      } | null;
      if (!response.ok || !body || !Array.isArray(body.items)) {
        throw new Error(acceptErrorMessage(response.status));
      }
      const byKey = new Map(items.map((item) => [item.itemKey, item] as const));
      setOutcomes(
        body.items.flatMap((item) => {
          const advice = byKey.get(item.itemKey);
          if (!advice) return [];
          if (item.outcome !== "accepted" && item.outcome !== "already_accepted") return [];
          return [
            {
              itemKey: item.itemKey,
              title: advice.title,
              destination: item.destination,
              outcome: item.outcome,
            },
          ];
        }),
      );
      setPhase("done");
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "The selection could not be accepted.",
      );
      setPhase("failed");
    } finally {
      flightRef.current = false;
    }
  }

  function backToReport() {
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader className="text-left">
          <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            Report review
          </p>
          <DialogTitle className="mt-1 text-lg font-semibold">Review selected items</DialogTitle>
          <DialogDescription>
            {reportTitle} · {reportDateLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No items are selected. Go back to the report and choose the ideas worth taking
              forward.
            </p>
          ) : (
            <ul className="flex min-w-0 flex-col">
              {items.map((item) => (
                <li
                  key={item.itemKey}
                  className="flex min-w-0 items-start gap-3 border-b py-4 first:pt-0 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="min-w-0 text-sm font-semibold break-words">{item.title}</p>
                    <p className="mt-1 min-w-0 text-sm leading-relaxed text-muted-foreground break-words">
                      {item.detail}
                    </p>
                    <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary">
                      {item.kind === "action" ? (
                        <Lightbulb aria-hidden="true" className="size-3.5 shrink-0" />
                      ) : (
                        <FileText aria-hidden="true" className="size-3.5 shrink-0" />
                      )}
                      Adds to {item.destinationLabel}
                    </p>
                  </div>
                  <Check aria-hidden="true" className="mt-1 size-4 shrink-0" />
                </li>
              ))}
            </ul>
          )}
          {items.length > 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {items.length} {items.length === 1 ? "item" : "items"} selected
              {toRecommendations > 0 ? ` · ${toRecommendations} to Recommendations` : ""}
              {toInsights > 0 ? ` · ${toInsights} to Insights` : ""}. Each accepted item keeps its
              link to this report (Brief {briefRevisionNumber}).
            </p>
          ) : null}
          <p className="mt-3 text-sm text-muted-foreground">
            The platform chooses the destination from each item&apos;s type. Only these selected
            items will be added, with their report and source links.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Accepting never approves campaign work, spending or publication.
          </p>
          {!canAccept ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Accepting needs the manage permission — you can read this report.
            </p>
          ) : null}
          {phase === "failed" && error ? (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}{" "}
              <button
                type="button"
                onClick={acceptSelected}
                className="font-semibold underline-offset-2 hover:underline"
              >
                Retry
              </button>
            </p>
          ) : null}
          {phase === "done" ? (
            <div className="mt-3" role="status">
              {allReplayed ? (
                <p className="text-sm text-muted-foreground">
                  Already accepted — nothing new was added. Each item keeps its link to this
                  report.
                </p>
              ) : null}
              <ul className="mt-1 flex flex-col gap-1">
                {outcomes.map((outcome) => (
                  <li key={outcome.itemKey} className="min-w-0 text-sm break-words">
                    {outcome.outcome === "accepted" ? (
                      <span>
                        {outcome.title} — accepted to {outcome.destination}.
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {outcome.title} — already accepted; nothing new was added.
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="outline" size="sm" onClick={backToReport} className="w-full sm:w-auto">
            Back to report
          </Button>
          {canAccept ? (
            <Button
              size="sm"
              disabled={items.length === 0 || phase === "pending"}
              onClick={acceptSelected}
              className="w-full sm:w-auto"
            >
              {phase === "pending" ? "Accepting…" : "Accept selected items"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
