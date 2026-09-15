import Link from "next/link";
import { ArrowRight, FlaskConical, Megaphone } from "lucide-react";

import {
  formatProposalDay,
  formatProposalMoney,
  proposalStateDetail,
  proposalStateLabel,
  summarizeChannels,
} from "@/components/campaigns/proposal-copy";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
}: {
  proposals: readonly CampaignProposalCardView[];
  organizationId: string;
  timeZone: string;
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
            <p>
              No campaign is being proposed right now. When research finds something worth doing, it
              will appear here for you to decide on.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
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

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted"
            >
              <Megaphone className="size-4 text-muted-foreground" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold">
                {document?.title ?? "A campaign proposal is being worked out"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Last change {formatProposalDay(proposal.updatedAt, timeZone)}
                {proposal.content.kind === "document"
                  ? ` · version ${proposal.content.versionNumber}`
                  : ""}
              </p>
            </div>
          </div>
          <Badge variant={proposal.decidable ? "default" : "secondary"}>
            {proposalStateLabel(proposal.state)}
            {proposal.state === "snoozed" && proposal.snoozedUntil !== null
              ? ` until ${formatProposalDay(proposal.snoozedUntil, timeZone)}`
              : ""}
          </Badge>
        </div>

        {proposal.content.kind === "unreadable" ? (
          // A document that no longer satisfies the schema is not shown in
          // part. Half a proposal is not a smaller argument for spending
          // money, it is an unreliable one.
          <p className="text-sm text-muted-foreground">
            This proposal was written in a form this version of the platform cannot read, so it is
            not being shown. Nothing has been approved and nothing has been spent.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{proposalStateDetail(proposal)}</p>
        )}

        {document ? (
          <>
            <p className="text-sm">{document.businessProblem}</p>
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
          </>
        ) : null}

        <div className="flex flex-wrap items-center gap-4">
          <Link
            className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
            href={`/organizations/${organizationId}/campaign-proposals/${proposal.proposalId}`}
          >
            {proposal.decidable ? "Review and decide" : "Open proposal"}
            <ArrowRight aria-hidden="true" className="size-3" />
          </Link>
          {proposal.linkedCampaignId !== null ? (
            <Link
              className="text-xs font-medium text-primary underline-offset-4 hover:underline"
              href={`/organizations/${organizationId}/campaigns/${proposal.linkedCampaignId}`}
            >
              Open the campaign this opened
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
