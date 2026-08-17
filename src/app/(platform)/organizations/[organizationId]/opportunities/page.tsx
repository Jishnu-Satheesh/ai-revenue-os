import { Sparkles } from "lucide-react";

import { RegisterRouteLabel } from "@/components/layout/route-context";
import { OpportunityFeedView } from "@/components/opportunities/opportunity-feed";
import { getOrganization } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { buildOpportunityFeed } from "@/modules/decisions/application/feed";
import { createDecisionRepository } from "@/modules/decisions/infrastructure/repository";
import type { DecisionPersistence } from "@/modules/decisions/infrastructure/repository";

type PageProps = { params: Promise<{ organizationId: string }> };

/**
 * The opportunity feed for one organization.
 *
 * There is no account-wide feed: an opportunity only means something against
 * one organization's economics, capabilities, and goals, so the route carries
 * the organization and the read happens inside that member's session.
 */
export default async function OpportunitiesPage({ params }: PageProps) {
  const context = await getOrganizationContext(params);
  const organization = await getOrganization(context.supabase, context.organizationId);

  const repository = createDecisionRepository(context.supabase as unknown as DecisionPersistence);
  const items = await repository.listOpportunities(context.organizationId);

  const feed = buildOpportunityFeed({
    items,
    role: context.membership.role,
    now: new Date(),
    organizationId: context.organizationId,
  });

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-6">
      <RegisterRouteLabel segment={context.organizationId} label={organization.name} />
      <div className="flex shrink-0 items-start gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <Sparkles />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Opportunities</h1>
          <p className="text-sm text-muted-foreground">
            What the Decision Engine proposes for {organization.name}, grouped by how well the
            evidence supports it. Nothing here runs until you approve it.
          </p>
        </div>
      </div>

      <OpportunityFeedView
        organizationId={context.organizationId}
        timeZone={organization.default_timezone}
        initialFeed={feed}
      />
    </div>
  );
}
