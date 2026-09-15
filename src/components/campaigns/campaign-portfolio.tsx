"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Images, LayoutGrid, List, Loader2, Plus } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { CampaignCoverFigure } from "@/components/campaigns/campaign-cover-figure";
import {
  MissingDetailsDialog,
  type MissingDetailsMetricOption,
} from "@/components/campaigns/missing-details-dialog";
import { missingDetailLabel } from "@/domain/campaigns/readiness";
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
import {
  matchesFilter,
  needsAttention,
  phaseBadge,
  PORTFOLIO_FILTERS,
  type PortfolioFilter,
} from "@/domain/campaigns/phase";
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
 * Three honesty rules govern the counts here:
 *
 * The attention strip's count and its previews are computed separately, and the
 * count is over every campaign. Three rows must never imply the total is three.
 *
 * Filtering never changes the total. A search that narrows twelve campaigns to
 * three still says twelve exist — a filtered count presented as a total is how
 * somebody concludes work has disappeared.
 *
 * The status filters are display groupings over real phases, never a new
 * lifecycle. Nothing here archives a campaign or invents a state it is not in.
 */

/** At most three previews. The count beside them is the real total. */
const ATTENTION_PREVIEW_LIMIT = 3;

function GenerationNotice({
  generation,
  organizationId,
  campaignId,
  metricOptions,
  currency,
}: Readonly<{
  generation: CampaignGeneration;
  organizationId: string;
  campaignId: string;
  metricOptions: readonly MissingDetailsMetricOption[];
  currency: string | null;
}>) {
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
    // The design system's own error treatment, rather than muted grey inside a
    // dashed border. A failure that looks like a footnote gets read as one.
    <Alert variant="destructive">
      <AlertTriangle aria-hidden="true" />
      <AlertTitle>
        {generation.status === "failed" ? "Generation failed" : "Generation did not finish"}
      </AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <span>{generation.detail}</span>

        {generation.missingDetails.length > 0 ? (
          <>
            {/* Each gap named on its own, in words. A comma-separated run of
                `brand_voice, primary_metric` asks the reader to parse an
                identifier before they can act on it. */}
            <span className="flex flex-wrap gap-1">
              {generation.missingDetails.map((key) => (
                <Badge key={key} variant="outline" className="border-destructive/40">
                  {missingDetailLabel(key)}
                </Badge>
              ))}
            </span>
            <MissingDetailsDialog
              organizationId={organizationId}
              campaignId={campaignId}
              missingDetails={generation.missingDetails}
              metricOptions={metricOptions}
              currency={currency}
            />
          </>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

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
 * The fact that matters at this phase, and nothing else.
 *
 * A proposal's number is its proposed budget; a completed campaign's is its
 * result. Showing a proposed budget beside a finished campaign would read as
 * what it cost. Nothing here is a forecast dressed as an achievement, and a
 * null never renders as a zero.
 */
function phaseFact(campaign: CampaignListItem): string | null {
  switch (campaign.phase.phase) {
    case "proposal":
      return campaign.awaitingFirstVersion
        ? null
        : `Proposed budget ${formatMoney(campaign.spendCeiling)}`;
    case "creating":
      return "Creative being prepared";
    case "review":
      return "Finished outputs waiting for review";
    case "scheduled_live":
      // Deliberately not a spend figure. Nothing dispatches yet, so any number
      // here would be a claim about money that has not moved.
      return "Authorized to publish";
    case "results":
      return "Result measured";
    case "stopped":
      return null;
  }
}

/**
 * The artwork, or an honest stand-in.
 *
 * A campaign with no preview gets a labelled placeholder rather than a grey
 * box: "no artwork yet" and "artwork we could not load" both look like an empty
 * rectangle, and the operator has to be able to tell which happened.
 *
 * Rendering delegates to the shared cover figure, but this card keeps its
 * exact prior output: eager load, no error flip, and this card's own img and
 * fallback classes. The primitive's newer behaviour (lazy, error fallback)
 * stays behind props this caller does not opt into.
 */
function Artwork({
  previewUrl,
  awaitingFirstVersion,
  className,
}: Readonly<{ previewUrl: string | null; awaitingFirstVersion: boolean; className: string }>) {
  return (
    <CampaignCoverFigure
      src={previewUrl}
      alt=""
      fit="cover"
      imgClassName={`${className} object-cover`}
      loading="eager"
      errorFallback={false}
      fallback={
        <span
          className={`${className} flex flex-col items-center justify-center gap-1 bg-muted px-3 text-center`}
        >
          <span className="text-xs text-muted-foreground">
            {awaitingFirstVersion ? "No preview available" : "Preview unavailable"}
          </span>
          {awaitingFirstVersion ? (
            <span className="text-[10px] text-muted-foreground">
              Creative generation begins after approval
            </span>
          ) : null}
        </span>
      }
    />
  );
}

function CampaignCard({
  campaign,
  organizationId,
  timeZone,
  previewUrl,
  metricOptions,
  currency,
}: Readonly<{
  campaign: CampaignListItem;
  organizationId: string;
  timeZone: string;
  previewUrl: string | null;
  /** The measures a repaired goal may name. Empty hides nothing; the dialog says so. */
  metricOptions: readonly MissingDetailsMetricOption[];
  currency: string | null;
}>) {
  const href = `/organizations/${organizationId}/campaigns/${campaign.id}`;
  const fact = phaseFact(campaign);

  return (
    <li className="flex">
      <div className="flex w-full flex-col overflow-hidden rounded-lg border bg-card">
        <Link href={href} aria-label={campaign.title} className="block">
          <Artwork
            previewUrl={previewUrl}
            awaitingFirstVersion={campaign.awaitingFirstVersion}
            className="block h-44 w-full"
          />
        </Link>

        <div className="flex items-center justify-between gap-2 border-y px-3 py-1.5 text-xs text-muted-foreground">
          <span>{campaign.spendCeiling ? "Organic + Paid" : "Organic"}</span>
          <span>{previewUrl ? "Preview" : "No preview"}</span>
        </div>

        <div className="flex flex-1 flex-col gap-2 p-4">
          <div className="flex items-start justify-between gap-2">
            {/* Always a link, including when no proposal exists. The detail
                route answers that case directly — it names whether the campaign
                is still being built or whether generation stopped, which is
                exactly what somebody looking at a stalled card wants to know.
                Withholding the link hid the explanation from the one campaign
                that needed it. */}
            <Link href={href} className="font-semibold underline-offset-4 hover:underline">
              {campaign.title}
            </Link>
            <Badge variant="secondary" className="shrink-0">
              {phaseBadge(campaign.phase.phase)}
            </Badge>
          </div>

          <p className="text-sm text-muted-foreground">
            {/* The objective lives in a bundle version. Until one exists there
                is nothing truthful to put here. */}
            {campaign.objective ?? "Waiting for the first proposal to be generated."}
          </p>

          {fact ? <p className="text-sm font-medium">{fact}</p> : null}
          <p className="text-xs text-muted-foreground">{campaign.phase.summary}</p>

          <GenerationNotice
            generation={campaign.generation}
            organizationId={organizationId}
            campaignId={campaign.id}
            metricOptions={metricOptions}
            currency={currency}
          />

          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <span className="text-xs text-muted-foreground">
              Updated {updatedLabel(campaign.updatedAt, timeZone)}
            </span>
            {/* A campaign whose generation stopped gets the button that
                restarts it; everything else gets the way in. Both are reachable
                either way — the title above links unconditionally. */}
            {campaign.openable ? (
              <Button variant="ghost" size="sm" asChild>
                <Link href={href}>
                  {campaign.phase.nextAction?.label ?? "Open"}
                  <ArrowRight data-icon="inline-end" aria-hidden="true" />
                </Link>
              </Button>
            ) : campaign.generation.status === "generating" ? (
              // Plainly "Open", not the phase's next action. A run is already in
              // flight, so labelling this "Generate the proposal" would invite
              // somebody to start a second one.
              <Button variant="ghost" size="sm" asChild>
                <Link href={href}>
                  Open
                  <ArrowRight data-icon="inline-end" aria-hidden="true" />
                </Link>
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
  const href = `/organizations/${organizationId}/campaigns/${campaign.id}`;

  return (
    <li className="flex items-center gap-3 rounded-lg border bg-card p-3">
      <Artwork
        previewUrl={previewUrl}
        awaitingFirstVersion={campaign.awaitingFirstVersion}
        className="block size-14 shrink-0 overflow-hidden rounded-md border"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <Link href={href} className="truncate font-medium underline-offset-4 hover:underline">
            {campaign.title}
          </Link>
          <Badge variant="secondary">{phaseBadge(campaign.phase.phase)}</Badge>
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {campaign.objective ?? "Waiting for the first proposal to be generated."}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {campaign.channels.join(" · ") || "No channels yet"} · {formatMoney(campaign.spendCeiling)}
        </span>
      </div>
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
        {updatedLabel(campaign.updatedAt, timeZone)}
      </span>
      <Button variant="outline" size="sm" asChild className="shrink-0">
        <Link href={href}>Open</Link>
      </Button>
    </li>
  );
}

/**
 * What is waiting on a person, with a real count.
 *
 * The count is computed over every campaign; the previews are capped at three.
 * They are separate on purpose — three rows plus "View all" must never be read
 * as "there are three things to do".
 */
function AttentionStrip({
  waiting,
  organizationId,
  onViewAll,
}: Readonly<{
  waiting: readonly CampaignListItem[];
  organizationId: string;
  onViewAll: () => void;
}>) {
  if (waiting.length === 0) return null;
  const previews = waiting.slice(0, ATTENTION_PREVIEW_LIMIT);

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4" aria-label="Needs your attention">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Needs your attention</h2>
        <Badge variant="secondary" className="rounded-full">
          {waiting.length}
        </Badge>
      </div>

      <ul className="flex flex-col divide-y">
        {previews.map((campaign) => (
          <li key={campaign.id} className="flex items-center justify-between gap-3 py-2.5">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium">{campaign.phase.nextAction?.label}</span>
              <span className="truncate text-sm text-muted-foreground">{campaign.title}</span>
            </span>
            <Button variant="ghost" size="sm" asChild className="shrink-0">
              <Link href={`/organizations/${organizationId}/campaigns/${campaign.id}`}>
                Open
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </Link>
            </Button>
          </li>
        ))}
      </ul>

      {waiting.length > previews.length ? (
        <Button variant="link" size="sm" className="w-fit px-0" onClick={onViewAll}>
          View all {waiting.length}
          <ArrowRight data-icon="inline-end" aria-hidden="true" />
        </Button>
      ) : null}
    </section>
  );
}

export function CampaignPortfolio({
  organizationId,
  campaigns,
  timeZone,
  previewUrls = {},
  metricOptions = [],
  currency = null,
}: Readonly<{
  organizationId: string;
  campaigns: readonly CampaignListItem[];
  timeZone: string;
  /** Signed preview links keyed by bundle version id. Empty when unavailable. */
  previewUrls?: Readonly<Record<string, string>>;
  /** Registered measures, for repairing a campaign missing its primary metric. */
  metricOptions?: readonly MissingDetailsMetricOption[];
  /** The organization's base currency, for a money-valued goal. */
  currency?: string | null;
}>) {
  const [layout, setLayout] = useState<"gallery" | "list">("gallery");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PortfolioFilter>("all");
  const [channel, setChannel] = useState("all");

  // Over every campaign, never over the filtered set: the strip answers "what
  // is waiting on me", which a search box does not change.
  const waiting = useMemo(
    () => campaigns.filter((campaign) => needsAttention(campaign.phase)),
    [campaigns],
  );

  const channels = useMemo(
    () => [...new Set(campaigns.flatMap((campaign) => campaign.channels))].sort(),
    [campaigns],
  );

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return campaigns.filter((campaign) => {
      if (!matchesFilter(campaign.phase.phase, filter)) return false;
      if (channel !== "all" && !campaign.channels.includes(channel)) return false;
      if (needle === "") return true;
      return (
        campaign.title.toLowerCase().includes(needle) ||
        (campaign.objective ?? "").toLowerCase().includes(needle) ||
        campaign.channels.some((entry) => entry.toLowerCase().includes(needle))
      );
    });
  }, [campaigns, query, filter, channel]);

  const filtering = shown.length !== campaigns.length;
  const filtersActive = query.trim() !== "" || filter !== "all" || channel !== "all";

  function clearFilters() {
    setQuery("");
    setFilter("all");
    setChannel("all");
  }

  function previewFor(campaign: CampaignListItem): string | null {
    return campaign.bundleVersionId ? (previewUrls[campaign.bundleVersionId] ?? null) : null;
  }

  if (campaigns.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <PortfolioHeader organizationId={organizationId} />
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Images />
            </EmptyMedia>
            <EmptyTitle>No campaigns yet</EmptyTitle>
            <EmptyDescription>
              Start from a Decision Engine opportunity, or request one yourself. Both arrive here as
              a proposal to review before anything is published.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PortfolioHeader organizationId={organizationId} />

      <AttentionStrip
        waiting={waiting}
        organizationId={organizationId}
        onViewAll={() => {
          clearFilters();
          setFilter("needs_review");
        }}
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            className="flex flex-wrap gap-1.5"
            role="group"
            aria-label="Filter campaigns by status"
          >
            {PORTFOLIO_FILTERS.map((entry) => (
              <Button
                key={entry.key}
                type="button"
                size="sm"
                variant={filter === entry.key ? "default" : "outline"}
                aria-pressed={filter === entry.key}
                onClick={() => setFilter(entry.key)}
              >
                {entry.label}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search campaigns"
              aria-label="Search campaigns"
              className="h-9 w-full sm:w-52"
            />
            {channels.length < 2 ? null : (
              <select
                value={channel}
                onChange={(event) => setChannel(event.target.value)}
                aria-label="Filter by channel"
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="all">All channels</option>
                {channels.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            )}
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

        <p className="text-sm">
          {/*
            A filtered count never replaces the total. Saying "3 campaigns"
            while nine are hidden behind a filter is how somebody concludes
            work has gone missing.
          */}
          <span className="font-medium">
            {filtering
              ? `Showing ${shown.length} of ${campaigns.length} campaigns`
              : `${campaigns.length} ${campaigns.length === 1 ? "campaign" : "campaigns"}`}
          </span>{" "}
          <span className="text-muted-foreground">
            {waiting.length === 0
              ? "None are waiting on you."
              : `${waiting.length} ${waiting.length === 1 ? "is" : "are"} waiting on somebody.`}
          </span>
        </p>
      </div>

      {shown.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Images />
            </EmptyMedia>
            <EmptyTitle>Nothing matches these filters</EmptyTitle>
            <EmptyDescription>
              {campaigns.length} {campaigns.length === 1 ? "campaign" : "campaigns"} exist here; none
              of them match what you have selected.
            </EmptyDescription>
          </EmptyHeader>
          <Button variant="outline" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
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
              metricOptions={metricOptions}
              currency={currency}
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

      {filtersActive && shown.length > 0 ? (
        <Button variant="link" size="sm" className="w-fit px-0" onClick={clearFilters}>
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}

function PortfolioHeader({ organizationId }: Readonly<{ organizationId: string }>) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          Your marketing work, from approved idea to results.
        </p>
        <Link
          href={`/organizations/${organizationId}/growth-intelligence`}
          className="flex w-fit items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
        >
          Review campaign recommendations
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href={`/organizations/${organizationId}/campaigns/new`}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            Request a campaign
          </Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href={`/organizations/${organizationId}/assets`}>
            <Images data-icon="inline-start" aria-hidden="true" />
            Asset Library
          </Link>
        </Button>
      </div>
    </div>
  );
}
