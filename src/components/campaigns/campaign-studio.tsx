"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Clock, FlaskConical, Info, Pencil, Scale, Target, Wand2 } from "lucide-react";

import { attestAndApprove } from "@/components/campaigns/campaign-actions";
import { CreativePreview } from "@/components/campaigns/creative-preview";
import { RevisionDialog } from "@/components/campaigns/revision-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CampaignGenerationProfile } from "@/domain/campaigns/schemas";
import type {
  Money,
  StudioApproval,
  StudioDirection,
  StudioView,
} from "@/modules/campaigns/application/studio-view";

const PROFILE_LABEL: Readonly<Record<CampaignGenerationProfile, string>> = {
  brand_restricted: "Brand restricted",
  brand_guided: "Brand guided",
  full_visual_freedom: "Full visual freedom",
};

const DIRECTION_ICON = {
  control: Scale,
  evidence_led: Target,
  experimental: FlaskConical,
} as const;

const DIRECTION_LABEL = {
  control: "Control",
  evidence_led: "Evidence-led",
  experimental: "Experimental",
} as const;

function formatMoney(money: Money | null): string {
  if (!money) return "No paid spend";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: money.currency,
  }).format(money.amountMinor / 100);
}

function Stat({
  label,
  value,
  hint,
}: Readonly<{ label: string; value: React.ReactNode; hint?: string }>) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground uppercase">{label}</span>
      <span className="text-sm font-medium">{value}</span>
      {hint ? <span className="truncate text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

/**
 * What the review rail says about approval.
 *
 * Every state other than `live` is a reason approval does not currently hold.
 * Saying so in words matters more than the badge colour: an operator who reads
 * only the colour cannot tell "nobody has approved this" from "the approval was
 * revoked because a capability was lost".
 */
function approvalCopy(approval: StudioApproval): { label: string; detail: string } {
  switch (approval.status) {
    case "live":
      return { label: "Approved", detail: `This version is approved until ${approval.expiresAt}.` };
    case "none":
      return {
        label: "Not approved",
        detail: "Nothing has been approved for this campaign yet.",
      };
    case "expired":
      return {
        label: "Approval expired",
        detail: "The approval window closed. Review the current version and approve again.",
      };
    case "superseded":
      return {
        label: "Approval superseded",
        detail:
          "The approval on file covers an earlier version. A material change always creates a new version and leaves the old approval behind.",
      };
    case "digest_mismatch":
      return {
        label: "Approval does not match",
        detail:
          "The approval names this version but a different content digest, so it does not cover what is on screen.",
      };
    case "revoked":
      return {
        label: "Approval revoked",
        detail:
          approval.revokedReason === "capability_lost"
            ? "A provider capability this campaign depends on was lost, so the approval was revoked."
            : "This approval was revoked and no longer authorizes execution.",
      };
  }
}

function scheduleWindow(view: StudioView, timeZone: string): string | null {
  const times = view.actions.map((action) => new Date(action.scheduledFor).getTime()).sort();
  const first = times[0];
  const last = times[times.length - 1];
  if (first === undefined || last === undefined) return null;
  const format = (value: number) =>
    new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone }).format(
      new Date(value),
    );
  return first === last ? format(first) : `${format(first)} — ${format(last)}`;
}

function DirectionPanel({
  direction,
  organizationName,
  organizationId,
  campaignId,
  versionId,
  digest,
}: Readonly<{
  direction: StudioDirection;
  organizationName: string;
  organizationId: string;
  campaignId: string;
  versionId: string;
  digest: string;
}>) {
  // A direction carries copy per channel and placement. The preview shows one
  // of them rather than merging several, because a merged post is not a post
  // anyone would actually publish.
  const copy = direction.copy[0];
  const hashtags =
    direction.hashtagSets.find((set) => set.channel === copy?.channel)?.tags ??
    direction.hashtagSets[0]?.tags ??
    [];
  const asset = direction.assets[0];
  const tags = direction.internalContentTags;

  return (
    <div className="flex flex-col gap-4 pt-2 lg:flex-row lg:items-start">
      {copy && asset ? (
        <CreativePreview
          kind={direction.kind}
          organizationName={organizationName}
          placementLabel={`${copy.channel} · ${copy.placement}`}
          caption={copy.caption}
          hashtags={hashtags}
          callToAction={copy.callToAction}
          imageAlt={asset.altText}
          syntheticContent={asset.truthClass === "synthetic_generated"}
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {copy ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground uppercase">Hook</span>
            <p className="text-lg leading-snug font-medium">{copy.hook}</p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{PROFILE_LABEL[direction.generationProfile]}</Badge>
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
        </div>

        <p className="text-sm text-muted-foreground">{direction.rationale}</p>

        {direction.experiment ? (
          <Alert>
            <FlaskConical />
            <AlertTitle>What this direction challenges</AlertTitle>
            <AlertDescription className="flex flex-col gap-1">
              <span>{direction.experiment.challengedAssumption}</span>
              <span className="text-xs">Decided by: {direction.experiment.decidingEvidence}</span>
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <Scale />
            <AlertTitle>Baseline</AlertTitle>
            <AlertDescription>
              The control exists so the other directions have something to be measured against.
            </AlertDescription>
          </Alert>
        )}

        {direction.softConventionDepartures.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground uppercase">Conventions stretched</span>
            <ul className="ml-4 list-disc text-xs text-muted-foreground">
              {direction.softConventionDepartures.map((departure) => (
                <li key={departure}>{departure}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <RevisionDialog
            organizationId={organizationId}
            campaignId={campaignId}
            baseVersionId={versionId}
            baseDigest={digest}
            directionId={direction.id}
            defaultScope="copy"
            trigger={
              <Button variant="outline" size="sm">
                <Pencil data-icon="inline-start" aria-hidden="true" />
                Edit content
              </Button>
            }
          />
          <RevisionDialog
            organizationId={organizationId}
            campaignId={campaignId}
            baseVersionId={versionId}
            baseDigest={digest}
            directionId={direction.id}
            defaultScope="direction"
            trigger={
              <Button variant="outline" size="sm">
                <Wand2 data-icon="inline-start" aria-hidden="true" />
                Revise with a prompt
              </Button>
            }
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Any change creates a new immutable version and invalidates the current approval.
        </p>
      </div>
    </div>
  );
}

/** Approval windows an operator may bind, in hours. */
const ATTESTATION_STATEMENT =
  "I have reviewed every proposed asset and confirm none of them depicts or implies a real-world fact the evidence does not support.";

const APPROVAL_WINDOWS = [
  { value: "24", label: "24 hours" },
  { value: "72", label: "3 days" },
  { value: "168", label: "7 days" },
] as const;

export function CampaignStudio({
  view,
  organizationId,
  organizationName,
  timeZone,
}: Readonly<{
  view: StudioView;
  organizationId: string;
  organizationName: string;
  timeZone: string;
}>) {
  const router = useRouter();
  const evidenceLed = view.directions.find((direction) => direction.kind === "evidence_led");
  const [directionId, setDirectionId] = useState(evidenceLed?.id ?? view.directions[0]?.id ?? "");
  const [attested, setAttested] = useState(false);
  const [windowHours, setWindowHours] = useState<string>("24");
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const window = useMemo(() => scheduleWindow(view, timeZone), [view, timeZone]);

  async function approve() {
    setApproving(true);
    setApprovalError(null);

    const expiresAt = new Date(Date.now() + Number(windowHours) * 3_600_000)
      .toISOString()
      .replace("Z", "");

    const result = await attestAndApprove({
      organizationId,
      campaignId: view.campaignId,
      bundleVersionId: view.versionId,
      // The digest the operator's screen showed. The server recomputes it from
      // the stored manifest and refuses if they disagree.
      bundleDigest: view.digest,
      statement: ATTESTATION_STATEMENT,
      expiresAt,
      actionKeys: view.actions.map((action) => action.id),
    });

    setApproving(false);

    if (!result.ok) {
      setApprovalError(result.message);
      return;
    }

    toast.success("Approved", { description: "This exact version is now authorized to execute." });
    router.refresh();
  }
  const approval = approvalCopy(view.approval);
  const paidActions = view.actions.filter((action) => action.spendCeiling !== null);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-lg border bg-card px-4 py-3">
        <Stat label="Version" value={`v${view.versionNumber}`} hint={view.digest} />
        <Stat label="Source" value={view.sourceLabel} />
        <Stat label="Generation profile" value={PROFILE_LABEL[view.generationProfile]} />
        <Stat label="Spend ceiling" value={formatMoney(view.totalSpendCeiling)} />
        <Stat label="Approval" value={approval.label} />
      </div>

      <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,23rem)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Creative directions</CardTitle>
              <CardDescription>
                Every proposal carries a control, an evidence-led variant, and an experimental
                direction, so the alternative is visible rather than imagined.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs value={directionId} onValueChange={setDirectionId} className="min-h-0">
                <TabsList aria-label="Creative direction" className="w-full sm:w-fit">
                  {view.directions.map((direction) => {
                    const Icon = DIRECTION_ICON[direction.kind];
                    return (
                      <TabsTrigger key={direction.id} value={direction.id}>
                        <Icon data-icon="inline-start" aria-hidden="true" />
                        {DIRECTION_LABEL[direction.kind]}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>

                {view.directions.map((direction) => (
                  <TabsContent key={direction.id} value={direction.id} className="min-h-0">
                    <DirectionPanel
                      direction={direction}
                      organizationName={organizationName}
                      organizationId={organizationId}
                      campaignId={view.campaignId}
                      versionId={view.versionId}
                      digest={view.digest}
                    />
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
              <CardDescription>
                {view.actions.length} action{view.actions.length === 1 ? "" : "s"} ·{" "}
                {view.executionMode === "all_channels_required"
                  ? "every channel must succeed"
                  : "best effort across channels"}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-8">
              <Stat label="Schedule window" value={window ?? "Not scheduled"} hint={timeZone} />
              <Stat
                label="Paid actions"
                value={`${paidActions.length} of ${view.actions.length}`}
              />
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
              <ol className="flex flex-col gap-3">
                {view.versions.map((entry) => (
                  <li key={entry.id} className="flex gap-3">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium">
                      {entry.version}
                    </span>
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        Version {entry.version}
                        {entry.isCurrent ? <Badge variant="secondary">Showing</Badge> : null}
                      </span>
                      <span className="text-xs text-muted-foreground">{entry.createdAt}</span>
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
              <CardTitle>Planned actions</CardTitle>
              <CardDescription>
                What this version would do if approved, before any capability check.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {view.actions.map((action) => (
                <div key={action.id} className="flex flex-col gap-1 rounded-md border p-2">
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant={action.requirement === "required" ? "default" : "outline"}>
                      {action.requirement === "required" ? "Required" : "Optional"}
                    </Badge>
                    <span className="font-medium">
                      {action.channel} · {action.placement}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatMoney(action.spendCeiling)}
                  </span>
                </div>
              ))}
              {/* Capability evaluation happens in the Tool Gateway at approval
                  time. Showing a green "ready" here before that check has run
                  would be a promise this screen cannot keep. */}
              <Alert>
                <Info />
                <AlertTitle>Capability is checked at approval</AlertTitle>
                <AlertDescription>
                  Whether each channel can actually run is decided by the Tool Gateway when you
                  approve, against the provider grants in force at that moment.
                </AlertDescription>
              </Alert>
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
              <Stat label="Primary metric" value={view.measurement.primaryMetricKey} />
              <Stat
                label="Attribution"
                value={
                  view.measurement.attributionMethod === "provider_randomized_experiment"
                    ? "Provider randomized experiment"
                    : "Observational pre/post"
                }
              />
              <Stat
                label="Baseline"
                value={view.measurement.baselineSource}
                hint={`${view.measurement.baselineLookbackDays}-day lookback · ${view.measurement.outcomeWindowDays}-day outcome window`}
              />
              <Separator />
              <Alert>
                <Info />
                <AlertTitle>Proof pending</AlertTitle>
                <AlertDescription>
                  No result is shown because none has been measured. Below the{" "}
                  {view.measurement.minimumEvidenceTier} evidence tier the conclusion is
                  inconclusive, not a smaller number.
                </AlertDescription>
              </Alert>
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
              {view.approval.status === "live" ? null : (
                <Alert>
                  <Info />
                  <AlertTitle>{approval.label}</AlertTitle>
                  <AlertDescription>{approval.detail}</AlertDescription>
                </Alert>
              )}

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

              <div className="flex flex-col gap-2">
                <Label
                  htmlFor="approval-window"
                  className="text-xs text-muted-foreground uppercase"
                >
                  Approval valid for
                </Label>
                {/* An explicit operator choice. Picking a window silently in
                    code would hide a policy decision inside a button. */}
                <Select value={windowHours} onValueChange={setWindowHours}>
                  <SelectTrigger id="approval-window">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {APPROVAL_WINDOWS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {approvalError ? (
                <Alert variant="destructive">
                  <AlertTitle>Not approved</AlertTitle>
                  <AlertDescription>{approvalError}</AlertDescription>
                </Alert>
              ) : null}

              <Button disabled={!attested || approving} onClick={approve} className="w-full">
                {approving ? <Spinner data-icon="inline-start" /> : null}
                Approve execution + proof
              </Button>
              {attested ? null : (
                <p className="text-xs text-muted-foreground">
                  Attestation is required before approval.
                </p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
