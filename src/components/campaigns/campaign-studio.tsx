"use client";

import { useState } from "react";
import {
  Check,
  CircleSlash,
  Clock,
  FlaskConical,
  Info,
  Minus,
  Pencil,
  Scale,
  ShieldCheck,
  Target,
  Wand2,
  X,
} from "lucide-react";

import { CreativePreview } from "@/components/campaigns/creative-preview";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatMinor,
  type DemoAssertion,
  type DemoCampaignDetail,
  type DemoDirectionKind,
} from "@/modules/campaigns/demo/fixtures";

const PROFILE_LABEL = {
  brand_restricted: "Brand restricted",
  brand_guided: "Brand guided",
  full_visual_freedom: "Full visual freedom",
} as const;

const DIRECTION_ICON: Readonly<Record<DemoDirectionKind, typeof Scale>> = {
  control: Scale,
  evidence_led: Target,
  experimental: FlaskConical,
};

function Stat({
  label,
  value,
  hint,
}: Readonly<{ label: string; value: React.ReactNode; hint?: string }>) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground uppercase">{label}</span>
      <span className="text-sm font-medium">{value}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

const ASSERTION_ICON = {
  pass: { Icon: Check, className: "text-primary" },
  pending: { Icon: Minus, className: "text-muted-foreground" },
  fail: { Icon: X, className: "text-destructive" },
} as const;

function AssertionRow({ assertion }: Readonly<{ assertion: DemoAssertion }>) {
  const { Icon, className } = ASSERTION_ICON[assertion.state];
  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${className}`} />
      <span className="flex-1">{assertion.label}</span>
      <span className="text-xs text-muted-foreground capitalize">{assertion.state}</span>
    </li>
  );
}

export function CampaignStudio({
  campaign,
  organizationName,
}: Readonly<{ campaign: DemoCampaignDetail; organizationName: string }>) {
  const [directionId, setDirectionId] = useState(campaign.directions[1]!.id);
  const [attested, setAttested] = useState(false);

  const readyActions = campaign.actions.filter((action) => action.state === "ready");
  const blockedActions = campaign.actions.filter((action) => action.state === "blocked");
  const failedAssertions = campaign.assertions.filter((entry) => entry.state === "fail");
  const passedAssertions = campaign.assertions.filter((entry) => entry.state === "pass");
  const approvable = attested && blockedActions.length === 0 && failedAssertions.length === 0;
  const readinessPct = Math.round((readyActions.length / campaign.actions.length) * 100);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {/* Persistent bundle header: lifecycle, version, source, digest, expiry,
          and dry-run in one dense strip rather than scattered down the page. */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-lg border bg-card px-4 py-3">
        <Stat label="Lifecycle" value="Ready for review" />
        <Stat label="Version" value={`v${campaign.version}`} hint={campaign.digest} />
        <Stat
          label="Channel readiness"
          value={`${readyActions.length} of ${campaign.actions.length} ready`}
        />
        <Stat label="Spend ceiling" value={formatMinor(campaign.spendCeiling)} />
        <Stat
          label="Approval expires"
          value={new Intl.DateTimeFormat("en-GB", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: campaign.schedule.timeZone,
          }).format(new Date(campaign.approvalExpiresAt))}
        />
      </div>

      <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,23rem)]">
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
            <CardContent>
              <Tabs value={directionId} onValueChange={setDirectionId} className="min-h-0">
                <TabsList aria-label="Creative direction" className="w-full sm:w-fit">
                  {campaign.directions.map((entry) => {
                    const Icon = DIRECTION_ICON[entry.kind];
                    return (
                      <TabsTrigger key={entry.id} value={entry.id}>
                        <Icon data-icon="inline-start" aria-hidden="true" />
                        {entry.label}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>

                {campaign.directions.map((entry) => (
                  <TabsContent key={entry.id} value={entry.id} className="min-h-0">
                    <div className="flex flex-col gap-4 pt-2 lg:flex-row lg:items-start">
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

                      <div className="flex min-w-0 flex-1 flex-col gap-4">
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-muted-foreground uppercase">Hook</span>
                          <p className="text-lg leading-snug font-medium">{entry.hook}</p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{PROFILE_LABEL[entry.generationProfile]}</Badge>
                          {entry.contentTags.map((tag) => (
                            <Badge key={tag} variant="secondary">
                              {tag}
                            </Badge>
                          ))}
                        </div>

                        <p className="text-sm text-muted-foreground">{entry.rationale}</p>

                        {entry.hypothesis ? (
                          <Alert>
                            <FlaskConical />
                            <AlertTitle>What this direction challenges</AlertTitle>
                            <AlertDescription>{entry.hypothesis}</AlertDescription>
                          </Alert>
                        ) : (
                          <Alert>
                            <Scale />
                            <AlertTitle>Baseline</AlertTitle>
                            <AlertDescription>
                              The control exists so the other directions have something to be
                              measured against.
                            </AlertDescription>
                          </Alert>
                        )}

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
                        <p className="text-xs text-muted-foreground">
                          Any change creates a new immutable version and invalidates the current
                          approval.
                        </p>
                      </div>
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
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
            <CardContent className="flex flex-wrap gap-8">
              <Stat
                label="Schedule window"
                value={campaign.schedule.windowLabel}
                hint={campaign.schedule.timeZone}
              />
              <Stat label="Execution mode" value={campaign.schedule.executionMode} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Version history</CardTitle>
              <CardDescription>
                Approved versions are never edited in place. A material change produces a new
                version.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-4">
                {campaign.versions.map((entry) => (
                  <li key={entry.version} className="flex gap-3">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium">
                      {entry.version}
                    </span>
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {entry.summary}
                        {entry.invalidatedApproval ? (
                          <Badge variant="secondary">Invalidated approval</Badge>
                        ) : null}
                      </span>
                      <span className="text-xs text-muted-foreground">{entry.author}</span>
                      {entry.materialChanges.length > 0 ? (
                        <ul className="ml-4 list-disc text-xs text-muted-foreground">
                          {entry.materialChanges.map((change) => (
                            <li key={change}>{change}</li>
                          ))}
                        </ul>
                      ) : null}
                    </span>
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
              <Progress value={readinessPct} aria-label="Channel readiness" />
              {campaign.actions.map((action) => (
                <div key={action.id} className="flex flex-col gap-1 rounded-md border p-2">
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
                    <span className="text-xs text-muted-foreground">
                      Recovery: {action.recovery}
                    </span>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Pre-execution checks</CardTitle>
              <CardDescription>
                {passedAssertions.length} of {campaign.assertions.length} passing · re-evaluated
                again before anything runs
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2">
                {campaign.assertions.map((assertion) => (
                  <AssertionRow key={assertion.key} assertion={assertion} />
                ))}
              </ul>
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
              <Stat label="Primary metric" value={campaign.measurement.primaryMetric} />
              <Stat label="Method" value={campaign.measurement.method} />
              <Stat
                label="Baseline"
                value={campaign.measurement.baselineSource}
                hint={`${campaign.measurement.windowDays}-day outcome window`}
              />
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
                Approval binds this exact version, action set, and spend ceiling.
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
                  <span className="font-medium">Visual truth attestation.</span> I have reviewed
                  every proposed asset and confirm none of them depicts or implies a real-world fact
                  the evidence does not support.
                </span>
              </label>

              {blockedActions.length > 0 ? (
                <Alert variant="destructive">
                  <CircleSlash />
                  <AlertTitle>Execution is blocked</AlertTitle>
                  <AlertDescription>
                    {blockedActions.length} channel action
                    {blockedActions.length === 1 ? "" : "s"} cannot run until the provider
                    capability is proven on a controlled account.
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
                    : "Resolve the blocked actions and failed checks to approve."}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
