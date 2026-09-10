import { IntelligenceCard } from "@/components/growth-intelligence/intelligence-card";
import type {
  OpportunityCard,
  RecommendationCard,
} from "@/modules/growth-intelligence/application/read-model";

type SharedProps = {
  organizationId: string;
  timeZone: string;
  canManage: boolean;
};

/**
 * The hero lane: platform-ready Opportunities separated from
 * operator-performed Recommendations, so nobody mistakes one for the other.
 * Empty is an explicit all-clear per group, never a blank gap.
 */
export function PriorityActions({
  opportunities,
  recommendations,
  organizationId,
  timeZone,
  canManage,
  hideHeading = false,
}: SharedProps & {
  opportunities: readonly OpportunityCard[];
  recommendations: readonly RecommendationCard[];
  hideHeading?: boolean;
}) {
  return (
    <section aria-label="Priority actions" className="flex flex-col gap-4">
      {hideHeading ? null : <h2 className="text-lg font-semibold">Priority actions</h2>}
      <div className="flex flex-col gap-2">
        {hideHeading ? null : <h3 className="text-sm font-semibold">Platform opportunities</h3>}
        {opportunities.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open platform opportunities.</p>
        ) : null}
        {opportunities.map((card) => (
          <IntelligenceCard
            key={card.id}
            card={card}
            organizationId={organizationId}
            timeZone={timeZone}
            canManage={canManage}
          />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {hideHeading ? null : <h3 className="text-sm font-semibold">Operator recommendations</h3>}
        {recommendations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No operator recommendations awaiting you.</p>
        ) : null}
        {recommendations.map((card) => (
          <IntelligenceCard
            key={card.id}
            card={card}
            organizationId={organizationId}
            timeZone={timeZone}
            canManage={canManage}
          />
        ))}
      </div>
    </section>
  );
}
