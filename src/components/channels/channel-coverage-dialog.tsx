"use client";

import { useEffect } from "react";
import Link from "next/link";

import { formatMoney } from "@/components/analysis/format";
import { ChannelIcon } from "@/components/channels/channel-icons";
import styles from "@/components/channels/channels-landing.module.css";
import type { ChannelsPortfolioPresentation } from "@/components/channels/channels-presentation";
import { MIXED_CURRENCY_COMPARISON_REASON } from "@/components/channels/channels-presentation";
import { formatComparisonPeriod } from "@/components/channels/channel-portfolio-chart";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ChannelsOverviewWindow } from "@/modules/analysis/application/channels-overview";

/**
 * Task 4 — coverage rail (V05), comparison explanation strip (V06), coverage
 * detail dialog (D02) and About channel setup dialog (D03).
 *
 * Everything here reads the already-derived `ChannelsPortfolioPresentation`
 * bands only: no new API, RPC, or provider-evidence fetch. Unknowns stay
 * words and em dashes, never zeros. Dialogs follow the D00 anatomy (single
 * Close X with `showCloseButton={false}`, real Title/Description, portal
 * `.theme`, Escape/outside close while idle, focus return to the opener).
 */

type BandState = ChannelsPortfolioPresentation["rows"][number]["band"]["state"];

function statusLabelFor(state: BandState): string {
  if (state === "complete") return "Measured";
  if (state === "revenue_only") return "Revenue only";
  return "Needs review";
}

function segmentColorFor(state: BandState): string {
  if (state === "complete") return "var(--channel-earned)";
  if (state === "revenue_only") return "var(--channel-reported)";
  return "var(--channel-neutral)";
}

/**
 * `Direct, Delivery B` — the prototype joins several revenue-only names with
 * commas, so no single-channel sentence is hardcoded.
 */
function joinChannelNames(names: readonly string[]): string {
  return names.join(", ");
}

/** `1 February 2026 – 28 February 2026 · Reported scope · AED`. */
function coverageScopeText(
  portfolio: ChannelsPortfolioPresentation,
  selected: ChannelsOverviewWindow | null,
): string {
  const scope =
    portfolio.comparisonCurrency != null
      ? `Reported scope · ${portfolio.comparisonCurrency}`
      : portfolio.comparisonReason === MIXED_CURRENCY_COMPARISON_REASON
        ? "Reported scope · Multiple currencies"
        : "Reported scope";
  return selected ? `${formatComparisonPeriod(selected)} · ${scope}` : scope;
}

/**
 * V05 coverage rail. Lives beside the plot inside the comparison Card (passed
 * to `ChannelPortfolioChart` as `coverageRail`). Counts come straight from
 * the portfolio: complete/active for the headline, per-state counts for the
 * rows. With no active rows it states `0 / 0` honestly and renders no
 * segments; when analysis is unavailable this rail is not rendered at all,
 * so no fake zeros are ever shown.
 */
export function ChannelCoverageRail({
  portfolio,
  onReview,
}: {
  portfolio: ChannelsPortfolioPresentation;
  onReview: () => void;
}) {
  const singular = portfolio.completeCount === 1;
  return (
    <aside aria-label="Data coverage" className={styles.coverageRail}>
      <p className={styles.coverageEyebrow}>The complete picture</p>
      <p className={styles.coverageBig}>
        {portfolio.completeCount}{" "}
        <span className={styles.coverageBigDenom}>/ {portfolio.activeCount} channels</span>
      </p>
      <p className={styles.coverageSentence}>
        {portfolio.rows.length === 0
          ? "No active channels to compare."
          : singular
            ? "has both revenue and loss data for this reporting window."
            : "have both revenue and loss data for this reporting window."}
      </p>
      {portfolio.rows.length > 0 ? (
        <div aria-hidden="true" className={styles.coverageStrip}>
          {portfolio.rows.map((rowEntry) => (
            <span
              key={rowEntry.channelId}
              className={styles.coverageSegment}
              style={{ background: segmentColorFor(rowEntry.band.state) }}
            />
          ))}
        </div>
      ) : null}
      <div>
        <div className={styles.coverageRow}>
          <span className={styles.coverageRowLabel}>Revenue + loss</span>
          <span className={styles.coverageRowCount}>{portfolio.completeCount}</span>
        </div>
        <div className={styles.coverageRow}>
          <span className={styles.coverageRowLabel}>Revenue only</span>
          <span className={styles.coverageRowCount}>{portfolio.revenueOnlyCount}</span>
        </div>
        <div className={styles.coverageRow}>
          <span className={styles.coverageRowLabel}>No comparable figure</span>
          <span className={styles.coverageRowCount}>{portfolio.refusedCount}</span>
        </div>
      </div>
      <div className={styles.coverageReview}>
        <Button
          type="button"
          variant="link"
          onClick={onReview}
          className="h-auto gap-[7px] px-0 text-xs font-bold text-primary no-underline hover:no-underline"
        >
          Review data coverage
          <ChannelIcon name="arrow" className="size-[18px]" />
        </Button>
      </div>
    </aside>
  );
}

/**
 * V06 comparison explanation strip. Rendered at the comparison Card bottom
 * (after the earned-definition footer), with an info icon and no click
 * handler: it explains, it never navigates.
 */
export function ComparisonExplanationStrip({
  portfolio,
}: {
  portfolio: ChannelsPortfolioPresentation;
}) {
  const revenueOnlyNames = portfolio.rows
    .filter((rowEntry) => rowEntry.band.state === "revenue_only")
    .map((rowEntry) => rowEntry.displayName);
  const text =
    portfolio.rows.length === 0
      ? "No active channels to compare."
      : revenueOnlyNames.length > 0
        ? `${joinChannelNames(revenueOnlyNames)} ${revenueOnlyNames.length === 1 ? "has" : "have"} revenue data, but no recorded loss. Included in reported revenue; excluded from earned and loss totals.`
        : "Only channels with both revenue and loss contribute to earned and loss totals.";
  return (
    <p className={styles.explanationStrip}>
      <ChannelIcon name="info" className={styles.explanationStripIcon} />
      <span>{text}</span>
    </p>
  );
}

function coverageRowId(channelId: string): string {
  return `channel-coverage-row-${channelId}`;
}

function focusCoverageRow(channelId: string): void {
  if (typeof document === "undefined") return;
  const element = document.getElementById(coverageRowId(channelId));
  if (!element) return;
  element.scrollIntoView?.({ block: "nearest" });
  element.focus({ preventScroll: true });
}

/**
 * D02 data-coverage dialog. Expands the Task 3 single-channel band detail
 * into the full per-channel list; `ChannelsRollup` keeps owning the open
 * state and passes its `inspectedChannelId` as `focusedChannelId`, so a
 * chart-row inspection lands on that channel's section in this same dialog
 * instead of a second disconnected model. Archived rows never appear:
 * `portfolio.rows` is active-only by construction.
 */
export function ChannelCoverageDialog({
  organizationId,
  portfolio,
  selectedWindow,
  open,
  onOpenChange,
  focusedChannelId,
}: {
  organizationId: string;
  portfolio: ChannelsPortfolioPresentation;
  selectedWindow: ChannelsOverviewWindow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  focusedChannelId?: string | null;
}) {
  const focused = focusedChannelId ?? null;

  // Belt and suspenders with `onOpenAutoFocus` below: Radix moves initial
  // focus itself, so the chart-opened row is focused both at open time and
  // whenever the focused channel changes while open.
  useEffect(() => {
    if (open && focused) focusCoverageRow(focused);
  }, [open, focused]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          if (!focused) return;
          if (typeof document === "undefined") return;
          const element = document.getElementById(coverageRowId(focused));
          if (!element) return;
          event.preventDefault();
          element.scrollIntoView?.({ block: "nearest" });
          element.focus({ preventScroll: true });
        }}
        className={`${styles.theme} max-h-[90svh] max-w-[calc(100vw-28px)] overflow-y-auto sm:max-w-[520px]`}
      >
        <DialogHeader className="flex-row items-center justify-between border-b pb-4">
          <div className="grid gap-1">
            <DialogTitle>Data coverage</DialogTitle>
            <DialogDescription>{coverageScopeText(portfolio, selectedWindow)}</DialogDescription>
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" className="size-[38px]" aria-label="Close dialog">
              <ChannelIcon name="close" />
            </Button>
          </DialogClose>
        </DialogHeader>
        <div className="grid gap-1 py-1">
          {portfolio.rows.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">No active channels to compare.</p>
          ) : (
            portfolio.rows.map((rowEntry) => {
              const status = statusLabelFor(rowEntry.band.state);
              const reported = rowEntry.band.potential;
              const earned = rowEntry.band.state === "complete" ? rowEntry.band.earned : null;
              const lost = rowEntry.band.state === "complete" ? rowEntry.band.lost : null;
              return (
                <section
                  key={rowEntry.channelId}
                  id={coverageRowId(rowEntry.channelId)}
                  tabIndex={-1}
                  aria-label={`${rowEntry.displayName}, ${status}`}
                  className="border-b py-3 outline-none last:border-b-0"
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="text-sm font-semibold">{rowEntry.displayName}</p>
                    <p className="text-xs text-muted-foreground">{status}</p>
                  </div>
                  {rowEntry.band.state === "refused" ? (
                    <p className="pt-2 text-sm text-muted-foreground">
                      No comparable revenue figure for this window.
                    </p>
                  ) : (
                    <dl className="grid pt-1 text-sm">
                      <div className="flex items-center justify-between gap-4 border-b py-[11px]">
                        <dt className="text-muted-foreground">Reported revenue</dt>
                        <dd className="text-right font-medium tabular-nums">
                          {reported
                            ? formatMoney(reported.minorUnits, reported.currency)
                            : "No comparable revenue figure for this window."}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-4 border-b py-[11px]">
                        <dt className="text-muted-foreground">Earned</dt>
                        <dd className="text-right font-medium tabular-nums">
                          {earned
                            ? formatMoney(earned.minorUnits, earned.currency)
                            : "Not available without recorded loss"}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-4 py-[11px]">
                        <dt className="text-muted-foreground">Provider-reported loss</dt>
                        <dd className="text-right font-medium tabular-nums">
                          {lost ? formatMoney(lost.minorUnits, lost.currency) : "Not recorded"}
                        </dd>
                      </div>
                    </dl>
                  )}
                  <div className="pt-1">
                    <Button
                      asChild
                      variant="link"
                      className="h-auto gap-[7px] px-0 text-xs font-semibold text-muted-foreground no-underline hover:no-underline hover:text-primary"
                    >
                      <Link
                        href={`/organizations/${organizationId}/channels/${rowEntry.channelId}`}
                        aria-label={`Channel Audit for ${rowEntry.displayName}`}
                      >
                        Channel Audit
                        <ChannelIcon name="up" className="size-[13px]" />
                      </Link>
                    </Button>
                  </div>
                </section>
              );
            })
          )}
          <Alert>
            <AlertDescription>
              Measured means revenue and provider-reported loss are available. It does not establish
              profit or attribute a result to platform actions.
            </AlertDescription>
          </Alert>
          <p className="py-2 text-sm text-muted-foreground">
            Revenue-only channels contribute to reported revenue. Channels without a comparable
            figure remain visible.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * D03 About channel setup dialog. Identity/location/report-label explanation
 * plus the boundary rule, with a real tenant-scoped Integration Hub link.
 * Read-only: the Close X is the only control.
 */
export function AboutChannelSetupDialog({
  organizationId,
  open,
  onOpenChange,
}: {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={`${styles.theme} max-h-[90svh] max-w-[calc(100vw-28px)] overflow-y-auto sm:max-w-[520px]`}
      >
        <DialogHeader className="flex-row items-center justify-between border-b pb-4">
          <div className="grid gap-1">
            <DialogTitle>A channel is where you sell</DialogTitle>
            <DialogDescription>
              A marketplace, your website or a physical store can each be a channel. Keep them
              together here to compare performance and organise reporting.
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" className="size-[38px]" aria-label="Close dialog">
              <ChannelIcon name="close" />
            </Button>
          </DialogClose>
        </DialogHeader>
        <div className="grid gap-1 py-1 text-sm">
          <div className="flex items-center justify-between gap-4 border-b py-[11px]">
            <p className="font-semibold">Channel identity</p>
            <p className="text-right text-muted-foreground">Name and category</p>
          </div>
          <div className="flex items-center justify-between gap-4 border-b py-[11px]">
            <p className="font-semibold">Locations</p>
            <p className="text-right text-muted-foreground">Where the channel operates</p>
          </div>
          <div className="flex items-center justify-between gap-4 border-b py-[11px]">
            <p className="font-semibold">Report labels</p>
            <p className="text-right text-muted-foreground">Other names for the same channel</p>
          </div>
          <Alert>
            <AlertDescription>
              Adding a channel does not connect a provider or grant permission to run campaigns.
              Connections stay in Integration Hub.
            </AlertDescription>
          </Alert>
          <div className="pt-2">
            <Button
              asChild
              variant="link"
              className="h-auto gap-[7px] px-0 text-xs font-bold text-primary no-underline hover:no-underline"
            >
              <Link href={`/organizations/${organizationId}/integrations`}>
                Open Integration Hub
                <ChannelIcon name="up" className="size-[18px]" />
              </Link>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
