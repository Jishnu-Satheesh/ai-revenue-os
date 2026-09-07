import { IntelligenceCard } from "@/components/growth-intelligence/intelligence-card";
import type { DataGapCard } from "@/modules/growth-intelligence/application/read-model";

/**
 * Missing, stale, or incompatible evidence with a named repair surface.
 * Gaps never enter opportunity or recommendation totals; they count readiness
 * work, and every card names what is missing and where to take it.
 */
export function DataGaps({
  dataGaps,
  organizationId,
  timeZone,
  canManage,
}: {
  dataGaps: readonly DataGapCard[];
  organizationId: string;
  timeZone: string;
  canManage: boolean;
}) {
  return (
    <section aria-label="Data gaps" className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Data gaps</h2>
      {dataGaps.length === 0 ? (
        <p className="text-sm text-muted-foreground">No missing evidence right now.</p>
      ) : null}
      {dataGaps.map((card) => (
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
