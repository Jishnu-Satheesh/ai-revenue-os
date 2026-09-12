"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { CampaignPreparationCard } from "@/components/growth-intelligence/campaign-preparation-card";
import { YourActionsFilter } from "@/components/growth-intelligence/your-actions-filter";
import { YourActionsList } from "@/components/growth-intelligence/your-actions-list";
import { previousMonth } from "@/components/growth-intelligence/query-options";
import { Badge } from "@/components/ui/badge";
import type { PerformanceFilterState } from "@/modules/analysis/application/channels-overview";
import {
  filterYourActionEvents,
  parseYourActionFilter,
  type OpportunityCard,
  type TimelineEvent,
  type YourActionFilter as YourActionFilterValue,
} from "@/modules/growth-intelligence/application/read-model";
import { growthIntelligencePath } from "@/lib/routes";

function monthHref(base: string, month: string | null, decision: YourActionFilterValue): string {
  const params = new URLSearchParams();
  if (month) params.set("month", month);
  if (decision !== "all") params.set("decision", decision);
  const query = params.toString();
  return query ? `${base}?${query}#actions` : `${base}#actions`;
}

/**
 * Your actions tab content. Month navigation stays server-driven through
 * ?month links; the decision filter is client state mirrored to ?decision so
 * Back button and shared links keep both. Filters never relabel evidence:
 * research and draft rows belong to All only.
 */
export function YourActionsTab({
  events,
  opportunities,
  organizationId,
  timeZone,
  performanceFilters,
  activityMonth,
  isCurrentMonth,
}: {
  events: readonly TimelineEvent[];
  opportunities: readonly OpportunityCard[];
  organizationId: string;
  timeZone: string;
  /** Already-loaded performance scope; scope labels fall back honestly when absent. */
  performanceFilters: PerformanceFilterState | null;
  activityMonth: string;
  isCurrentMonth: boolean;
}) {
  const searchParams = useSearchParams();
  const base = growthIntelligencePath(organizationId);
  const [filter, setFilter] = useState<YourActionFilterValue>(() =>
    parseYourActionFilter(searchParams?.get("decision")),
  );
  // Scope names resolve inside this tab so the workspace owes it no maps.
  const channelNames = new Map(
    (performanceFilters?.channels ?? []).map((channel) => [channel.id, channel.displayName]),
  );
  const branchNames = new Map(
    (performanceFilters?.branches ?? []).map((branch) => [branch.id, branch.name]),
  );

  function changeFilter(next: YourActionFilterValue) {
    setFilter(next);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (next === "all") params.delete("decision");
    else params.set("decision", next);
    const query = params.toString();
    window.history.replaceState(null, "", `${base}${query ? `?${query}` : ""}#actions`);
  }

  const visible = filterYourActionEvents(events, filter);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Your actions</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          What you have reviewed, planned or saved for later. Planned records your intention to act.
        </p>
      </div>
      <nav aria-label="Activity month" className="flex flex-wrap items-center gap-3 text-sm">
        <Badge variant="outline">Activity {activityMonth}</Badge>
        <Link
          className="font-medium text-primary hover:underline"
          href={monthHref(base, previousMonth(activityMonth), filter)}
        >
          Previous month
        </Link>
        {isCurrentMonth ? null : (
          <Link
            className="font-medium text-primary hover:underline"
            href={monthHref(base, null, filter)}
          >
            Back to current month
          </Link>
        )}
      </nav>
      <YourActionsFilter value={filter} onChange={changeFilter} />
      <YourActionsList
        events={visible}
        timeZone={timeZone}
        channelNames={channelNames}
        branchNames={branchNames}
      />
      <CampaignPreparationCard
        opportunities={opportunities}
        organizationId={organizationId}
        timeZone={timeZone}
      />
    </div>
  );
}
