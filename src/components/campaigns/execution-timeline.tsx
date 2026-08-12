import {
  CheckCircle2,
  CircleSlash,
  Clock,
  Info,
  Lightbulb,
  Receipt,
  ShieldCheck,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { formatMinor, type DemoExecutionCampaign } from "@/modules/campaigns/demo/fixtures";

const RECEIPT_STATE = {
  reconciled: { label: "Reconciled", variant: "default" as const, Icon: ShieldCheck },
  published: { label: "Published", variant: "default" as const, Icon: CheckCircle2 },
  provider_pending: { label: "Provider pending", variant: "secondary" as const, Icon: Clock },
  blocked: { label: "Blocked", variant: "destructive" as const, Icon: CircleSlash },
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

function formatMoment(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
}

export function ExecutionTimeline({
  campaign,
  now,
}: Readonly<{ campaign: DemoExecutionCampaign; now: Date }>) {
  const closesAt = new Date(campaign.measurement.windowClosesAt);
  const startedAt = new Date(
    closesAt.getTime() - campaign.measurement.windowDays * 24 * 60 * 60 * 1000,
  );
  const elapsedMs = Math.max(0, now.getTime() - startedAt.getTime());
  const totalMs = closesAt.getTime() - startedAt.getTime();
  const windowPct = Math.min(100, Math.round((elapsedMs / totalMs) * 100));
  const daysRemaining = Math.max(
    0,
    Math.ceil((closesAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
  );

  const { approved, reserved, providerReported, settled } = campaign.spend;
  const spendPct = Math.round((providerReported.amountMinor / approved.amountMinor) * 100);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-lg border bg-card px-4 py-3">
        <Stat label="Lifecycle" value="Measuring" />
        <Stat label="Approved version" value={`v${campaign.version}`} hint={campaign.digest} />
        <Stat
          label="Approved"
          value={formatMoment(campaign.approvedAt, campaign.timeZone)}
          hint={campaign.approvedBy}
        />
        <Stat label="Exposures recorded" value={campaign.exposures.recorded} />
        <Stat label="Outcome window" value={`${daysRemaining} days remaining`} />
      </div>

      <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,23rem)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="size-4" aria-hidden="true" />
                Provider receipts
              </CardTitle>
              <CardDescription>
                What the provider confirmed, not what the platform intended. A request without a
                confirmation is never reported as published.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-3">
                {campaign.receipts.map((receipt) => {
                  const state = RECEIPT_STATE[receipt.state];
                  return (
                    <li key={receipt.id} className="flex gap-3 rounded-md border p-3">
                      <state.Icon
                        aria-hidden="true"
                        className={`mt-0.5 size-4 shrink-0 ${
                          receipt.state === "blocked" ? "text-destructive" : "text-primary"
                        }`}
                      />
                      <div className="flex min-w-0 flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          {receipt.channel} · {receipt.placement}
                          <Badge variant={state.variant}>{state.label}</Badge>
                        </span>
                        <span className="text-sm text-muted-foreground">{receipt.detail}</span>
                        <span className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                          {receipt.externalReference ? (
                            <span className="font-mono">{receipt.externalReference}</span>
                          ) : null}
                          {receipt.publishedAt ? (
                            <span>{formatMoment(receipt.publishedAt, campaign.timeZone)}</span>
                          ) : null}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Spend reconciliation</CardTitle>
              <CardDescription>
                Four numbers are tracked separately, because they disagree until the account
                settles.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Progress value={spendPct} aria-label="Provider reported spend against ceiling" />
              <div className="flex flex-wrap gap-8">
                <Stat label={approved.label} value={formatMinor(approved)} />
                <Stat label={reserved.label} value={formatMinor(reserved)} />
                <Stat label={providerReported.label} value={formatMinor(providerReported)} />
                <Stat
                  label="Settled"
                  value={settled ? formatMinor(settled) : "Not settled"}
                  hint={settled ? undefined : "Final figures arrive after the provider closes"}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="size-4" aria-hidden="true" />
                Learning proposal
              </CardTitle>
              <CardDescription>
                Campaign-scoped. It changes nothing until an operator promotes it separately.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Stat label="Observation" value={campaign.learningProposal.observation} />
              <Stat label="Limitation" value={campaign.learningProposal.limitation} />
              <Stat
                label="Suggested next test"
                value={campaign.learningProposal.suggestedNextTest}
              />
              <Badge variant="secondary" className="w-fit">
                Campaign-scoped · not promoted
              </Badge>
            </CardContent>
          </Card>
        </div>

        <aside className="flex min-w-0 flex-col gap-4" aria-label="Proof rail">
          <Card>
            <CardHeader>
              <CardTitle>Business proof</CardTitle>
              <CardDescription>
                {campaign.measurement.primaryMetric} · {campaign.measurement.method}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <span className="flex items-center justify-between text-xs text-muted-foreground uppercase">
                  Outcome window
                  <span>{daysRemaining} days remaining</span>
                </span>
                <Progress value={windowPct} aria-label="Outcome window progress" />
                <span className="text-xs text-muted-foreground">
                  Closes {formatMoment(campaign.measurement.windowClosesAt, campaign.timeZone)}
                </span>
              </div>

              <Separator />

              {/* One of four honest verdicts. Execution-only is the truthful
                  answer while the window is open, and saying so is the point. */}
              <Alert>
                <Info />
                <AlertTitle>Execution only</AlertTitle>
                <AlertDescription>{campaign.measurement.verdictExplanation}</AlertDescription>
              </Alert>

              <Stat label="Baseline" value={campaign.measurement.baselineSource} />
              <Stat label="Exposure source" value={campaign.exposures.source} />

              <div className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground uppercase">Limitations</span>
                <ul className="ml-4 list-disc text-xs text-muted-foreground">
                  {campaign.measurement.limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Guardrails</CardTitle>
              <CardDescription>Checked continuously while the campaign is live.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2">
                {campaign.guardrails.map((guardrail) => (
                  <li key={guardrail.label} className="flex items-center gap-2 text-sm">
                    {guardrail.state === "holding" ? (
                      <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-primary" />
                    ) : (
                      <CircleSlash
                        aria-hidden="true"
                        className="size-4 shrink-0 text-destructive"
                      />
                    )}
                    <span className="flex-1">{guardrail.label}</span>
                    <span className="text-xs text-muted-foreground capitalize">
                      {guardrail.state}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
