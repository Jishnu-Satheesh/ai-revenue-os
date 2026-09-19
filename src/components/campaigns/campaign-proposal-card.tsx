"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ArrowRight, ChevronDown, FlaskConical, Megaphone } from "lucide-react";

import {
  formatProposalDay,
  formatProposalMoney,
  proposalStateDetail,
  proposalStateLabel,
  summarizeChannels,
} from "@/components/campaigns/proposal-copy";
import { RequestCampaignResearch } from "@/components/campaigns/request-campaign-research";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CARD_CHIP_CLASSNAME, CardFootnote, CardQuote } from "@/components/ui/card-accents";
import type { CampaignProposalCardView } from "@/modules/campaigns/application/proposal-read-model";

/**
 * Campaign-ready opportunities, as they appear in Growth Intelligence.
 *
 * This section is the missing half of the proposal work. Everything behind it —
 * the research allowance, the claim lifecycle, the worker, the proposal
 * document, the approval gate — was built and reachable by nothing: no
 * component read a proposal, so a proposal the platform produced could not be
 * seen, let alone answered.
 *
 * The section is named separately from ordinary recommendations, and sits after
 * them, because a proposal is answered at a different gate. A recommendation is
 * advice a person acts on themselves; a proposal is a request to authorize
 * preparation, and the two must not queue together as though one button
 * answered both.
 *
 * Every state renders as itself. A proposal still being researched has no
 * document, and saying so is the honest card — not an empty one, and not a
 * spinner implying a page that is about to fill in.
 */
export function CampaignProposalSection({
  proposals,
  organizationId,
  timeZone,
  canRequest = false,
}: {
  proposals: readonly CampaignProposalCardView[];
  organizationId: string;
  timeZone: string;
  /**
   * `campaign.research_request`. Whoever may spend the research allowance is
   * whoever may ask for research, which is the same permission that sets the
   * allowance in the first place. Everyone else reads the section and sees no
   * control, rather than a button that would be refused.
   */
  canRequest?: boolean;
}) {
  return (
    <section aria-label="Campaign-ready opportunities" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-bold tracking-tight">Campaign-ready opportunities</h2>
        <p className="text-[13px] text-muted-foreground">
          Whole campaigns the platform has worked out and wants your decision on. Approving one
          authorizes preparing the creative — never publishing it.
        </p>
      </div>

      {proposals.length === 0 ? (
        <Card>
          <CardContent className="flex items-start gap-3 py-6 text-sm text-muted-foreground">
            <FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <div className="flex flex-col gap-3">
              <p>
                No campaign is being proposed right now. When research finds something worth doing,
                it will appear here for you to decide on.
              </p>
              {canRequest ? <RequestCampaignResearch organizationId={organizationId} /> : null}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {canRequest ? <RequestCampaignResearch organizationId={organizationId} /> : null}
          {proposals.map((proposal) => (
            <CampaignProposalCard
              key={proposal.proposalId}
              proposal={proposal}
              organizationId={organizationId}
              timeZone={timeZone}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function CampaignProposalCard({
  proposal,
  organizationId,
  timeZone,
}: {
  proposal: CampaignProposalCardView;
  organizationId: string;
  timeZone: string;
}) {
  const document = proposal.content.kind === "document" ? proposal.content.document : null;
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const stateLabel =
    proposalStateLabel(proposal.state) +
    (proposal.state === "snoozed" && proposal.snoozedUntil !== null
      ? ` until ${formatProposalDay(proposal.snoozedUntil, timeZone)}`
      : "");

  // The same emerald advice shape as the recommendation card: icon plus type
  // line, full title, two-line preview, then everything else — the state
  // sentence, the channels/budget/cost grid, the linked campaign — waiting
  // inside the expander. The Updated foot with its decision link never
  // collapses, so the answer is always one tap away.
  return (
    <section
      data-testid={`proposal-card-${proposal.proposalId}`}
      aria-label={`Campaign opportunity: ${document?.title ?? "A campaign proposal is being worked out"}`}
      className="flex h-full flex-col gap-4 rounded-xl border border-emerald-100 bg-emerald-50/70 p-4 sm:p-5"
    >
      <Collapsible open={expanded} onOpenChange={setExpanded} className="flex flex-1 flex-col">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-white"
          >
            <Megaphone className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="font-semibold text-primary">Campaign opportunity</span>
              <span aria-hidden="true">·</span>
              <span className={CARD_CHIP_CLASSNAME}>{stateLabel}</span>
            </div>
            <h3 className="mt-1.5 text-[15px] font-bold leading-snug">
              {document?.title ?? "A campaign proposal is being worked out"}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Last change {formatProposalDay(proposal.updatedAt, timeZone)}
              {proposal.content.kind === "document"
                ? ` · version ${proposal.content.versionNumber}`
                : ""}
            </p>
            <div className="mt-2 flex items-end gap-2">
              {document ? (
                <p className="flex-1 line-clamp-2 max-w-4xl text-sm leading-relaxed text-muted-foreground">
                  {document.businessProblem}
                </p>
              ) : (
                <span className="flex-1" aria-hidden="true" />
              )}
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={contentId}
                  className="inline-flex shrink-0 items-center gap-1 self-end rounded text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  {expanded ? "Show less" : "Read more"}
                  <ChevronDown
                    aria-hidden="true"
                    className={
                      expanded
                        ? "size-3.5 rotate-180 transition-transform"
                        : "size-3.5 transition-transform"
                    }
                  />
                </button>
              </CollapsibleTrigger>
            </div>
          </div>
        </div>
        <CollapsibleContent id={contentId} className="flex flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-3 pt-2">
            {document ? (
              <CardQuote testId={`proposal-card-${proposal.proposalId}-quote`}>
                {document.businessProblem}
              </CardQuote>
            ) : null}
            {proposal.content.kind === "unreadable" ? (
              // A document that no longer satisfies the schema is not shown in
              // part. Half a proposal is not a smaller argument for spending
              // money, it is an unreliable one.
              <CardFootnote>
                This proposal was written in a form this version of the platform cannot read, so it is
                not being shown. Nothing has been approved and nothing has been spent.
              </CardFootnote>
            ) : (
              <CardFootnote>{proposalStateDetail(proposal)}</CardFootnote>
            )}

            {document ? (
              <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">Channels</dt>
                  <dd className="mt-0.5 font-medium">{summarizeChannels(document.channels)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Media budget</dt>
                  {/* Two separate amounts, never added together and never
                      defaulted to zero: one buys attention, the other pays for
                      drafting the creative. */}
                  <dd className="mt-0.5 font-medium">
                    {formatProposalMoney(document.proposedMediaBudget, "None — organic only")}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Cost of preparing it</dt>
                  <dd className="mt-0.5 font-medium">
                    {formatProposalMoney(document.generationCostCeiling, "Not stated")} at most
                  </dd>
                </div>
              </dl>
            ) : null}

            {proposal.linkedCampaignId !== null ? (
              <Link
                className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                href={`/organizations/${organizationId}/campaigns/${proposal.linkedCampaignId}`}
              >
                Open the campaign this opened
              </Link>
            ) : null}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div data-testid={`proposal-card-${proposal.proposalId}-footer`} className="mt-auto">
        <div className="flex items-center justify-between gap-2 border-t border-emerald-100 pt-3">
          <p className="text-[11px] leading-snug text-muted-foreground">
            Updated {formatProposalDay(proposal.updatedAt, timeZone)}
          </p>
          <Link
            className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary underline-offset-4 hover:underline"
            href={`/organizations/${organizationId}/campaign-proposals/${proposal.proposalId}`}
          >
            {proposal.decidable ? "Review and decide" : "Open proposal"}
            <ArrowRight aria-hidden="true" className="size-3" data-icon="inline-end" />
          </Link>
        </div>
      </div>
    </section>
  );
}
