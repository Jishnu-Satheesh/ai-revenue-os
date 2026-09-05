import { IntelligenceCard } from "@/components/growth-intelligence/intelligence-card";
import type { InsightCard } from "@/modules/growth-intelligence/application/read-model";

/**
 * Material observations with nowhere to act yet: what the evidence says,
 * graded, without inventing a score or a next step the platform cannot back.
 */
export function InsightsList({
  insights,
  organizationId,
  timeZone,
  canManage,
}: {
  insights: readonly InsightCard[];
  organizationId: string;
  timeZone: string;
  canManage: boolean;
}) {
  return (
    <section aria-label="Insights" className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Insights</h2>
      {insights.length === 0 ? (
        <p className="text-sm text-muted-foreground">No insights for this month.</p>
      ) : null}
      {insights.map((card) => (
        <IntelligenceCard
          key={card.id}
          card={card}
          organizationId={organizationId}
          timeZone={timeZone}
          canManage={canManage}
        />
      ))}
    </section>
  );
}
