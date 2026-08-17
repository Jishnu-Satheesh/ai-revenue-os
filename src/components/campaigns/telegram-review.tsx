"use client";

import { useState } from "react";
import { ChevronDown, CircleSlash, Info, ShieldCheck } from "lucide-react";

import { CreativePreview } from "@/components/campaigns/creative-preview";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatMinor, type DemoCampaignDetail } from "@/modules/campaigns/demo/fixtures";

function Section({
  title,
  summary,
  children,
}: Readonly<{ title: string; summary: string; children: React.ReactNode }>) {
  return (
    <Collapsible className="rounded-lg border">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-3 text-left">
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">{title}</span>
          <span className="truncate text-xs text-muted-foreground">{summary}</span>
        </span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 border-t px-3 py-3 text-sm">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function TelegramReview({
  campaign,
  organizationName,
}: Readonly<{ campaign: DemoCampaignDetail; organizationName: string }>) {
  const [directionId, setDirectionId] = useState(campaign.directions[1]!.id);
  const [attested, setAttested] = useState(false);

  const blockedActions = campaign.actions.filter((action) => action.state === "blocked");
  const failedAssertions = campaign.assertions.filter((entry) => entry.state === "fail");
  const approvable = attested && blockedActions.length === 0 && failedAssertions.length === 0;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 flex flex-col gap-1 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <span className="flex flex-wrap items-center gap-2">
          <h1 className="text-base font-semibold">{campaign.title}</h1>
          {campaign.dryRun ? <Badge variant="secondary">Dry run</Badge> : null}
        </span>
        <span className="text-xs text-muted-foreground">
          {organizationName} · version {campaign.version} · operator review
        </span>
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 py-4 pb-44">
        {/* One creative at a time, with thumb-reachable switching. This is a
            review surface, not a compressed desktop editor. */}
        <Tabs value={directionId} onValueChange={setDirectionId}>
          <TabsList aria-label="Creative direction" className="w-full">
            {campaign.directions.map((entry) => (
              <TabsTrigger key={entry.id} value={entry.id} className="flex-1 text-xs">
                {entry.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {campaign.directions.map((entry) => (
            <TabsContent key={entry.id} value={entry.id} className="flex flex-col gap-3 pt-3">
              <CreativePreview
                kind={entry.kind}
                organizationName={organizationName}
                placementLabel="Instagram · Feed 4:5"
                caption={entry.caption}
                hashtags={entry.hashtags}
                callToAction={entry.callToAction}
                imageAlt={entry.imageAlt}
                syntheticContent={entry.syntheticContent}
              />
              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground uppercase">Hook</span>
                <p className="text-base leading-snug font-medium">{entry.hook}</p>
              </div>
              {entry.hypothesis ? (
                <p className="text-sm text-muted-foreground">{entry.hypothesis}</p>
              ) : null}
            </TabsContent>
          ))}
        </Tabs>

        <Section
          title="Channel readiness"
          summary={`${blockedActions.length} of ${campaign.actions.length} blocked`}
        >
          {campaign.actions.map((action) => (
            <div key={action.id} className="flex flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <Badge variant={action.state === "ready" ? "default" : "destructive"}>
                  {action.state === "ready" ? (
                    <ShieldCheck aria-hidden="true" />
                  ) : (
                    <CircleSlash aria-hidden="true" />
                  )}
                  {action.state === "ready" ? "Ready" : "Blocked"}
                </Badge>
                <span className="font-medium">
                  {action.channel} · {action.placement}
                </span>
              </span>
              {action.reason ? (
                <span className="text-xs text-muted-foreground">{action.reason}</span>
              ) : null}
            </div>
          ))}
        </Section>

        <Section title="Spend and schedule" summary={formatMinor(campaign.spendCeiling)}>
          <p>Spend ceiling: {formatMinor(campaign.spendCeiling)}</p>
          <p>
            Schedule: {campaign.schedule.windowLabel} ({campaign.schedule.timeZone})
          </p>
          <p>Execution mode: {campaign.schedule.executionMode}</p>
        </Section>

        <Section title="Measurement" summary="Proof pending">
          <p>{campaign.measurement.primaryMetric}</p>
          <p className="text-muted-foreground">{campaign.measurement.method}</p>
          <Alert>
            <Info />
            <AlertTitle>Proof pending</AlertTitle>
            <AlertDescription>No result is shown because none has been measured.</AlertDescription>
          </Alert>
        </Section>

        <Section title="Version" summary={`v${campaign.version} · ${campaign.digest}`}>
          {campaign.versions.slice(0, 2).map((entry) => (
            <p key={entry.version}>
              <span className="font-medium">v{entry.version}</span> — {entry.summary}
            </p>
          ))}
        </Section>
      </main>

      {/* Sticky attestation and approve, thumb-reachable at the bottom. */}
      <footer className="fixed inset-x-0 bottom-0 z-10 flex flex-col gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur">
        {blockedActions.length > 0 ? (
          <p className="flex items-start gap-2 text-xs text-destructive">
            <CircleSlash aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            {blockedActions.length} action{blockedActions.length === 1 ? "" : "s"} blocked. Approval
            stays unavailable until the provider capability is proven.
          </p>
        ) : null}

        <label className="flex items-start gap-3 text-xs">
          <Checkbox
            checked={attested}
            onCheckedChange={(value) => setAttested(value === true)}
            aria-describedby="telegram-attestation"
          />
          <span id="telegram-attestation">
            <span className="font-medium">Visual truth attestation.</span> I have reviewed every
            asset and confirm none implies a fact the evidence does not support.
          </span>
        </label>

        <Button disabled={!approvable} className="w-full">
          Approve execution + proof
        </Button>
        <p className="text-center font-mono text-[10px] text-muted-foreground">{campaign.digest}</p>
      </footer>
    </div>
  );
}
