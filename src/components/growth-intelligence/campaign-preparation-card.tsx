"use client";

import Link from "next/link";
import { Clock3, FilePenLine } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { OpportunityCard } from "@/modules/growth-intelligence/application/read-model";

function formatDay(value: string, timeZone: string): string {
  return new Date(value).toLocaleDateString("en-AE", {
    timeZone,
    month: "short",
    day: "numeric",
  });
}

function formatTime(value: string, timeZone: string): string {
  return new Date(value).toLocaleTimeString("en-AE", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Campaign preparation section for the Your actions tab. Reads the owning
 * module's draft request states only: waiting and preparing rows explain
 * that the review link appears when ready, a ready draft links to its real
 * destination, and failures name the terminal state without inventing
 * progress or implying completion.
 */
export function CampaignPreparationCard({
  opportunities,
  organizationId,
  timeZone,
}: {
  opportunities: readonly OpportunityCard[];
  organizationId: string;
  timeZone: string;
}) {
  const withDraft = opportunities.filter((card) => card.draftRequest !== null);
  if (withDraft.length === 0) return null;
  return (
    <section aria-label="Campaign preparation" className="flex flex-col gap-4">
      <h3 className="text-lg font-bold">Campaign preparation</h3>
      <div className="flex flex-col gap-4">
        {withDraft.map((card) => {
          const draft = card.draftRequest!;
          const requested = formatDay(draft.requestedAt, timeZone);
          const updated = formatTime(draft.updatedAt, timeZone);
          if (draft.status === "completed" && draft.campaignId) {
            return (
              <Card key={card.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted"
                    >
                      <FilePenLine className="size-4 text-muted-foreground" />
                    </span>
                    <div>
                      <p className="text-sm font-bold">{card.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Draft requested {requested} · last update {updated}
                      </p>
                    </div>
                  </div>
                  <Link
                    className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                    href={`/organizations/${organizationId}/campaigns/${draft.campaignId}`}
                  >
                    Open draft
                  </Link>
                </CardContent>
              </Card>
            );
          }
          if (draft.status === "completed") {
            // Completed without a stored campaign id: the draft finished but
            // its link is unavailable. Never mislabel this as a failure.
            return (
              <Card key={card.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted"
                    >
                      <FilePenLine className="size-4 text-muted-foreground" />
                    </span>
                    <div>
                      <p className="text-sm font-bold">{card.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Draft requested {requested} · last update {updated}
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary">Draft ready</Badge>
                  <p className="w-full text-sm text-muted-foreground">
                    The draft finished, but its review link is unavailable. Nothing was changed.
                  </p>
                </CardContent>
              </Card>
            );
          }
          if (draft.status === "pending" || draft.status === "processing") {
            return (
              <Card key={card.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted"
                    >
                      <FilePenLine className="size-4 text-muted-foreground" />
                    </span>
                    <div>
                      <p className="text-sm font-bold">{card.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Draft requested {requested} · last update {updated}
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="bg-primary/10 text-primary">
                    <Clock3 aria-hidden="true" />
                    Preparing draft
                  </Badge>
                  <p className="w-full text-sm text-muted-foreground">
                    The draft is being prepared. Its review link will appear when it is ready.
                  </p>
                </CardContent>
              </Card>
            );
          }
          if (draft.status === "retryable_failed") {
            return (
              <Card key={card.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted"
                    >
                      <FilePenLine className="size-4 text-muted-foreground" />
                    </span>
                    <div>
                      <p className="text-sm font-bold">{card.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Draft requested {requested} · last update {updated}
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary">Needs retry</Badge>
                  <p className="w-full text-sm text-muted-foreground">
                    The last attempt did not finish and nothing was created. Retry from
                    Recommendations.
                  </p>
                </CardContent>
              </Card>
            );
          }
          return (
            <Card key={card.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted"
                  >
                    <FilePenLine className="size-4 text-muted-foreground" />
                  </span>
                  <div>
                    <p className="text-sm font-bold">{card.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Draft requested {requested} · last update {updated}
                    </p>
                  </div>
                </div>
                <Badge variant="secondary">
                  {draft.status === "cancelled" ? "Cancelled" : "Could not prepare"}
                </Badge>
                <p className="w-full text-sm text-muted-foreground">
                  {draft.status === "cancelled"
                    ? "The draft request was cancelled. Nothing was created."
                    : "The draft could not be prepared and will not be retried. Nothing was created."}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
