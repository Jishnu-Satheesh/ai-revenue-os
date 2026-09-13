"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, FileText, LayoutGrid, List, Loader2, Plus, Sparkles } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GenerateAgainButton } from "@/components/campaigns/generate-again-button";
import { Input } from "@/components/ui/input";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { needsAttention } from "@/domain/campaigns/phase";
import type { CampaignState } from "@/domain/campaigns/state-machine";
import type {
  CampaignGeneration,
  CampaignListItem,
  Money,
} from "@/modules/campaigns/application/studio-view";

/**
 * The campaign portfolio, led by the artwork.
 *
 * These are pictures that will go out under a client's name, so the list shows
 * them. A row of titles and status words makes every campaign look the same,
 * which is exactly wrong for work whose whole point is that each one looks
 * different.
 *
 * Two honesty rules govern the counts here:
 *
 * Filtering never changes the total. A search box that narrows twelve campaigns
 * to three must still say twelve exist — "3 of 12" — because a filtered count
 * presented as a total is how somebody concludes work has disappeared.
 *
 * The attention count is derived from the same next action each card shows, so
 * the number and the cards can never disagree. It counts campaigns waiting on a
 * person, not everything unfinished: creative still rendering is not waiting on
 * anybody, and counting it would train people to ignore the badge.
 */

function GenerationNotice({ generation }: Readonly<{ generation: CampaignGeneration }>) {
  if (generation.status === "settled") return null;

  if (generation.status === "generating") {
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-dashed p-2 text-xs"
        role="status"
      >
        <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
        <span>{generation.detail}</span>
      </div>
    );
  }

  return (
    <div
      className="flex items-start gap-2 rounded-md border border-dashed p-2 text-xs"
      role="status"
    >
      <AlertTriangle
        className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="flex flex-col gap-1">
        <span className="font-medium">
          {generation.status === "failed" ? "Generation failed" : "Generation did not finish"}
        </span>
        <span className="text-muted-foreground">{generation.detail}</span>
      </span>
    </div>
  );
}

/**
 * Every campaign state gets its own label, including the ones an operator will
 * rarely see. A state missing from this map would render as raw database text
 * in front of a client.
 */
const STATE: Readonly<
  Record<
    CampaignState,
    { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
  >
> = {
  draft: { label: "Draft", variant: "outline" },
  needs_data: { label: "Needs data", variant: "secondary" },
  ready_for_review: { label: "Ready for review", variant: "default" },
  approved: { label: "Approved", variant: "default" },
  scheduled: { label: "Scheduled", variant: "default" },
  executing: { label: "Executing", variant: "default" },
  measuring: { label: "Measuring", variant: "secondary" },
  completed: { label: "Completed", variant: "secondary" },
  partially_completed: { label: "Partially completed", variant: "secondary" },
  blocked: { label: "Blocked", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "outline" },
  failed: { label: "Failed", variant: "destructive" },
};

function formatMoney(money: Money | null): string {
  // A null ceiling means the bundle carries no paid action at all. Rendering
  // it as "0.00" would read as a budget of nothing, which is a different claim.
  if (!money) return "No paid spend";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: money.currency,
  }).format(money.amountMinor / 100);
}

function updatedLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

/**
 * The artwork, or an honest stand-in.
 *
 * A campaign with no preview gets a labelled placeholder rather than a grey
 * box: "no artwork yet" and "artwork we could not load" both look like an empty
 * rectangle, and the operator has to be able to tell which happened.
 */
function Artwork({
  previewUrl,
  awaitingFirstVersion,
  className,
}: Readonly<{ previewUrl: string | null; awaitingFirstVersion: boolean; className: string }>) {
  if (previewUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={previewUrl} alt="" className={`${className} object-cover`} />
    );
  }

  return (
    <span
      className={`${className} flex items-center justify-center border-b bg-muted px-3 text-center text-[10px] text-muted-foreground`}
    >
      {awaitingFirstVersion ? "No artwork yet" : "Preview unavailable"}
    </span>
  );
}

function NextAction({ campaign }: Readonly<{ campaign: CampaignListItem }>) {
  if (campaign.phase.nextAction === null) return null;
  return (
    <span className="text-xs">
      <span className="font-medium">{campaign.phase.nextAction.label}</span>
    </span>
  );
}

function CampaignCard({
  campaign,
  organizationId,
  timeZone,
  previewUrl,
}: Readonly<{
  campaign: CampaignListItem;
  organizationId: string;
  timeZone: string;
  previewUrl: string | null;
}>) {
  const state = STATE[campaign.state];
  const href = `/organizations/${organizationId}/campaigns/${campaign.id}`;

  return (
    <li className="flex">
      <div className="flex w-full flex-col overflow-hidden rounded-lg border bg-card">
        {campaign.openable ? (
          <Link href={href} aria-label={campaign.title} className="block">
            <Artwork
              previewUrl={previewUrl}
              awaitingFirstVersion={campaign.awaitingFirstVersion}
              className="block h-40 w-full"
            />
          </Link>
        ) : (
          <Artwork
            previewUrl={previewUrl}
            awaitingFirstVersion={campaign.awaitingFirstVersion}
            className="block h-40 w-full"
          />
        )}

        <div className="flex flex-1 flex-col gap-3 p-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              {campaign.openable ? (
                <Link href={href} className="font-medium underline-offset-4 hover:underline">
                  {campaign.title}
                </Link>
              ) : (
                // Not a link, rather than a link that 404s. There is no
                // proposal behind this campaign yet, so the route it would
                // open has nothing to render.
                <span className="font-medium">{campaign.title}</span>
              )}
              {campaign.version === null ? null : (
                <Badge variant="outline">v{campaign.version}</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {/* The objective lives in a bundle version. Until one exists
                  there is nothing truthful to put here. */}
              {campaign.objective ?? "Waiting for the first proposal to be generated."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={state.variant}>{state.label}</Badge>
            <span className="text-xs text-muted-foreground">{campaign.phase.summary}</span>
          </div>

          <GenerationNotice generation={campaign.generation} />

          {campaign.awaitingFirstVersion ? null : (
            <div className="flex flex-wrap gap-4 text-sm">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] tracking-widest text-muted-foreground uppercase">
                  Channels
                </span>
                <span>{campaign.channels.join(" · ")}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] tracking-widest text-muted-foreground uppercase">
                  Spend ceiling
                </span>
                <span>{formatMoney(campaign.spendCeiling)}</span>
              </div>
            </div>
          )}

          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <span className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">
                Updated {updatedLabel(campaign.updatedAt, timeZone)}
              </span>
              <NextAction campaign={campaign} />
            </span>
            {campaign.openable ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={href}>Open</Link>
              </Button>
            ) : campaign.generation.status === "generating" ? (
              // `disabled` on a Button with `asChild` renders an anchor, and an
              // anchor ignores it — which is how a campaign with no version
              // stayed clickable all the way to a 404.
              <Button variant="outline" size="sm" disabled>
                Open
              </Button>
            ) : (
              <GenerateAgainButton organizationId={organizationId} campaignId={campaign.id} />
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function CampaignRow({
  campaign,
  organizationId,
  timeZone,
  previewUrl,
}: Readonly<{
  campaign: CampaignListItem;
  organizationId: string;
  timeZone: string;
  previewUrl: string | null;
}>) {
  const state = STATE[campaign.state];
  const href = `/organizations/${organizationId}/campaigns/${campaign.id}`;

  return (
    <li className="flex items-center gap-3 rounded-lg border bg-card p-3">
      <Artwork
        previewUrl={previewUrl}
        awaitingFirstVersion={campaign.awaitingFirstVersion}
        className="block size-14 shrink-0 rounded-md border"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          {campaign.openable ? (
            <Link href={href} className="truncate font-medium underline-offset-4 hover:underline">
              {campaign.title}
            </Link>
          ) : (
            <span className="truncate font-medium">{campaign.title}</span>
          )}
          <Badge variant={state.variant}>{state.label}</Badge>
        </span>
        <span className="truncate text-xs text-muted-foreground">{campaign.phase.summary}</span>
        <NextAction campaign={campaign} />
      </div>
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
        {updatedLabel(campaign.updatedAt, timeZone)}
      </span>
      {campaign.openable ? (
        <Button variant="outline" size="sm" asChild className="shrink-0">
          <Link href={href}>Open</Link>
        </Button>
      ) : null}
    </li>
  );
}

export function CampaignPortfolio({
  organizationId,
  campaigns,
  timeZone,
  previewUrls = {},
}: Readonly<{
  organizationId: string;
  campaigns: readonly CampaignListItem[];
  timeZone: string;
  /** Signed preview links keyed by bundle version id. Empty when unavailable. */
  previewUrls?: Readonly<Record<string, string>>;
}>) {
  const [layout, setLayout] = useState<"gallery" | "list">("gallery");
  const [query, setQuery] = useState("");

  const waiting = useMemo(
    () => campaigns.filter((campaign) => needsAttention(campaign.phase)).length,
    [campaigns],
  );

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return campaigns;
    return campaigns.filter(
      (campaign) =>
        campaign.title.toLowerCase().includes(needle) ||
        (campaign.objective ?? "").toLowerCase().includes(needle) ||
        campaign.channels.some((channel) => channel.toLowerCase().includes(needle)),
    );
  }, [campaigns, query]);

  const filtering = shown.length !== campaigns.length;

  function previewFor(campaign: CampaignListItem): string | null {
    return campaign.bundleVersionId ? (previewUrls[campaign.bundleVersionId] ?? null) : null;
  }

  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <Sparkles />
        <AlertTitle>Two entry points, one governed pipeline</AlertTitle>
        <AlertDescription>
          A Decision Engine opportunity and a manual brief create the same kind of campaign and pass
          the same checks before anything can be approved.
        </AlertDescription>
      </Alert>

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href={`/organizations/${organizationId}/campaigns/new`}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            New campaign brief
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href={`/organizations/${organizationId}/opportunities`}>
            <FileText data-icon="inline-start" aria-hidden="true" />
            Start from an opportunity
          </Link>
        </Button>
      </div>

      {campaigns.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Sparkles />
            </EmptyMedia>
            <EmptyTitle>No campaigns yet</EmptyTitle>
            <EmptyDescription>
              Start from a Decision Engine opportunity, or write a brief yourself. Both arrive here
              as a proposal to review before anything is published.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium">
                {/*
                  A filtered count never replaces the total. Saying "3
                  campaigns" while nine are hidden behind a search box is how
                  somebody concludes work has gone missing.
                */}
                {filtering
                  ? `Showing ${shown.length} of ${campaigns.length} campaigns`
                  : `${campaigns.length} ${campaigns.length === 1 ? "campaign" : "campaigns"}`}
              </span>
              <span className="text-xs text-muted-foreground">
                {waiting === 0
                  ? "None are waiting on you."
                  : `${waiting} ${waiting === 1 ? "is" : "are"} waiting on somebody.`}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search campaigns"
                aria-label="Search campaigns"
                className="h-9 w-full sm:w-56"
              />
              <div className="flex rounded-md border p-0.5" role="group" aria-label="Layout">
                <Button
                  type="button"
                  size="sm"
                  variant={layout === "gallery" ? "secondary" : "ghost"}
                  aria-pressed={layout === "gallery"}
                  onClick={() => setLayout("gallery")}
                >
                  <LayoutGrid data-icon="inline-start" aria-hidden="true" />
                  Gallery
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={layout === "list" ? "secondary" : "ghost"}
                  aria-pressed={layout === "list"}
                  onClick={() => setLayout("list")}
                >
                  <List data-icon="inline-start" aria-hidden="true" />
                  List
                </Button>
              </div>
            </div>
          </div>

          {shown.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Sparkles />
                </EmptyMedia>
                <EmptyTitle>Nothing matches that search</EmptyTitle>
                <EmptyDescription>
                  {campaigns.length} {campaigns.length === 1 ? "campaign" : "campaigns"} exist here;
                  none of them match &ldquo;{query.trim()}&rdquo;. Clear the search to see them
                  again.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : layout === "gallery" ? (
            <ul aria-label="Campaigns" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((campaign) => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  organizationId={organizationId}
                  timeZone={timeZone}
                  previewUrl={previewFor(campaign)}
                />
              ))}
            </ul>
          ) : (
            <ul aria-label="Campaigns" className="flex flex-col gap-2">
              {shown.map((campaign) => (
                <CampaignRow
                  key={campaign.id}
                  campaign={campaign}
                  organizationId={organizationId}
                  timeZone={timeZone}
                  previewUrl={previewFor(campaign)}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
