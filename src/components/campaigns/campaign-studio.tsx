"use client";

import { useState } from "react";
import { CircleSlash, Clock, Info, Pencil, ShieldCheck, Sparkles, Wand2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatMinor, type DemoCampaignDetail } from "@/modules/campaigns/demo/fixtures";

const PROFILE_LABEL = {
  brand_restricted: "Brand restricted",
  brand_guided: "Brand guided",
  full_visual_freedom: "Full visual freedom",
} as const;

function Field({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground uppercase">{label}</span>
      <div className="text-sm">{children}</div>
    </div>
  );
}

export function CampaignStudio({ campaign }: Readonly<{ campaign: DemoCampaignDetail }>) {
  const [directionId, setDirectionId] = useState(campaign.directions[1]!.id);
  const [attested, setAttested] = useState(false);

  const direction =
    campaign.directions.find((entry) => entry.id === directionId) ?? campaign.directions[0]!;
  const readyActions = campaign.actions.filter((action) => action.state === "ready");
  const blockedActions = campaign.actions.filter((action) => action.state === "blocked");
  const failedAssertions = campaign.assertions.filter((a) => a.state === "fail");
  const approvable = attested && blockedActions.length === 0 && failedAssertions.length === 0;

  return (
    <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              Creative directions
              <Badge variant="outline">{PROFILE_LABEL[campaign.generationProfile]}</Badge>
            </CardTitle>
            <CardDescription>
              Every proposal carries a control, an evidence-led variant, and an experimental
              direction, so the alternative is visible rather than imagined.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ToggleGroup
              type="single"
              value={directionId}
              onValueChange={(value) => value && setDirectionId(value)}
              variant="outline"
              className="flex-wrap justify-start"
              aria-label="Creative direction"
            >
              {campaign.directions.map((entry) => (
                <ToggleGroupItem key={entry.id} value={entry.id} className="flex-col items-start">
                  <span className="font-medium">{entry.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {PROFILE_LABEL[entry.generationProfile]}
                  </span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            <div className="flex flex-col gap-3">
              {/* A placeholder frame rather than a stock photograph: showing a
                  real image here would imply generated assets exist. */}
              <div className="flex aspect-[4/5] max-h-96 w-full items-center justify-center rounded-lg border border-dashed bg-muted/40 p-6 text-center">
                <div className="flex flex-col items-center gap-2">
                  <Sparkles className="size-6 text-muted-foreground" aria-hidden="true" />
                  <p className="text-sm font-medium">Generated creative</p>
                  <p className="max-w-sm text-xs text-muted-foreground">{direction.imageAlt}</p>
                  {direction.syntheticContent ? (
                    <Badge variant="secondary">Synthetic content</Badge>
                  ) : null}
                </div>
              </div>

              <p className="text-sm text-muted-foreground">{direction.rationale}</p>
              {direction.hypothesis ? (
                <Alert>
                  <Info />
                  <AlertTitle>What this direction challenges</AlertTitle>
                  <AlertDescription>{direction.hypothesis}</AlertDescription>
                </Alert>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>Post content</CardTitle>
              <CardDescription>
                Any change here creates a new immutable version and invalidates the current
                approval.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled>
                <Pencil aria-hidden="true" />
                Edit content
              </Button>
              <Button variant="outline" size="sm" disabled>
                <Wand2 aria-hidden="true" />
                Revise with a prompt
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field label="Hook">{direction.hook}</Field>
            <Field label="Caption">{direction.caption}</Field>
            <Field label="Hashtags">
              <div className="flex flex-wrap gap-2">
                {direction.hashtags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
            </Field>
            <Field label="Internal content tags">
              <div className="flex flex-wrap gap-2">
                {direction.contentTags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            </Field>
            <div className="flex flex-wrap gap-6">
              <Field label="Call to action">{direction.callToAction}</Field>
              <Field label="Execution mode">{campaign.schedule.executionMode}</Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="size-4" aria-hidden="true" />
              Timing
            </CardTitle>
            <CardDescription>{campaign.schedule.rationale}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-6">
            <Field label="Schedule window">
              {campaign.schedule.windowLabel} ({campaign.schedule.timeZone})
            </Field>
            <Field label="Approval expires">
              {new Intl.DateTimeFormat("en-GB", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: campaign.schedule.timeZone,
              }).format(new Date(campaign.approvalExpiresAt))}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Version history</CardTitle>
            <CardDescription>
              Approved versions are never edited in place. A material change produces a new version.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-4">
              {campaign.versions.map((entry) => (
                <li key={entry.version} className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    Version {entry.version}
                    <span className="text-xs font-normal text-muted-foreground">
                      {entry.author}
                    </span>
                    {entry.invalidatedApproval ? (
                      <Badge variant="secondary">Invalidated prior approval</Badge>
                    ) : null}
                  </span>
                  <span className="text-sm text-muted-foreground">{entry.summary}</span>
                  {entry.materialChanges.length > 0 ? (
                    <ul className="ml-4 list-disc text-xs text-muted-foreground">
                      {entry.materialChanges.map((change) => (
                        <li key={change}>{change}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      <aside className="flex min-w-0 flex-col gap-4" aria-label="Review rail">
        <Card>
          <CardHeader>
            <CardTitle>Channel readiness</CardTitle>
            <CardDescription>
              {readyActions.length} ready · {blockedActions.length} blocked
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {campaign.actions.map((action) => (
              <div key={action.id} className="flex flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2 text-sm">
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
                {action.restrictionCode ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    {action.restrictionCode}
                  </span>
                ) : null}
                {action.recovery ? (
                  <span className="text-xs text-muted-foreground">Recovery: {action.recovery}</span>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Approval envelope</CardTitle>
            <CardDescription>Approval binds this exact version and its limits.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Field label="Spend ceiling">{formatMinor(campaign.spendCeiling)}</Field>
            <Field label="Generation profile">{PROFILE_LABEL[campaign.generationProfile]}</Field>
            <Field label="Version digest">
              <span className="font-mono text-xs">{campaign.digest}</span>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Measurement</CardTitle>
            <CardDescription>
              Preregistered before execution, not chosen afterwards.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Field label="Primary metric">{campaign.measurement.primaryMetric}</Field>
            <Field label="Method">{campaign.measurement.method}</Field>
            <Field label="Baseline">{campaign.measurement.baselineSource}</Field>
            <Field label="Outcome window">{campaign.measurement.windowDays} days</Field>
            <Separator />
            <Alert>
              <Info />
              <AlertTitle>Proof pending</AlertTitle>
              <AlertDescription>
                No result is shown because none has been measured. A verdict requires provider
                receipts and exposure evidence.
              </AlertDescription>
            </Alert>
            <ul className="ml-4 list-disc text-xs text-muted-foreground">
              {campaign.measurement.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Approve</CardTitle>
            <CardDescription>
              Attestation is required, and blocked actions must be resolved first.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={attested}
                onCheckedChange={(value) => setAttested(value === true)}
                aria-describedby="attestation-copy"
              />
              <span id="attestation-copy">
                <span className="font-medium">Visual truth attestation.</span> I have reviewed every
                proposed asset and confirm none of them depicts or implies a real-world fact the
                evidence does not support.
              </span>
            </label>

            {blockedActions.length > 0 ? (
              <Alert variant="destructive">
                <CircleSlash />
                <AlertTitle>Execution is blocked</AlertTitle>
                <AlertDescription>
                  {blockedActions.length} channel action
                  {blockedActions.length === 1 ? "" : "s"} cannot run until the provider capability
                  is proven on a controlled account.
                </AlertDescription>
              </Alert>
            ) : null}

            <Button disabled={!approvable} className="w-full">
              Approve execution + proof
            </Button>
            {!approvable ? (
              <p className="text-xs text-muted-foreground">
                {!attested
                  ? "Attestation is required before approval."
                  : "Resolve the blocked actions and failed assertions to approve."}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
