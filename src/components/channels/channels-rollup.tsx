"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { MonthYearPicker } from "@/components/analysis/month-year-picker";
import { ChannelPortfolioChart } from "@/components/channels/channel-portfolio-chart";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ChannelsOverviewView,
  ChannelsOverviewWindow,
} from "@/modules/analysis/application/channels-overview";

/**
 * One report-like canvas for the organization's selected evidence window.
 * The window selector changes the same server-owned query parameter as before;
 * only the client presentation is consolidated here.
 */
export function ChannelsRollup({
  view,
  organizationId,
}: {
  view: ChannelsOverviewView;
  organizationId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const onWindowChange = (value: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("window", value);
    router.push(`/organizations/${organizationId}/channels?${params.toString()}`);
  };

  // The audit picker's look over the overview's own windows, grouped by the
  // month each window starts in. The `window` query parameter is untouched, so
  // every existing link keeps working.
  //
  // A month is not a window. Windows are declared as start, end and grain, so
  // one month can hold several -- a monthly package and a weekly one, or two
  // partial uploads -- and collapsing them to a month name would leave every
  // window but one unreachable from the page. So the month picks the group,
  // and where a group holds more than one window a second control names the
  // exact ranges. `view.windows` is already newest-first by end date, which is
  // the order those ranges keep and which decides the month's default.
  const windowsByMonth = useMemo(() => {
    const grouped = new Map<string, ChannelsOverviewWindow[]>();
    for (const entry of view.windows) {
      const month = entry.windowStart.slice(0, 7);
      grouped.set(month, [...(grouped.get(month) ?? []), entry]);
    }
    return grouped;
  }, [view.windows]);
  const months = useMemo(() => [...windowsByMonth.keys()].sort(), [windowsByMonth]);
  const selectedMonth = view.selectedWindow?.windowStart.slice(0, 7) ?? null;
  const monthWindows = selectedMonth ? (windowsByMonth.get(selectedMonth) ?? []) : [];
  const onSelectMonth = (month: string) => {
    const target = windowsByMonth.get(month)?.[0];
    if (target && target.value !== view.selectedWindow?.value) onWindowChange(target.value);
  };

  return (
    <section aria-label="Channel portfolio analysis">
      <Card className="gap-0 py-0">
        <CardHeader className="border-b py-5 sm:py-6">
          <CardTitle>
            <h2 className="text-lg">Channel performance</h2>
          </CardTitle>
          <CardDescription>
            A selected-window view of reported revenue, provider-reported loss, and evidence
            coverage.
          </CardDescription>

          {view.windows.length > 0 && selectedMonth ? (
            <CardAction className="flex w-full flex-col items-stretch gap-1.5 sm:w-64">
              <MonthYearPicker
                months={months}
                selectedMonth={selectedMonth}
                onSelectMonth={onSelectMonth}
              />
              {/* Only where the month holds a choice. One window is the usual
                  case, and it needs a caption, not a control. */}
              {monthWindows.length > 1 ? (
                <Select
                  value={view.selectedWindow?.value ?? undefined}
                  onValueChange={onWindowChange}
                >
                  <SelectTrigger aria-label="Window to report on" className="w-full">
                    <SelectValue placeholder="Choose a window" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {monthWindows.map((entry) => (
                        <SelectItem key={entry.value} value={entry.value}>
                          {entry.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ) : view.selectedWindow ? (
                <p className="text-[11px] leading-snug text-muted-foreground">
                  {view.selectedWindow.label}
                </p>
              ) : null}
            </CardAction>
          ) : null}
        </CardHeader>

        <CardContent className="p-0">
          <ChannelPortfolioChart
            rows={view.rows}
            total={view.total}
            coverage={view.coverage}
            refusalReason={view.refusalReason}
          />
        </CardContent>
      </Card>
    </section>
  );
}
