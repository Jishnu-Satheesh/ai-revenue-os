"use client";

import { CampaignProposalCard } from "@/components/campaigns/campaign-proposal-card";
import { IntelligenceCard } from "@/components/growth-intelligence/intelligence-card";
import { scoreMergedItems } from "@/components/growth-intelligence/merged-opportunities";
import { Card, CardContent } from "@/components/ui/card";
import type { CampaignProposalCardView } from "@/modules/campaigns/application/proposal-read-model";
import type { RecommendationCard } from "@/modules/growth-intelligence/application/read-model";

/**
 * The overview's single opportunity grid: advice and campaign drafts ranked
 * together, three across and two deep. Advice keeps its green recommendation
 * body; proposals keep their Review and decide foot. The type line and the CTA
 * are what tell them apart, never the position.
 */
export function MergedRecommendations({
  recommendations,
  proposals,
  organizationId,
  timeZone,
  canManage,
  channelNames,
  branchNames,
}: {
  recommendations: readonly RecommendationCard[];
  proposals: readonly CampaignProposalCardView[];
  organizationId: string;
  timeZone: string;
  canManage: boolean;
  channelNames?: ReadonlyMap<string, string>;
  branchNames?: ReadonlyMap<string, string>;
}) {
  const items = scoreMergedItems(recommendations, proposals);
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          You have reviewed everything for now. New advice and campaign drafts will appear here
          when the evidence supports one.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) =>
        item.kind === "recommendation" ? (
          <div key={item.card.id} className="min-w-0">
            <IntelligenceCard
              card={item.card}
              organizationId={organizationId}
              timeZone={timeZone}
              canManage={canManage}
              channelNames={channelNames}
              branchNames={branchNames}
            />
          </div>
        ) : (
          <div key={item.card.proposalId} className="min-w-0">
            <CampaignProposalCard
              proposal={item.card}
              organizationId={organizationId}
              timeZone={timeZone}
            />
          </div>
        ),
      )}
    </div>
  );
}
