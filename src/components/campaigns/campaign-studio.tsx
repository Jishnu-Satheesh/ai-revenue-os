"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2,
  CircleSlash,
  Info,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  Wand2,
} from "lucide-react";

import { attestAndApprove } from "@/components/campaigns/campaign-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CampaignGenerationProfile } from "@/domain/campaigns/schemas";
import type { CampaignState } from "@/domain/campaigns/state-machine";
import type {
  Money,
  StudioApproval,
  StudioDirection,
  StudioView,
} from "@/modules/campaigns/application/studio-view";

/**
 * The Campaign Control Room, built to the approved cockpit composition.
 *
 * The shape is deliberate: a filmstrip that makes all three directions
 * comparable at a glance, the selected creative given enough room to actually
 * judge the image and the post together, and a right rail that gathers
 * everything an operator is being asked to authorise into one column ending in
 * the approval itself.
 *
 * Both of the panels that were once stubs now carry real answers: channel
 * readiness comes from the Tool Gateway's own refusal codes, and the change
 * summary is computed from the two manifests it compares. Each still falls back
 * to saying nothing when there is genuinely nothing to say — no readiness
 * verdict, or no earlier version — because a cockpit that invents either is
 * worse than one that admits the gap.
 */

const PROFILE_LABEL: Readonly<Record<CampaignGenerationProfile, string>> = {
  brand_restricted: "Brand restricted",
  brand_guided: "Brand guided",
  full_visual_freedom: "Full visual freedom",
};

const DIRECTION_LABEL = {
  control: "Control",
  evidence_led: "Evidence-led",
  experimental: "Experimental",
} as const;

const STATE_LABEL: Readonly<Record<CampaignState, string>> = {
  draft: "Draft",
  needs_data: "Needs data",
  ready_for_review: "Ready for review",
  approved: "Approved",
  scheduled: "Scheduled",
  executing: "Executing",
  measuring: "Measuring",
  completed: "Completed",
  partially_completed: "Partially completed",
  blocked: "Blocked",
  cancelled: "Cancelled",
  failed: "Failed",
};

const APPROVAL_WINDOWS = [
  { value: "24", label: "24 hours" },
  { value: "72", label: "3 days" },
  { value: "168", label: "7 days" },
] as const;

const ATTESTATION_STATEMENT =
  "I have reviewed every proposed asset and confirm none of them depicts or implies a real-world fact the evidence does not support.";

function formatMoney(money: Money | null): string {
  if (!money) return "No paid spend";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: money.currency,
  }).format(money.amountMinor / 100);
}

/**
 * The generation window, as a date an operator can hold in their head.
 *
 * Rendered in the reader's locale from a UTC instant. An unparseable value
 * shows itself rather than a fallback date, because a wrong-looking window is
 * recoverable and a plausible-looking wrong one is not.
 */
function formatWindow(instant: string): string {
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) return instant;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

/** A rail heading. Small and quiet, so the values carry the page. */
function RailHeading({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <h3 className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
      {children}
    </h3>
  );
}

function Row({ label, value }: Readonly<{ label: string; value: React.ReactNode }>) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function FieldBlock({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * A panel that names what it will show and what has to happen first.
 *
 * Deliberately not a spinner or an empty card. Both read as "loading", and this
 * is not loading — it is a capability that does not exist yet, which is a
 * different thing for an operator to know.
 */
function NotYet({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
      <div className="flex items-center justify-between gap-2">
        <RailHeading>{title}</RailHeading>
        <Badge variant="outline" className="text-[10px]">
          Not yet available
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">{children}</p>
    </section>
  );
}

const CHANNEL_LABEL: Readonly<Record<string, string>> = {
  instagram: "Instagram",
  facebook: "Facebook",
};

/**
 * Whether each channel can actually run, as the Tool Gateway would decide it.
 *
 * A blocked channel is drawn as blocked and never as something an operator
 * could talk themselves past: the stable code is on screen next to the reason,
 * because "AUTH_403_SCOPE" is what a support conversation needs and "something
 * went wrong" is not.
 */
function BlockersAndReadiness({
  readiness,
  organizationId,
}: Readonly<{
  readiness: StudioView["readiness"];
  organizationId: string;
}>) {
  if (readiness === null) {
    return (
      <NotYet title="Blockers &amp; readiness">
        Channel readiness could not be read just now. Nothing is shown rather than a guess, because
        a green &ldquo;ready&rdquo; here would be a promise the system cannot keep.
      </NotYet>
    );
  }

  if (readiness.length === 0) {
    return (
      <NotYet title="Blockers &amp; readiness">
        This version publishes to no channel, so there is nothing to be ready for.
      </NotYet>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-3">
      <RailHeading>Blockers &amp; readiness</RailHeading>
      <div className="flex flex-col gap-2">
        {readiness.map((channel) =>
          channel.verdict === "blocked" ? (
            <div
              key={channel.channel}
              className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-tight text-destructive uppercase">
                  <ShieldAlert className="size-3.5 shrink-0" aria-hidden />
                  {CHANNEL_LABEL[channel.channel] ?? channel.channel}
                </span>
                <span className="text-[9px] font-black tracking-widest text-destructive uppercase">
                  Blocked
                </span>
              </div>

              {channel.blockers.map((blocker) => (
                <p key={blocker.code} className="text-[10px] leading-tight text-muted-foreground">
                  Restriction code: <code className="font-mono">{blocker.code}</code>.{" "}
                  {blocker.reason}
                </p>
              ))}

              {/* One recovery action, for the first blocker. Stacking a button
                  per code would offer three doors to a room with one lock. */}
              {channel.blockers[0]?.code === "capability_not_registered" ? null : (
                <Button asChild size="sm" variant="destructive" className="h-7 w-full text-[10px]">
                  <Link href={`/organizations/${organizationId}/integrations`}>
                    {channel.blockers[0]?.recovery ?? "Review the connection"}
                  </Link>
                </Button>
              )}
            </div>
          ) : (
            <div
              key={channel.channel}
              className="flex items-center justify-between gap-2 rounded-md border border-emerald-600/30 bg-emerald-600/5 p-2.5"
            >
              <span className="flex items-center gap-2 text-[11px] font-medium">
                <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" aria-hidden />
                {CHANNEL_LABEL[channel.channel] ?? channel.channel}
                {channel.accountLabel ? (
                  <span className="text-muted-foreground">· {channel.accountLabel}</span>
                ) : null}
              </span>
              <span className="text-[9px] font-bold text-emerald-600 uppercase">Ready</span>
            </div>
          ),
        )}
      </div>

      {/* Said plainly rather than implied. This panel checks the permission and
          the connection; whether tracking is live and consent still stands is
          re-checked at send time from state this screen cannot see. */}
      <p className="text-[10px] leading-tight text-muted-foreground">
        Covers the permission, the connection and the chosen account. Tracking and consent are
        re-checked when each post is sent.
      </p>
    </section>
  );
}

/**
 * What this version changed from the one before it, in the same before/after
 * shape the revise screen uses.
 *
 * Every manifest change is material by construction, so there is no "minor
 * changes" bucket to hide anything in: if it is listed here, it invalidated the
 * previous approval.
 */
function VersionChangeSummary({
  summary,
  nextVersion,
}: Readonly<{ summary: StudioView["changeSummary"]; nextVersion: number }>) {
  if (!summary) {
    return (
      <NotYet title="Version change summary">
        This campaign has one version, so there is nothing to compare it against. An edit or a
        prompt revision creates version {nextVersion} and the material differences appear here.
      </NotYet>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <RailHeading>Version change summary</RailHeading>
        <span className="text-[10px] font-bold text-muted-foreground">
          v{summary.fromVersion} → v{summary.toVersion}
        </span>
      </div>

      <ul className="flex flex-col gap-2.5">
        {summary.changes.slice(0, 8).map((change) => (
          <li key={change.path} className="flex flex-col gap-1">
            <span className="text-[9px] font-bold tracking-widest text-muted-foreground uppercase">
              {change.label}
            </span>
            <span className="text-[11px] break-words line-through opacity-50">
              {change.before ?? "—"}
            </span>
            <span className="text-[11px] font-medium break-words">{change.after ?? "—"}</span>
          </li>
        ))}
      </ul>

      {summary.changes.length > 8 ? (
        <p className="text-[10px] text-muted-foreground">
          and {summary.changes.length - 8} more change
          {summary.changes.length - 8 === 1 ? "" : "s"}.
        </p>
      ) : null}

      <p className="text-[10px] leading-tight text-muted-foreground">
        Every one of these invalidated the approval on version {summary.fromVersion}. Nothing in a
        manifest is cosmetic.
      </p>
    </section>
  );
}

function approvalCopy(approval: StudioApproval): { label: string; detail: string } {
  switch (approval.status) {
    case "live":
      return { label: "Approved", detail: `This version is approved until ${approval.expiresAt}.` };
    case "none":
      return { label: "Not approved", detail: "Nothing has been approved for this campaign yet." };
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

/** "2 posts, 1 story" — what this bundle would actually put out, counted. */
function organicVolume(view: StudioView): string {
  const organic = view.actions.filter((action) => action.spendCeiling === null);
  if (organic.length === 0) return "None";
  const posts = organic.filter((action) => action.placement === "feed_image").length;
  const stories = organic.filter((action) => action.placement === "image_story").length;
  return [
    posts > 0 ? `${posts} post${posts === 1 ? "" : "s"}` : null,
    stories > 0 ? `${stories} stor${stories === 1 ? "y" : "ies"}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

function SelectedCreative({
  view,
  direction,
  organizationId,
  timeZone,
}: Readonly<{
  view: StudioView;
  direction: StudioDirection;
  organizationId: string;
  timeZone: string;
}>) {
  const copy = direction.copy[0];
  const asset = direction.assets[0];
  const hashtags =
    direction.hashtagSets.find((set) => set.channel === copy?.channel) ?? direction.hashtagSets[0];
  // The placements this direction's own actions cover, which is what the
  // artwork actually has to adapt to.
  const adaptations = [
    ...new Set(
      view.actions
        .filter((action) => action.directionId === direction.id)
        .map((action) => `${action.channel} · ${action.placement}`),
    ),
  ];
  const window = scheduleWindow(view, timeZone);

  // The exact version and direction the operator is looking at, carried into
  // the workspace so it edits what is on screen rather than whatever is newest.
  const reviseHref =
    `/organizations/${organizationId}/campaigns/${view.campaignId}/revise` +
    `?version=${view.versionId}&direction=${direction.id}`;

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="relative overflow-hidden rounded-lg border bg-muted">
          {asset?.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={asset.previewUrl}
              alt={asset.altText}
              className="block aspect-4/5 w-full object-cover"
            />
          ) : (
            <div className="flex aspect-4/5 w-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
              {asset ? "Artwork unavailable" : "No artwork on this direction"}
            </div>
          )}
          {copy ? (
            <Badge className="absolute top-2 left-2" variant="secondary">
              {copy.channel} · {copy.placement}
            </Badge>
          ) : null}
          {asset?.truthClass === "synthetic_generated" ? (
            <Badge className="absolute top-2 right-2" variant="secondary">
              Synthetic
            </Badge>
          ) : null}
        </div>

        <section className="flex flex-col gap-2 rounded-lg border p-3">
          <RailHeading>Channel adaptation</RailHeading>
          {adaptations.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No action targets this direction, so nothing would publish from it.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {adaptations.map((entry) => (
                <li key={entry}>
                  <Badge variant="outline" className="font-normal">
                    {entry}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2 rounded-lg border p-3">
          <RailHeading>Timing rationale</RailHeading>
          <p className="text-xs text-muted-foreground">
            {copy?.timingRationale ?? "This direction carries no timing rationale."}
          </p>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <Row label="Schedule window" value={window ?? "Not scheduled"} />
            <Row
              label="Execution mode"
              value={
                view.executionMode === "all_channels_required" ? "All required" : "Best effort"
              }
            />
          </div>
        </section>
      </div>

      <div className="flex min-w-0 flex-col gap-4 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Post content control</h2>
          <div className="flex flex-wrap gap-2">
            {/* Both open the same full-screen workspace, differing only in
                which part of it takes focus. They are links rather than dialogs
                so the back button, a refresh and a shared URL all work. */}
            <Button asChild variant="outline" size="sm">
              <Link href={`${reviseHref}&intent=edit`}>
                <Pencil data-icon="inline-start" aria-hidden="true" />
                Edit content
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`${reviseHref}&intent=revise`}>
                <Wand2 data-icon="inline-start" aria-hidden="true" />
                Revise prompt
              </Link>
            </Button>
          </div>
        </div>

        {copy ? (
          <>
            <FieldBlock label="Primary hook">
              <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm leading-snug font-medium">
                {copy.hook}
              </p>
            </FieldBlock>

            <FieldBlock label="Channel caption">
              <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm leading-relaxed">
                {copy.caption}
              </p>
            </FieldBlock>
          </>
        ) : null}

        <FieldBlock label="Hashtags">
          {hashtags && hashtags.tags.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {hashtags.tags.map((tag) => (
                <li key={tag}>
                  <Badge variant="secondary" className="font-normal">
                    {tag}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">
              None proposed. No verified provider contract states a hashtag limit for this channel
              yet, so a set could not be checked before publishing.
            </p>
          )}
          {/* Only when there are tags to explain. With none, the rationale says
              the same thing the empty state already said. */}
          {hashtags && hashtags.tags.length > 0 ? (
            <p className="text-xs text-muted-foreground">{hashtags.rationale}</p>
          ) : null}
        </FieldBlock>

        {/* Kept visibly apart from hashtags. Merging the two lists once would
            publish an internal label to customers. */}
        {direction.internalContentTags.length > 0 ? (
          <FieldBlock label="Internal tags (never published)">
            <ul className="flex flex-wrap gap-1.5">
              {direction.internalContentTags.map((tag) => (
                <li key={tag}>
                  <Badge variant="outline" className="font-normal">
                    {tag}
                  </Badge>
                </li>
              ))}
            </ul>
          </FieldBlock>
        ) : null}

        {copy ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldBlock label="Call to action">
              <p className="text-sm font-medium">{copy.callToAction}</p>
            </FieldBlock>
            <FieldBlock label="Direction">
              <p className="text-sm font-medium">{direction.name}</p>
            </FieldBlock>
          </div>
        ) : null}

        <FieldBlock label="Why this direction">
          <p className="text-sm text-muted-foreground">{direction.rationale}</p>
        </FieldBlock>

        {direction.experiment ? (
          <Alert>
            <Info />
            <AlertTitle>What this direction challenges</AlertTitle>
            <AlertDescription className="flex flex-col gap-1">
              <span>{direction.experiment.challengedAssumption}</span>
              <span className="text-xs">Decided by: {direction.experiment.decidingEvidence}</span>
              <span className="text-xs">Stretches: {direction.experiment.stretchedConvention}</span>
            </AlertDescription>
          </Alert>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Any change creates a new immutable version and invalidates the current approval.
        </p>
      </div>
    </div>
  );
}

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
  const [windowHours, setWindowHours] = useState("24");
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const approval = approvalCopy(view.approval);
  const volume = useMemo(() => organicVolume(view), [view]);

  async function approve() {
    setApproving(true);
    setApprovalError(null);

    // A UTC instant, Z and all. The approval schema requires it, and an
    // expiry with no timezone is not an instant — it is a reading that means
    // something different in every organization that opens it.
    const expiresAt = new Date(Date.now() + Number(windowHours) * 3_600_000).toISOString();

    const result = await attestAndApprove({
      organizationId,
      campaignId: view.campaignId,
      bundleVersionId: view.versionId,
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

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {/* Persistent bundle header: what this is, which version, and whether
          anything currently authorises it. */}
      <header className="flex flex-wrap items-center justify-between gap-x-8 gap-y-2 rounded-lg border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{view.sourceLabel}</span>
          <span aria-hidden="true">|</span>
          <span>Version {view.versionNumber}</span>
          <span aria-hidden="true">|</span>
          <Badge variant="secondary">{STATE_LABEL[view.state]}</Badge>
        </div>
        <div className="flex flex-col gap-0.5 text-right">
          <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
            Approval
          </span>
          <span className="text-sm font-medium">
            {view.approval.status === "live"
              ? `Expires ${new Intl.DateTimeFormat("en-GB", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone,
                }).format(new Date(view.approval.expiresAt))}`
              : approval.label}
          </span>
        </div>
      </header>

      <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(19rem,21rem)]">
        <Tabs value={directionId} onValueChange={setDirectionId} className="flex min-w-0 flex-col">
          {/* The filmstrip. Three directions side by side, each showing its own
              artwork, so the alternative is visible rather than imagined. */}
          <TabsList
            aria-label="Creative direction"
            // The filmstrip is a card strip, not a compact tab bar. The list
            // pins its height through a `group-data-horizontal` variant, which
            // a plain `h-auto` cannot outrank, so the override matches it.
            className="grid w-full grid-cols-3 gap-2 bg-transparent p-0 group-data-horizontal/tabs:h-auto"
          >
            {view.directions.map((entry) => (
              <TabsTrigger
                key={entry.id}
                value={entry.id}
                className="flex h-auto flex-col items-stretch gap-2 rounded-lg border p-2 whitespace-normal data-[state=active]:border-primary data-[state=active]:bg-accent"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">{DIRECTION_LABEL[entry.kind]}</span>
                  {entry.id === directionId ? (
                    <Badge variant="default" className="text-[10px]">
                      Active
                    </Badge>
                  ) : null}
                </span>
                <span className="block overflow-hidden rounded-md border bg-muted">
                  {entry.assets[0]?.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={entry.assets[0].previewUrl}
                      alt=""
                      className="block h-32 w-full object-cover"
                    />
                  ) : (
                    <span className="block h-32 w-full" />
                  )}
                </span>
                <span className="flex flex-col gap-0.5 text-left">
                  <span className="truncate text-xs font-medium">{entry.name}</span>
                  <span className="truncate text-[10px] text-muted-foreground">
                    {PROFILE_LABEL[entry.generationProfile]}
                  </span>
                </span>
              </TabsTrigger>
            ))}
          </TabsList>

          {view.directions.map((entry) => (
            <TabsContent key={entry.id} value={entry.id} className="mt-4 min-w-0">
              <SelectedCreative
                view={view}
                direction={entry}
                organizationId={organizationId}
                timeZone={timeZone}
              />
            </TabsContent>
          ))}
        </Tabs>

        <aside className="flex min-w-0 flex-col gap-4" aria-label="Review rail">
          <BlockersAndReadiness readiness={view.readiness} organizationId={organizationId} />

          <section className="flex flex-col gap-3 rounded-lg border p-3">
            <RailHeading>Approval envelope</RailHeading>
            <Row label="Generation profile" value={PROFILE_LABEL[view.generationProfile]} />
            <Row label="Organic volume" value={volume} />
            <Row label="Spend ceiling" value={formatMoney(view.totalSpendCeiling)} />
            <Row label="Actions covered" value={view.actions.length} />
            <Row
              label="Creative variants"
              value={`Up to ${view.generationPolicy.maxVariantsPerDirection} per direction (${view.generationPolicy.maxVariantsTotal} total)`}
            />
            <Row
              label="Generation window"
              value={`Until ${formatWindow(view.generationPolicy.policyExpiresAt)}`}
            />
            {/*
              Approving this bundle authorizes creative that does not exist yet,
              so the bound has to be readable before the button is pressed. An
              operator who cannot say what they are agreeing to has not agreed
              to it, whatever the approval row records.
            */}
            <p className="text-xs text-muted-foreground">
              Approving authorizes up to {view.generationPolicy.maxVariantsTotal} creative variants
              until {formatWindow(view.generationPolicy.policyExpiresAt)}. Each one may vary the
              image, hook, caption, hashtags and call to action.{" "}
              <span className="font-medium text-foreground">
                None may change the offer, the claims, the audience, the placement, the schedule or
                the spend
              </span>{" "}
              — those are fixed by this approval, and changing any of them needs a new one.
            </p>
          </section>

          <section className="flex flex-col gap-3 rounded-lg border p-3">
            <RailHeading>Measurement design</RailHeading>
            <Row label="Preregistered metric" value={view.measurement.primaryMetricKey} />
            <div className="grid grid-cols-2 gap-3">
              <Row
                label="Method"
                value={
                  view.measurement.attributionMethod === "provider_randomized_experiment"
                    ? "Randomized"
                    : "Pre/post"
                }
              />
              <Row label="Window" value={`${view.measurement.outcomeWindowDays}d`} />
            </div>
            <Row label="Baseline" value={`${view.measurement.baselineLookbackDays}d lookback`} />
            <div className="rounded-md border border-dashed p-2">
              <p className="text-xs font-medium">Proof pending</p>
              <p className="text-xs text-muted-foreground">
                No result is shown because none has been measured. Below the{" "}
                {view.measurement.minimumEvidenceTier} evidence tier the conclusion is inconclusive,
                not a smaller number.
              </p>
            </div>
          </section>

          <VersionChangeSummary summary={view.changeSummary} nextVersion={view.versionNumber + 1} />

          {view.versions.length < 2 ? null : (
            <section className="flex flex-col gap-2 rounded-lg border p-3">
              <RailHeading>Version history</RailHeading>
              <ol className="flex flex-col gap-1.5">
                {view.versions.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>Version {entry.version}</span>
                    {entry.isCurrent ? (
                      <Badge variant="secondary" className="text-[10px]">
                        Showing
                      </Badge>
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="flex flex-col gap-3 rounded-lg border p-3">
            {view.approval.status === "live" ? (
              <Alert>
                <ShieldCheck />
                <AlertTitle>{approval.label}</AlertTitle>
                <AlertDescription>{approval.detail}</AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <CircleSlash />
                <AlertTitle>{approval.label}</AlertTitle>
                <AlertDescription>{approval.detail}</AlertDescription>
              </Alert>
            )}

            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={attested}
                onCheckedChange={(value) => setAttested(value === true)}
                aria-describedby="attestation-copy"
                className="mt-0.5"
              />
              <span id="attestation-copy" className="flex flex-col gap-1">
                <span className="font-medium">Visual truth attestation</span>
                <span className="text-xs text-muted-foreground">{ATTESTATION_STATEMENT}</span>
              </span>
            </label>

            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="approval-window"
                className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase"
              >
                Approval valid for
              </Label>
              {/* An explicit operator choice. Picking a window silently in code
                  would hide a policy decision inside a button. */}
              <Select value={windowHours} onValueChange={setWindowHours}>
                <SelectTrigger id="approval-window" size="sm">
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

            <div className="flex flex-col gap-0.5 border-t pt-2">
              <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
                Version digest
              </span>
              <span className="font-mono text-[10px] break-all text-muted-foreground">
                {view.digest}
              </span>
            </div>
          </section>
        </aside>
      </div>

      <p className="sr-only">Reviewing campaign artwork for {organizationName}.</p>
    </div>
  );
}
