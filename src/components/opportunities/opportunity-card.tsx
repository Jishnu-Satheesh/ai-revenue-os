"use client";

import { AlertTriangle, Clock, Lock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { OpportunityAction, OpportunityFeedEntry } from "@/modules/decisions/application/feed";

/**
 * How much to trust the number beside it. The label is deliberately plain: an
 * operator should not have to learn a vocabulary to know whether a range came
 * from their own data or from a starting assumption.
 */
const EVIDENCE_LABELS = {
  computed: "From your data",
  observed: "From observed activity",
  prior: "Starting assumption",
} as const;

const ACTION_LABELS: Readonly<Record<OpportunityAction, string>> = {
  approved: "Approve",
  edited: "Edit",
  rejected: "Reject",
  snoozed: "Snooze",
  more_evidence_requested: "Ask for evidence",
};

const BLOCKED_COPY = {
  expired: {
    icon: Clock,
    text: "This proposal expired, so it can no longer be answered. The next cycle may raise it again.",
  },
  role_not_permitted: {
    icon: Lock,
    text: "Your role can read this proposal but not answer it. An owner, admin, or operator can.",
  },
} as const;

export function OpportunityCard({
  entry,
  timeZone,
  onAnswer,
  pendingAction,
}: {
  entry: OpportunityFeedEntry;
  timeZone: string;
  onAnswer?: (action: OpportunityAction) => void;
  pendingAction?: OpportunityAction | null;
}) {
  const blocked = entry.blockedReason ? BLOCKED_COPY[entry.blockedReason] : null;
  const BlockedIcon = blocked?.icon;

  return (
    <Card
      className="gap-4"
      data-testid="opportunity-card"
      data-opportunity-id={entry.id}
      aria-labelledby={`opportunity-title-${entry.id}`}
    >
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle id={`opportunity-title-${entry.id}`} className="text-base">
            {entry.title}
          </CardTitle>
          <Badge variant="secondary" className="shrink-0">
            {EVIDENCE_LABELS[entry.impact.evidenceTier]}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{entry.summary}</p>
      </CardHeader>

      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div>
          {/*
            The range is never collapsed to one number. A single headline figure
            reads as a promise; the pair plus its tier reads as an estimate,
            which is what it is.
          */}
          <dt className="text-xs tracking-wide text-muted-foreground uppercase">
            Estimated gross profit
          </dt>
          <dd className="text-sm font-medium">
            {formatMoney(entry.impact.lowMinor, entry.impact.currency)} to{" "}
            {formatMoney(entry.impact.highMinor, entry.impact.currency)}
          </dd>
        </div>
        <div>
          <dt className="text-xs tracking-wide text-muted-foreground uppercase">
            Expected contribution
          </dt>
          <dd className="text-sm font-medium">
            {formatMoney(entry.expectedContributionMinor, entry.currency)}
            <span className="text-muted-foreground">
              {" "}
              after {formatMoney(entry.executionCostMinor, entry.currency)} cost
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-xs tracking-wide text-muted-foreground uppercase">Time to impact</dt>
          <dd className="text-sm font-medium">{entry.timeToImpactDays} days</dd>
        </div>
        <div>
          <dt className="text-xs tracking-wide text-muted-foreground uppercase">
            {entry.isExpired ? "Expired" : "Answer before"}
          </dt>
          <dd className="text-sm font-medium">{formatMoment(entry.expiresAt, timeZone)}</dd>
        </div>
      </CardContent>

      <CardFooter className="flex flex-wrap items-center gap-2">
        {blocked && BlockedIcon ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground" role="note">
            <BlockedIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{blocked.text}</span>
          </p>
        ) : (
          entry.availableActions.map((action) => (
            <Button
              key={action}
              size="sm"
              variant={action === "approved" ? "default" : "outline"}
              disabled={Boolean(pendingAction)}
              onClick={() => onAnswer?.(action)}
            >
              {ACTION_LABELS[action]}
            </Button>
          ))
        )}
      </CardFooter>
    </Card>
  );
}

export function OpportunityCardError({ message }: { message: string }) {
  return (
    <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </p>
  );
}

function formatMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: currency || "AED",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

/** Stored in UTC, read in the organization's configured timezone. */
function formatMoment(isoTimestamp: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-AE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(isoTimestamp));
}
