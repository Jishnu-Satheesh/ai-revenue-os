"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * One channel, one destination.
 *
 * The analysis and the setup that produces it are two views of the same thing,
 * so they are tabs rather than two pages. `workspace` is null when the governed
 * analysis slice is off for the organization, or when the channel is archived:
 * in both cases there is no analysis to offer and no tab is drawn for one.
 * `reports` is null when the viewer may neither upload reports nor approve
 * them: intake is work, and there is no tab for watching other people do it.
 */
export function ChannelDetail({
  channelName,
  workspace,
  reports,
  setup,
  defaultTab,
}: {
  channelName: string;
  workspace: React.ReactNode | null;
  reports: React.ReactNode | null;
  setup: React.ReactNode;
  defaultTab: "analysis" | "setup";
}) {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">{channelName}</h1>
      <Tabs defaultValue={workspace ? defaultTab : "setup"} className="flex flex-1 flex-col gap-6">
        <TabsList>
          {workspace ? <TabsTrigger value="analysis">Analysis</TabsTrigger> : null}
          {reports ? <TabsTrigger value="reports">Reports</TabsTrigger> : null}
          <TabsTrigger value="setup">Setup</TabsTrigger>
        </TabsList>
        {workspace ? (
          <TabsContent value="analysis" className="flex-1">
            {workspace}
          </TabsContent>
        ) : null}
        {reports ? (
          <TabsContent value="reports" className="flex-1">
            {reports}
          </TabsContent>
        ) : null}
        <TabsContent value="setup" className="flex-1">
          {setup}
        </TabsContent>
      </Tabs>
    </div>
  );
}
