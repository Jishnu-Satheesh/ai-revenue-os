"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Settings2 } from "lucide-react";

import { DataGaps } from "@/components/growth-intelligence/data-gaps";
import { InsightsList } from "@/components/growth-intelligence/insights-list";
import { IntelligenceTimeline } from "@/components/growth-intelligence/intelligence-timeline";
import {
  MarketMonitoringDialog,
  type MonitoringBranchOption,
} from "@/components/growth-intelligence/market-monitoring-dialog";
import { PriorityActions } from "@/components/growth-intelligence/priority-actions";
import {
  MARKET_MONITORING_OPEN_EVENT,
  previousMonth,
  requestMarketMonitoringDialog,
} from "@/components/growth-intelligence/query-options";
import {
  ResearchProgress,
  useResearchPipeline,
} from "@/components/growth-intelligence/research-progress";
import { ResearchOutcomes } from "@/components/growth-intelligence/research-outcomes";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ResearchPipelineView } from "@/modules/growth-intelligence/application/research-read-model";
import type { GrowthIntelligenceView } from "@/modules/growth-intelligence/application/read-model";
import { growthIntelligencePath } from "@/lib/routes";

/**
 * The composed workspace in two lanes: action on the left, evidence on the
 * right. Narrow screens stack the same sections in the same order, so nothing
 * reorders between desktop and mobile. Month navigation changes activity
 * history only; it never relabels an evidence period.
 */
function BranchResearch({
  organizationId,
  active,
  history,
  lastSuccess,
  status,
  timeZone,
  canManage,
}: {
  organizationId: string;
  active: ResearchPipelineView | null;
  history: ResearchPipelineView[];
  lastSuccess: ResearchPipelineView | null;
  status: "loading" | "ready" | "unavailable";
  timeZone: string;
  canManage: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ResearchProgress
        organizationId={organizationId}
        pipeline={active}
        timeZone={timeZone}
        loadError={status === "unavailable" && !active ? "network" : null}
      />
      <ResearchOutcomes
        organizationId={organizationId}
        history={history}
        lastSuccess={lastSuccess}
        canManage={canManage}
      />
    </div>
  );
}

export function GrowthIntelligenceWorkspace({
  view,
  organizationId,
  canManage,
  marketWatch,
  isCurrentMonth,
  branches = [],
  selectedBranchId = null,
}: {
  view: GrowthIntelligenceView;
  organizationId: string;
  canManage: boolean;
  /** The Market Watch section, built by the page from live claims. */
  marketWatch: React.ReactNode;
  /** False when ?month= selects history; then a way back is shown. */
  isCurrentMonth: boolean;
  branches?: MonitoringBranchOption[];
  selectedBranchId?: string | null;
}) {
  const base = growthIntelligencePath(organizationId);
  const [monitoringOpen, setMonitoringOpen] = useState(false);
  // The pipeline observer lives above the tab switch so active runs keep
  // polling while the operator reads other sections; the views below render
  // inside Insights & market only.
  const research = useResearchPipeline({
    organizationId,
    branchId: selectedBranchId,
  });

  useEffect(() => {
    const open = () => setMonitoringOpen(true);
    window.addEventListener(MARKET_MONITORING_OPEN_EVENT, open);
    return () => window.removeEventListener(MARKET_MONITORING_OPEN_EVENT, open);
  }, []);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setMonitoringOpen(true)}>
          <Settings2 aria-hidden="true" />
          Market monitoring
        </Button>
      </div>
      <MarketMonitoringDialog
        organizationId={organizationId}
        canManage={canManage}
        branches={branches}
        initialBranchId={selectedBranchId}
        open={monitoringOpen}
        onOpenChange={setMonitoringOpen}
      />
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
          {selectedBranchId ? (
            <BranchResearch
              organizationId={organizationId}
              active={research.active}
              history={research.history}
              lastSuccess={research.lastSuccess}
              status={research.status}
              timeZone={view.timeZone}
              canManage={canManage}
            />
          ) : (
            <Card>
              <CardContent className="flex flex-col gap-3 py-6 text-sm text-muted-foreground">
                <p>
                  Market research follows one branch at a time. Review market monitoring to
                  choose a location.
                </p>
                <Button variant="outline" size="sm" onClick={requestMarketMonitoringDialog}>
                  <Settings2 aria-hidden="true" />
                  Review market monitoring
                </Button>
              </CardContent>
            </Card>
          )}
          {marketWatch}
          <IntelligenceTimeline events={view.timeline} timeZone={view.timeZone} />
        </div>
      </div>
    </div>
  );
}
