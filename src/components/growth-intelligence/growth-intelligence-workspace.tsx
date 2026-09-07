import Link from "next/link";

import { DataGaps } from "@/components/growth-intelligence/data-gaps";
import { InsightsList } from "@/components/growth-intelligence/insights-list";
import { IntelligenceTimeline } from "@/components/growth-intelligence/intelligence-timeline";
import { PriorityActions } from "@/components/growth-intelligence/priority-actions";
import { previousMonth } from "@/components/growth-intelligence/query-options";
import type { GrowthIntelligenceView } from "@/modules/growth-intelligence/application/read-model";
import { growthIntelligencePath } from "@/lib/routes";

/**
 * The composed workspace in two lanes: action on the left, evidence on the
 * right. Narrow screens stack the same sections in the same order, so nothing
 * reorders between desktop and mobile. Month navigation changes activity
 * history only; it never relabels an evidence period.
 */
export function GrowthIntelligenceWorkspace({
  view,
  organizationId,
  canManage,
  marketWatch,
  isCurrentMonth,
}: {
  view: GrowthIntelligenceView;
  organizationId: string;
  canManage: boolean;
  /** The Market Watch section, built by the page from live claims. */
  marketWatch: React.ReactNode;
  /** False when ?month= selects history; then a way back is shown. */
  isCurrentMonth: boolean;
}) {
  const base = growthIntelligencePath(organizationId);
  return (
    <div className="flex flex-col gap-8">
      <nav aria-label="Activity month" className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">Activity: {view.activityMonth}</span>
        <Link
          className="font-medium text-primary underline-offset-4 hover:underline"
          href={`${base}?month=${previousMonth(view.activityMonth)}`}
        >
          Previous month
        </Link>
        {isCurrentMonth ? null : (
          <Link className="font-medium text-primary underline-offset-4 hover:underline" href={base}>
            Back to current month
          </Link>
        )}
      </nav>
      {/*
        Counts describe what the actor sees after actor-scoped snoozes: a
        hidden row is not an open action for the person reading.
      */}
      <p className="text-sm text-muted-foreground" data-testid="workspace-counts">
        {view.counts.opportunities} open{" "}
        {view.counts.opportunities === 1 ? "opportunity" : "opportunities"} ·{" "}
        {view.counts.recommendations} recommendations · {view.counts.insights} insights ·{" "}
        {view.counts.dataGaps} data gaps
      </p>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-8">
          <PriorityActions
            opportunities={view.priorityActions.opportunities}
            recommendations={view.priorityActions.recommendations}
            organizationId={organizationId}
            timeZone={view.timeZone}
            canManage={canManage}
          />
          <DataGaps
            dataGaps={view.dataGaps}
            organizationId={organizationId}
            timeZone={view.timeZone}
            canManage={canManage}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-8">
          <InsightsList
            insights={view.insights}
            organizationId={organizationId}
            timeZone={view.timeZone}
            canManage={canManage}
          />
          {marketWatch}
          <IntelligenceTimeline events={view.timeline} timeZone={view.timeZone} />
        </div>
      </div>
    </div>
  );
}
