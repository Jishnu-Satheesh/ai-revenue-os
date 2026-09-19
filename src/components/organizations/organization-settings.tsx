"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TeamMembers } from "@/components/organizations/team-members";

/**
 * The tab registry. Settings grows by appending an entry here -- each tab owns
 * its content component, and nothing else in the shell changes. Team Members
 * is the first and only entry; future tabs (Growth Intelligence and others)
 * arrive as their own slices.
 */
const SETTINGS_TABS = [
  { id: "team", label: "Team Members", description: "Who can open this client, and as what." },
] as const;

export function OrganizationSettings({
  organizationId,
  organizationName,
}: {
  organizationId: string;
  organizationName: string;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          How {organizationName} is run and who may open it.
        </p>
      </div>
      <Tabs defaultValue="team">
        <TabsList aria-label="Settings sections">
          {SETTINGS_TABS.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {SETTINGS_TABS.map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className="mt-6">
            <p className="mb-4 text-sm text-muted-foreground">{tab.description}</p>
            {tab.id === "team" ? <TeamMembers organizationId={organizationId} /> : null}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
