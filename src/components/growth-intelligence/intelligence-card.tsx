import Link from "next/link";

import { Info, Zap } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { CampaignDraftAction } from "@/components/growth-intelligence/campaign-draft-action";
import { IntelligenceActions } from "@/components/growth-intelligence/intelligence-actions";
import { RecommendationWhyDialog } from "@/components/growth-intelligence/recommendation-why-dialog";
import type {
  DataGapCard,
  InsightCard,
  OpportunityCard,
  RecommendationCard,
} from "@/modules/growth-intelligence/application/read-model";

export type IntelligenceCardContextProvenance = {
  briefManifestId: string | null;
  briefStatus: "ready" | "empty" | "partial" | "unavailable" | "disabled" | null;
  synthesisManifestId: string | null;
  synthesisStatus: "ready" | "empty" | "partial" | "unavailable" | "disabled" | null;
};

export type IntelligenceCardProps = {
  card: OpportunityCard | RecommendationCard | InsightCard | DataGapCard;
  organizationId: string;
  timeZone: string;
  /** Managers see owning-surface links; viewers see state with words, never a control. */
  canManage: boolean;
  /** Already-loaded channel display names for honest scope labels; missing falls back to generic. */
  channelNames?: ReadonlyMap<string, string>;
  /** Already-loaded branch names for honest scope labels; missing falls back to channel only. */
  branchNames?: ReadonlyMap<string, string>;
  /**
   * Optional governed memory provenance (Swarm 3). Brief and synthesis
   * manifests stay distinguishable; degraded states render honest copy.
   * Absent means the caller carries no manifest lineage for this card.
   */
  contextProvenance?: IntelligenceCardContextProvenance | null;
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

function isRecommendationCard(
  card: IntelligenceCardProps["card"],
): card is RecommendationCard {
  // Data gaps carry missingInput, insights carry supportGrade, and
  // opportunities carry impactLowMinor; all three keep their existing layouts.
  // A recommendation is the only card with myFeedback and no other marker,
  // so the check cannot drift when display fields are added later.
  if ("missingInput" in card || "supportGrade" in card || "impactLowMinor" in card) return false;
  return "myFeedback" in card;
}

function joinLimitation(fragments: readonly string[]): string | null {
  const sentences = fragments
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length > 0)
    .map((fragment) => (/[.!?…]$/.test(fragment) ? fragment : `${fragment}.`));
  return sentences.length > 0 ? sentences.join(" ") : null;
}

function recommendationTag(card: RecommendationCard): string {
  return card.source.kind === "channel_recommendation" ? "Channel recommendation" : "Recommendation";
}

function ContextProvenanceBadges({
  provenance,
}: {
  provenance: IntelligenceCardContextProvenance;
}) {
  const degraded =
    (provenance.briefStatus && provenance.briefStatus !== "ready") ||
    (provenance.synthesisStatus && provenance.synthesisStatus !== "ready");
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Memory context provenance">
      {provenance.briefManifestId ? <Badge variant="outline">Research brief</Badge> : null}
      {provenance.synthesisManifestId ? <Badge variant="outline">Synthesis context</Badge> : null}
      {degraded ? (
        <span className="text-[11px] text-muted-foreground">
          Some context was unavailable; shown on cited refs only.
        </span>
      ) : null}
    </div>
  );
}

function recommendationScope(
  card: RecommendationCard,
  channelNames?: ReadonlyMap<string, string>,
  branchNames?: ReadonlyMap<string, string>,
): string {
  // A null channel means cross-market synthesis, never one channel: the
  // neutral organization-wide label keeps the card honest where the
  // prototype's illustrative channel names would invent a scope.
  if (!card.channelId) return "Organization-wide";
  const channel = channelNames?.get(card.channelId) ?? "Channel details unavailable";
  if (!card.branchId) return channel;
  const branch = branchNames?.get(card.branchId);
  return branch ? `${channel} · ${branch}` : channel;
}

function recommendationEvidence(card: RecommendationCard, timeZone: string): string {
  const window = card.evidenceWindow
    ? `${formatDay(card.evidenceWindow.start, timeZone)} to ${formatDay(card.evidenceWindow.end, timeZone)}`
    : "No evidence window";
  return `${window} · generated ${formatDay(card.generatedAt, timeZone)}`;
}

function RecommendationBody({
  card,
  organizationId,
  timeZone,
  canManage,
  channelNames,
  branchNames,
}: {
  card: RecommendationCard;
  organizationId: string;
  timeZone: string;
  canManage: boolean;
  channelNames?: ReadonlyMap<string, string>;
  branchNames?: ReadonlyMap<string, string>;
}) {
  const scopeLabel = recommendationScope(card, channelNames, branchNames);
  const evidenceText = recommendationEvidence(card, timeZone);
  const limitation = joinLimitation(card.limitations);
  const channelHref = card.channelId
    ? `/organizations/${organizationId}/channels/${card.channelId}`
    : null;
  // Deliberate token deviation from the Superdesign prototype (which uses
  // primary/sage): emerald matches the approved channel-workspace advice block
  // in recommendation-controls.tsx, so both surfaces read as one product.
  return (
    <section
      data-testid={`intelligence-card-${card.id}`}
      aria-label={`Recommendation: ${card.title}`}
      className="flex flex-col gap-4 rounded-xl border border-emerald-100 bg-emerald-50/70 p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-white"
        >
          <Zap className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="font-semibold text-primary">{recommendationTag(card)}</span>
            <span aria-hidden="true">·</span>
            <span>{scopeLabel}</span>
          </div>
          <h3 className="mt-1.5 text-[15px] font-bold leading-snug">{card.title}</h3>
          <p className="mt-2 max-w-4xl text-sm leading-relaxed text-muted-foreground">
            {card.detail}
          </p>
          <DecisionLine card={card} timeZone={timeZone} />
          {limitation ? (
            <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
              <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span>{limitation}</span>
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <span>{evidenceText}</span>
            <RecommendationWhyDialog
              title={card.title}
              detail={card.detail}
              scopeLabel={scopeLabel}
              evidenceText={evidenceText}
              limitation={limitation}
              supportedActions={card.supportedActions}
              channelHref={channelHref}
              canManage={canManage}
              citationCount={card.citationFindingIds?.length ?? 0}
            />
          </div>
          {card.researchProvenance ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline">From market research</Badge>
              <Link
                className="font-medium text-primary underline-offset-4 hover:underline"
                href={card.researchProvenance.statusPath}
              >
                View supporting outcomes
              </Link>
            </div>
          ) : null}
        </div>
      </div>
      <div className="sm:ml-11">
        <IntelligenceActions card={card} organizationId={organizationId} canManage={canManage} />
      </div>
    </section>
  );
}

export function IntelligenceCard({
  card,
  organizationId,
  timeZone,
  canManage,
  channelNames,
  branchNames,
  contextProvenance,
}: IntelligenceCardProps) {
  if (isRecommendationCard(card)) {
    return (
      <>
        {contextProvenance?.briefManifestId || contextProvenance?.synthesisManifestId ? (
          <div className="mb-2">
            <ContextProvenanceBadges provenance={contextProvenance} />
          </div>
        ) : null}
        <RecommendationBody
          card={card}
          organizationId={organizationId}
          timeZone={timeZone}
          canManage={canManage}
          channelNames={channelNames}
          branchNames={branchNames}
        />
      </>
    );
  }
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
            {contextProvenance?.briefManifestId ? (
              <Badge variant="outline">Research brief</Badge>
            ) : null}
            {contextProvenance?.synthesisManifestId ? (
              <Badge variant="outline">Synthesis context</Badge>
            ) : null}
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
