import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CampaignDraftAction } from "@/components/growth-intelligence/campaign-draft-action";
import { IntelligenceActions } from "@/components/growth-intelligence/intelligence-actions";
import type {
  DataGapCard,
  InsightCard,
  OpportunityCard,
  RecommendationCard,
} from "@/modules/growth-intelligence/application/read-model";

export type IntelligenceCardProps = {
  card: OpportunityCard | RecommendationCard | InsightCard | DataGapCard;
  organizationId: string;
  timeZone: string;
  /** Managers see owning-surface links; viewers see state with words, never a control. */
  canManage: boolean;
};

const EVIDENCE_LABELS = {
  computed: "From your data",
  observed: "From observed activity",
  prior: "Starting assumption",
} as const;

const DECISION_LABELS: Record<string, string> = {
  acknowledged: "Acknowledged",
  planned: "Marked planned",
  snoozed: "Snoozed",
  dismissed: "Dismissed",
  resolved: "Resolved",
  pinned: "Pinned",
  unpinned: "Unpinned",
};

function formatDay(value: string, timeZone: string): string {
  return new Date(value).toLocaleDateString("en-AE", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

function DecisionLine({
  card,
  timeZone,
}: {
  card: IntelligenceCardProps["card"];
  timeZone: string;
}) {
  if (!card.decision) return null;
  return (
    <p className="text-[11px] font-medium text-muted-foreground">
      {DECISION_LABELS[card.decision] ?? card.decision}
      {card.decidedAt ? ` · ${formatDay(card.decidedAt, timeZone)}` : null}
      {card.decision === "snoozed" && card.snoozedUntil ? (
        <span className="font-normal"> until {formatDay(card.snoozedUntil, timeZone)}</span>
      ) : null}
      {card.carriedOver && card.ageLabel ? ` · ${card.ageLabel}` : null}
    </p>
  );
}

function OpportunityBody({
  card,
  organizationId,
  timeZone,
  canManage,
}: {
  card: OpportunityCard;
  organizationId: string;
  timeZone: string;
  canManage: boolean;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {/*
          The range is never collapsed to one number. A single headline figure
          reads as a promise; the pair plus its tier reads as an estimate,
          which is what it is.
        */}
        <Field label="Estimated gross profit">
          {formatMoney(card.impactLowMinor, card.currency)} to{" "}
          {formatMoney(card.impactHighMinor, card.currency)}
        </Field>
        <Field label="Expected contribution">
          {formatMoney(card.expectedContributionMinor, card.currency)}{" "}
          <span className="text-muted-foreground">
            after {formatMoney(card.executionCostMinor, card.currency)} cost
          </span>
        </Field>
        <Field label="Time to impact">{card.timeToImpactDays} days</Field>
        <Field label="Open until">{formatDay(card.expiresAt, timeZone)}</Field>
      </div>
      {/*
        No Approve control lives here: answering an Opportunity means a
        governed draft, requested below and created by the worker. The action
        states exactly what it is, and success appears only for a committed
        request outcome with a linked draft.
      */}
      <CampaignDraftAction card={card} organizationId={organizationId} canManage={canManage} />
    </>
  );
}

function ChannelFooter({
  card,
  organizationId,
  canManage,
}: {
  card: RecommendationCard | InsightCard | DataGapCard;
  organizationId: string;
  canManage: boolean;
}) {
  if (!card.channelId) return null;
  // Mutations stay with the owning module: the workspace shows state, the
  // channel surface records answers. Viewers get the same link with viewing
  // words, never a control they cannot complete.
  return (
    <Link
      className="text-xs font-medium text-primary underline-offset-4 hover:underline"
      href={`/organizations/${organizationId}/channels/${card.channelId}`}
    >
      {canManage ? "Answer in the channel workspace" : "View in the channel workspace"}
    </Link>
  );
}

function DataGapRepair({ card, organizationId }: { card: DataGapCard; organizationId: string }) {
  const href = card.channelId
    ? `/organizations/${organizationId}/channels/${card.channelId}`
    : `/organizations/${organizationId}/channels`;
  return (
    <Link
      className="text-xs font-medium text-primary underline-offset-4 hover:underline"
      href={href}
    >
      Repair in channels
    </Link>
  );
}

export function IntelligenceCard({
  card,
  organizationId,
  timeZone,
  canManage,
}: IntelligenceCardProps) {
  const sourceLabel =
    card.source.kind === "opportunity"
      ? "Opportunity"
      : card.source.kind === "channel_recommendation"
        ? "Recommendation"
        : "Insight";
  return (
    <Card data-testid={`intelligence-card-${card.id}`}>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-base">{card.title}</CardTitle>
          <div className="flex shrink-0 flex-wrap gap-1.5">
            <Badge variant="secondary">{sourceLabel}</Badge>
            {"researchProvenance" in card && card.researchProvenance ? (
              <Badge variant="outline">From market research</Badge>
            ) : null}
            {"evidenceTier" in card ? (
              <Badge variant="outline">
                {EVIDENCE_LABELS[card.evidenceTier as keyof typeof EVIDENCE_LABELS] ??
                  card.evidenceTier}
              </Badge>
            ) : null}
            {"supportGrade" in card ? <Badge variant="outline">{card.supportGrade}</Badge> : null}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{card.detail}</p>
        <DecisionLine card={card} timeZone={timeZone} />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {"impactLowMinor" in card ? (
          <OpportunityBody
            card={card}
            organizationId={organizationId}
            timeZone={timeZone}
            canManage={canManage}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {card.evidenceWindow ? (
              <Field label="Evidence window">
                {formatDay(card.evidenceWindow.start, timeZone)} to{" "}
                {formatDay(card.evidenceWindow.end, timeZone)}
              </Field>
            ) : null}
            <Field label="Generated">{formatDay(card.generatedAt, timeZone)}</Field>
            {"supportGrade" in card ? (
              <>
                <Field label="Freshness">{card.freshness}</Field>
                <Field label="Urgency">{card.urgency}</Field>
              </>
            ) : null}
            {"missingInput" in card ? (
              <Field label="Missing input">{card.missingInput}</Field>
            ) : null}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-2">
        {"researchProvenance" in card && card.researchProvenance ? (
          <Link
            className="text-xs font-medium text-primary underline-offset-4 hover:underline"
            href={card.researchProvenance.statusPath}
          >
            View supporting outcomes
          </Link>
        ) : null}
        {"missingInput" in card ? (
          <DataGapRepair card={card} organizationId={organizationId} />
        ) : "channelId" in card && card.channelId ? (
          <ChannelFooter card={card} organizationId={organizationId} canManage={canManage} />
        ) : null}
        {"myFeedback" in card ? (
          <IntelligenceActions card={card} organizationId={organizationId} canManage={canManage} />
        ) : null}
      </CardFooter>
    </Card>
  );
}
