import { notFound } from "next/navigation";
import { Megaphone } from "lucide-react";

import { CampaignProposalReview } from "@/components/campaigns/campaign-proposal-review";
import { RegisterRouteLabel } from "@/components/layout/route-context";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { hasOrganizationPermission } from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import { getOrganization } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { assertCampaignsEnabled } from "@/modules/campaigns/application/feature-access";
import { toProposalReview } from "@/modules/campaigns/application/proposal-read-model";
import {
  createCampaignProposalReader,
  type ProposalReadPersistence,
} from "@/modules/campaigns/infrastructure/proposal-read-repository";

type PageProps = { params: Promise<{ organizationId: string; proposalId: string }> };

/**
 * One campaign proposal, read in full and answered.
 *
 * This address is what the whole proposal machine was missing. Research could
 * run, a document could be written and an approval could be recorded through an
 * API — but nothing in the product could show a person the proposal or take
 * their decision on it.
 *
 * Read on the caller's own session, never a service role. Row level security is
 * what decides whether this proposal is theirs to see, and the approval that
 * may follow is a person agreeing to spend their own organization's money:
 * there is no version of that a background identity should stand in for.
 */
export default async function CampaignProposalReviewPage({ params }: PageProps) {
  const resolved = await params;
  const context = await getOrganizationContext(Promise.resolve(resolved));
  const organization = await getOrganization(context.supabase, context.organizationId);
  const role = context.membership.role as OrganizationRole;

  // Checked after membership, never before. Refusing an unknown organization
  // with "not enabled" would let an outsider learn which ones exist.
  assertCampaignsEnabled(context.organizationId);

  if (!hasOrganizationPermission(role, "campaign.read")) {
    return (
      <div className="flex min-h-0 flex-col gap-6">
        <RegisterRouteLabel segment={context.organizationId} label={organization.name} />
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Megaphone />
            </EmptyMedia>
            <EmptyTitle>You cannot read campaigns for this organization</EmptyTitle>
            <EmptyDescription>
              A campaign proposal is part of the campaign record, so reading one takes the same
              permission. Ask an owner or an admin.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const bundle = await createCampaignProposalReader(
    context.supabase as unknown as ProposalReadPersistence,
  ).readProposal({
    organizationId: context.organizationId,
    proposalId: resolved.proposalId,
  });

  // Absent and not-yours are the same answer, as they are on the decision
  // route. Telling them apart is how somebody enumerates another client's
  // proposals.
  if (bundle === null) notFound();

  const review = toProposalReview({
    organizationId: context.organizationId,
    proposal: bundle.proposal,
    version: bundle.version,
    decisions: bundle.decisions,
  });
  // A state this build does not recognise cannot be rendered safely: every
  // sentence and every control on the page is chosen by it.
  if (review === null) notFound();

  const title =
    review.content.kind === "document" ? review.content.document.title : "Campaign proposal";

  return (
    <div className="flex min-h-0 flex-col gap-6">
      <RegisterRouteLabel segment={context.organizationId} label={organization.name} />
      <RegisterRouteLabel segment={resolved.proposalId} label={title} />

      <div className="max-w-3xl">
        <CampaignProposalReview
          review={review}
          organizationId={context.organizationId}
          timeZone={organization.default_timezone}
          canDecide={hasOrganizationPermission(role, "campaign.edit")}
          canApprove={hasOrganizationPermission(role, "campaign.proposal_approve")}
        />
      </div>
    </div>
  );
}
