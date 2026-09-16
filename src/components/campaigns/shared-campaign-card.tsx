"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Images, Loader2, Megaphone } from "lucide-react";
import { toast } from "sonner";

import { idempotencyKey, startGeneration } from "@/components/campaigns/campaign-actions";
import { CampaignCoverFigure } from "@/components/campaigns/campaign-cover-figure";
import { resolveCampaignStateChip } from "@/components/campaigns/campaign-state-chip";
import {
  MissingDetailsDialog,
  type MissingDetailsMetricOption,
} from "@/components/campaigns/missing-details-dialog";
import { formatShortDate } from "@/components/organizations/home/home-dates";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import type { CampaignGeneration } from "@/modules/campaigns/application/studio-view";

/**
 * The one campaign card shared by the organization-home summary and the
 * /campaigns portfolio gallery.
 *
 * Both surfaces showed the same campaigns with different cards — different
 * corner radii, different status words ("Needs review" beside "Ready For
 * Review"), different bodies — so one campaign read as two different pieces
 * of work. This component is the single rendering both callers use for the
 * parts they genuinely share, following the organization-home prototype:
 *
 * - the artwork with the source label as a chip overlaid bottom-left on the
 *   image (never a plain-text strip elsewhere),
 * - the state tag above the title,
 * - title plus description only,
 * - the divider foot row with the updated date left and the action link right.
 *
 * Labels and hrefs arrive verbatim from the server-derived props each caller
 * passes in. Nothing here invents a label, a state, or a next step: the
 * repair trigger and the restart link reuse the same wording and endpoints
 * the portfolio already used.
 */

/** Shown when a campaign has no objective yet. Portfolio wording, reused verbatim. */
export const WAITING_DESCRIPTION = "Waiting for the first proposal to be generated.";

// The label/tone mapping lives in the server-safe `campaign-state-chip.ts`
// so Server Components (home summary) can resolve chips without importing
// this client module. Re-exported here for client-side callers and tests.
export { resolveCampaignStateChip };

export type SharedCardRepair = {
  organizationId: string;
  campaignId: string;
  missingDetails: readonly string[];
  metricOptions: readonly MissingDetailsMetricOption[];
  currency: string | null;
};

export type SharedCardRestart = {
  organizationId: string;
  campaignId: string;
  /** Existing wording, e.g. "Generate again". Never invented here. */
  label: string;
};

export type SharedCampaignCardProps = {
  title: string;
  /** The objective, or null while no proposal exists. */
  description: string | null;
  href: string;
  updatedAt: string;
  timeZone: string;
  stateLabel: string;
  stateTone: "success" | "warning";
  previewUrl: string | null;
  coverAlt?: string;
  coverWidth?: number;
  coverHeight?: number;
  imageFit?: "cover" | "contain";
  /**
   * The artwork source label (home `coverLabel`). Null defaults to
   * "Finished render" when a preview exists; nothing overlays the fallback.
   */
  coverChip?: string | null;
  /** A second honest fallback line, e.g. the awaiting-generation hint. */
  fallbackHint?: string | null;
  generation: CampaignGeneration;
  /** The server-derived action, verbatim. Null when the restart takes its place. */
  primaryAction: { label: string; href: string } | null;
  restart?: SharedCardRestart | null;
  repair?: SharedCardRepair | null;
};

/**
 * The restart, kept with its exact prior behaviour but rendered as the same
 * green text-link with a right arrow the foot uses everywhere else — never
 * the old bare outline button.
 */
function RestartLink({ organizationId, campaignId, label }: SharedCardRestart) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);

  async function start() {
    setStarting(true);
    const result = await startGeneration({
      organizationId,
      campaignId,
      idempotencyKey: idempotencyKey(),
    });
    setStarting(false);

    if (!result.ok) {
      toast.error("Could not start generation", { description: result.message });
      return;
    }

    toast.success("Generation started", {
      description: "The proposal is being built. This page will show it when it is ready.",
    });
    router.refresh();
  }

  return (
    <Button variant="link" size="sm" onClick={start} disabled={starting}>
      {starting ? "Starting…" : label}
      <ArrowRight data-icon="inline-end" aria-hidden="true" />
    </Button>
  );
}

export function SharedCampaignCard({
  title,
  description,
  href,
  updatedAt,
  timeZone,
  stateLabel,
  stateTone,
  previewUrl,
  coverAlt = "",
  coverWidth,
  coverHeight,
  imageFit = "cover",
  coverChip = null,
  fallbackHint = null,
  generation,
  primaryAction,
  restart = null,
  repair = null,
}: Readonly<SharedCampaignCardProps>) {
  const chip = previewUrl !== null ? (coverChip ?? "Finished render") : null;
  const generatingDetail = generation.status === "generating" ? generation.detail : null;
  const failed = generation.status === "failed" || generation.status === "stalled";
  const showRepair = failed && repair !== null && repair.missingDetails.length > 0;
  const showRestart =
    restart !== null && generation.status !== "generating" && primaryAction === null;

  return (
    // `data-slot="card"` keeps the home campaign tests' card scoping working;
    // this is a plain div rather than the shadcn Card so the artwork can bleed
    // to the top edge and the foot divider can sit flush.
    <div
      data-slot="card"
      className="flex w-full flex-col overflow-hidden rounded-2xl border bg-card transition-[border-color,box-shadow] duration-150 hover:border-[#b6c8b8] hover:shadow-[0_5px_16px_#1c40240a]"
    >
      <div className="relative h-44 w-full overflow-hidden bg-muted">
        <Link href={href} aria-label={title} className="block h-full w-full">
          <CampaignCoverFigure
            src={previewUrl}
            alt={coverAlt}
            fit={imageFit}
            chip={chip}
            width={coverWidth}
            height={coverHeight}
            fallback={
              <span className="flex h-full w-full flex-col items-center justify-center gap-1 bg-muted px-3 text-center">
                <Images aria-hidden="true" className="size-5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">No preview available</span>
                {fallbackHint !== null ? (
                  <span className="text-[10px] text-muted-foreground">{fallbackHint}</span>
                ) : null}
              </span>
            }
          />
        </Link>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <StatusBadge label={stateLabel} tone={stateTone} />
        <h3 dir="auto" className="text-[15px] leading-[1.35] font-semibold">
          {title}
        </h3>
        <p dir="auto" className="text-[13px] leading-[1.5] text-muted-foreground">
          {description ?? WAITING_DESCRIPTION}
        </p>

        {generatingDetail !== null ? (
          <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
            <span>{generatingDetail}</span>
          </p>
        ) : null}

        {/* A failure is never an Alert box on the card. When the run named
            what it was missing, the only thing shown is the dialog that
            collects it; otherwise the foot's restart (or the compact row's
            View link, per caller) is the way back. */}
        {showRepair && repair !== null ? (
          <div className="pt-1">
            <MissingDetailsDialog
              organizationId={repair.organizationId}
              campaignId={repair.campaignId}
              missingDetails={repair.missingDetails}
              metricOptions={repair.metricOptions}
              currency={repair.currency}
            />
          </div>
        ) : null}

        <div className="mt-auto pt-3.5">
          <div className="flex items-center justify-between gap-2 border-t pt-3">
            <p className="text-[11px] leading-[1.5] text-muted-foreground">
              Updated <time dateTime={updatedAt}>{formatShortDate(updatedAt, timeZone)}</time>
            </p>
            {primaryAction !== null ? (
              <Button asChild variant="link" size="sm">
                <Link href={primaryAction.href}>
                  {primaryAction.label}
                  <ArrowRight data-icon="inline-end" aria-hidden="true" />
                </Link>
              </Button>
            ) : showRestart && restart !== null ? (
              <RestartLink
                organizationId={restart.organizationId}
                campaignId={restart.campaignId}
                label={restart.label}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export type SharedCompactCampaignRowProps = {
  title: string;
  /** The stalled detail verbatim, else the objective, else null for no line. */
  reason: string | null;
  href: string;
  /** Verbatim caller label: home `actionLabel`, portfolio "View". */
  ctaLabel: string;
  /** Home passes "Third campaign" so the row keeps its accessible name. */
  ariaLabel?: string;
};

/**
 * The prototype's third-campaign row for a campaign with no proposal whose
 * generation stopped: icon, title, reason, the amber "Needs attention" tag
 * and the View link. Never a large card.
 */
export function SharedCompactCampaignRow({
  title,
  reason,
  href,
  ctaLabel,
  ariaLabel,
}: Readonly<SharedCompactCampaignRowProps>) {
  return (
    <div
      aria-label={ariaLabel}
      className="flex items-center gap-3 rounded-[9px] border bg-card px-4 py-3.5"
    >
      <span aria-hidden="true" className="flex shrink-0 text-muted-foreground">
        <Megaphone className="size-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span dir="auto" className="text-sm font-semibold">
          {title}
        </span>
        {reason !== null ? (
          <span dir="auto" className="text-xs text-muted-foreground">
            {reason}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <StatusBadge label="Needs attention" tone="warning" />
        <Button asChild variant="link" size="sm">
          <Link href={href}>
            {ctaLabel}
            <ArrowRight data-icon="inline-end" aria-hidden="true" />
          </Link>
        </Button>
      </span>
    </div>
  );
}
