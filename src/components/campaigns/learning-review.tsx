"use client";

import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

/**
 * The learning review: a proposal's evidence trail, its drafted lesson, and the
 * operator's three choices.
 *
 * A proposal is drafted by the evidence loop and then waits. This panel shows
 * the evidence it quotes — the outcome, the planned versus realized exposure,
 * and the verdict — beside the drafted lesson, with the hypothesis and the
 * observation kept as two separate sections rather than one narrative. Then an
 * operator decides: dismiss, keep campaign-only, or submit as a separate
 * reusable-recipe proposal under ADR 0013. Submitting sets the target artifact
 * type and status only; it promotes nothing and never mutates the source
 * campaign.
 *
 * A viewer reads everything and decides nothing: the three choices are present
 * but disabled, because deciding a lesson is a governance act.
 */

export type LearningDecision = "dismiss" | "keep_campaign_only" | "submit_for_promotion";

export type LearningProposalStatus =
  | "proposed"
  | "dismissed"
  | "campaign_only"
  | "submitted_for_promotion";

export type LearningProposalData = {
  id: string;
  campaignId: string;
  verdict: "validated_outcome" | "inconclusive" | "guardrail_breach" | "execution_only";
  evidenceTier: "computed" | "observed" | null;
  plannedExposureCount: number | null;
  realizedExposureCount: number | null;
  hypothesis: string;
  observation: string;
  proposedLesson: string;
  limitations: unknown;
  suggestedNextTest: string;
  evidenceLinks: unknown;
  status: LearningProposalStatus;
  targetArtifactType: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
};

export type LearningDecisionResult = { ok: boolean; message?: string };

const STATUS_COPY: Readonly<
  Record<LearningProposalStatus, { label: string; tone: "success" | "warning" | "neutral" }>
> = {
  proposed: { label: "Proposed", tone: "warning" },
  dismissed: { label: "Dismissed", tone: "neutral" },
  campaign_only: { label: "Kept campaign-only", tone: "neutral" },
  submitted_for_promotion: { label: "Submitted for promotion", tone: "success" },
};

const VERDICT_COPY: Readonly<Record<LearningProposalData["verdict"], string>> = {
  validated_outcome: "Validated outcome",
  inconclusive: "Inconclusive",
  guardrail_breach: "Guardrail breach",
  execution_only: "Execution only",
};

const DECISION_COPY: Readonly<Record<LearningDecision, { label: string; detail: string }>> = {
  dismiss: {
    label: "Dismiss",
    detail: "Close the proposal without keeping the lesson.",
  },
  keep_campaign_only: {
    label: "Keep campaign-only",
    detail: "Keep the lesson attached to this campaign; it generalizes nowhere.",
  },
  submit_for_promotion: {
    label: "Submit as reusable recipe",
    detail: "File a separate reusable-recipe proposal under ADR 0013. Nothing is promoted.",
  },
};

function asStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? (value as string[]).filter((v): v is string => typeof v === "string")
    : [];
}

/** An instant, rendered in the organization's timezone rather than raw UTC. */
function formatMoment(iso: string, timeZone: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
    }).format(parsed);
  } catch {
    return iso;
  }
}

function SectionHeading({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <h3 className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
      {children}
    </h3>
  );
}

function InfoRow({
  label,
  value,
  mono = false,
}: Readonly<{ label: string; value: string; mono?: boolean }>) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-right text-sm font-medium", mono && "font-mono text-xs break-all")}>
        {value}
      </dd>
    </div>
  );
}

export function LearningReview({
  proposal,
  canDecide,
  timeZone = "UTC",
  onDecide,
}: Readonly<{
  proposal: LearningProposalData | null;
  canDecide: boolean;
  timeZone?: string;
  onDecide?: (decision: LearningDecision) => Promise<LearningDecisionResult>;
}>) {
  const [pending, setPending] = useState<LearningDecision | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  if (!proposal) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No learning proposal yet</EmptyTitle>
          <EmptyDescription>
            The evidence loop proposes a lesson only after the campaign has settled, and only from
            that campaign&apos;s own evidence.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const status = STATUS_COPY[proposal.status];
  const limitations = asStringArray(proposal.limitations);

  async function decide(decision: LearningDecision) {
    if (!onDecide || pending !== null) return;
    setPending(decision);
    setDecisionError(null);
    const result = await onDecide(decision);
    setPending(null);
    if (!result.ok) setDecisionError(result.message ?? "The decision did not go through.");
  }

  return (
    <Card aria-label="Learning proposal">
      <CardHeader>
        <CardAction>
          <StatusBadge label={status.label} tone={status.tone} />
        </CardAction>
        <CardTitle>Learning proposal</CardTitle>
        <CardDescription>
          Drafted{" "}
          <time dateTime={proposal.createdAt}>{formatMoment(proposal.createdAt, timeZone)}</time>
          {proposal.decidedAt ? ` · Decided ${formatMoment(proposal.decidedAt, timeZone)}` : null}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <section className="flex flex-col gap-2">
          <SectionHeading>Evidence trail</SectionHeading>
          <dl className="divide-y rounded-md ring-1 ring-foreground/10">
            <InfoRow label="Verdict" value={VERDICT_COPY[proposal.verdict]} />
            <InfoRow label="Evidence tier" value={proposal.evidenceTier ?? "—"} />
            <InfoRow
              label="Planned exposure"
              value={
                proposal.plannedExposureCount === null ? "—" : String(proposal.plannedExposureCount)
              }
            />
            <InfoRow
              label="Realized exposure"
              value={
                proposal.realizedExposureCount === null
                  ? "—"
                  : String(proposal.realizedExposureCount)
              }
            />
          </dl>
        </section>

        <Separator />

        {/* The hypothesis and the observation are deliberately two sections, not
            one narrative. Merging them is exactly the error the table forbids. */}
        <section className="flex flex-col gap-2">
          <SectionHeading>Hypothesis</SectionHeading>
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm leading-snug">
            {proposal.hypothesis}
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <SectionHeading>Observation</SectionHeading>
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm leading-snug">
            {proposal.observation}
          </p>
        </section>

        <Separator />

        <section className="flex flex-col gap-2">
          <SectionHeading>Drafted lesson</SectionHeading>
          <p className="text-sm leading-relaxed">{proposal.proposedLesson}</p>
        </section>

        <section className="flex flex-col gap-2">
          <SectionHeading>Suggested next test</SectionHeading>
          <p className="text-sm text-muted-foreground">{proposal.suggestedNextTest}</p>
        </section>

        {limitations.length > 0 ? (
          <section className="flex flex-col gap-2">
            <SectionHeading>Limitations</SectionHeading>
            <ul className="flex flex-col gap-1.5">
              {limitations.map((limitation) => (
                <li
                  key={limitation}
                  className="flex items-start gap-2 text-xs text-muted-foreground"
                >
                  <span
                    className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/60"
                    aria-hidden="true"
                  />
                  {limitation}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <Separator />

        {proposal.status === "proposed" ? (
          <section className="flex flex-col gap-2">
            <SectionHeading>Decision</SectionHeading>
            <div className="flex flex-col gap-2">
              {(Object.keys(DECISION_COPY) as LearningDecision[]).map((decision) => (
                <div
                  key={decision}
                  className="flex items-center justify-between gap-3 rounded-md border p-2"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium">{DECISION_COPY[decision].label}</span>
                    <span className="text-xs text-muted-foreground">
                      {DECISION_COPY[decision].detail}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant={decision === "submit_for_promotion" ? "default" : "outline"}
                    disabled={!canDecide || pending !== null}
                    onClick={() => decide(decision)}
                  >
                    {DECISION_COPY[decision].label}
                  </Button>
                </div>
              ))}
            </div>
            {!canDecide ? (
              <p className="text-xs text-muted-foreground">
                Viewers can read a proposal but cannot decide it. An operator or admin records the
                decision.
              </p>
            ) : null}
            {decisionError ? (
              <Alert variant="destructive">
                <AlertTitle>Not recorded</AlertTitle>
                <AlertDescription>{decisionError}</AlertDescription>
              </Alert>
            ) : null}
          </section>
        ) : (
          <Alert>
            <AlertTitle>{status.label}</AlertTitle>
            <AlertDescription>
              {proposal.status === "submitted_for_promotion"
                ? "Submitted as a separate reusable-recipe proposal under ADR 0013. Promotion is a separate governed decision and has not happened."
                : "The proposal is closed. Its evidence and lesson stay on record."}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
