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
  channelNames,
  branchNames,
}: SharedProps & {
  opportunities: readonly OpportunityCard[];
  recommendations: readonly RecommendationCard[];
  hideHeading?: boolean;
  channelNames?: ReadonlyMap<string, string>;
  branchNames?: ReadonlyMap<string, string>;
}) {
  if (hideHeading) {
    // Top preview matches the prototype: recommendations only, no
    // opportunities lane and no all-clear lines. An empty preview names the
    // reviewed state instead of leaving a blank gap.
    if (recommendations.length === 0) {
      return (
        <div className="rounded-xl border border-border p-6 text-sm text-muted-foreground">
          You have reviewed all current recommendations. Your choices are saved in Your actions.
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-3">
        {recommendations.map((card) => (
          <IntelligenceCard
            key={card.id}
            card={card}
            organizationId={organizationId}
            timeZone={timeZone}
            canManage={canManage}
            channelNames={channelNames}
            branchNames={branchNames}
          />
        ))}
      </div>
    );
  }
  return (
    <section aria-label="Priority actions" className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Priority actions</h2>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Platform opportunities</h3>
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
            channelNames={channelNames}
            branchNames={branchNames}
          />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Operator recommendations</h3>
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
            channelNames={channelNames}
            branchNames={branchNames}
          />
        ))}
      </div>
    </section>
  );
}
