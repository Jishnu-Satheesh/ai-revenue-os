"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { formatMoney } from "@/components/analysis/format";
import styles from "@/components/channels/channels-landing.module.css";
import { ChannelIcon } from "@/components/channels/channel-icons";
import type {
  ChannelsLandingAnalysis,
  ChannelsPortfolioPresentation,
} from "@/components/channels/channels-presentation";
import {
  buildChannelsPortfolioPresentation,
  formatChannelsWindowOption,
  MIXED_CURRENCY_COMPARISON_REASON,
} from "@/components/channels/channels-presentation";
import {
  ChannelCoverageDialog,
  ChannelCoverageRail,
  ComparisonExplanationStrip,
} from "@/components/channels/channel-coverage-dialog";
import {
  ChannelPortfolioChart,
  formatWholeMajorUnits,
} from "@/components/channels/channel-portfolio-chart";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type {
  ChannelsOverviewView,
  ChannelsOverviewWindow,
} from "@/modules/analysis/application/channels-overview";

const GRAIN_LABELS = {
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
  span: "Span",
} as const;

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function dateParts(date: string): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-").map(Number);
  return { year: year ?? 0, month: month ?? 0, day: day ?? 0 };
}

/** `1 February 2026`. Built from UTC-safe parts so browser timezone cannot move the date. */
function formatFullDate(date: string): string {
  const { year, month, day } = dateParts(date);
  return `${day} ${MONTHS_LONG[month - 1]} ${year}`;
}

/** `1 February 2026 – 28 February 2026`. The dialog and accessible names use this, never a truncation. */
function formatFullRange(window: ChannelsOverviewWindow): string {
  return `${formatFullDate(window.windowStart)} – ${formatFullDate(window.windowEnd)}`;
}

/**
 * `1–28 Feb`. The compact context caption beside the selector; the full
 * dates always travel in the button's accessible name.
 */
function formatAbbreviatedRange(window: ChannelsOverviewWindow): string {
  const start = dateParts(window.windowStart);
  const end = dateParts(window.windowEnd);
  if (start.year === end.year && start.month === end.month) {
    return `${start.day}–${end.day} ${MONTHS_SHORT[start.month - 1]}`;
  }
  if (start.year === end.year) {
    return `${start.day} ${MONTHS_SHORT[start.month - 1]} – ${end.day} ${MONTHS_SHORT[end.month - 1]}`;
  }
  return `${start.day} ${MONTHS_SHORT[start.month - 1]} ${start.year} – ${end.day} ${MONTHS_SHORT[end.month - 1]} ${end.year}`;
}

/**
 * The scope caption next to the selector. Names one comparison currency when
 * the reported total states one, admits a mismatch honestly, and otherwise
 * claims nothing about scope.
 */
function scopeCaptionFor(portfolio: ChannelsPortfolioPresentation): string {
  if (portfolio.reportedTotal && portfolio.comparisonCurrency) {
    return `Reported scope · ${portfolio.comparisonCurrency}`;
  }
  if (portfolio.comparisonReason === MIXED_CURRENCY_COMPARISON_REASON) {
    return "Reported scope · Multiple currencies";
  }
  return "Reported scope";
}

function ReportingWindowDialog({
  open,
  onOpenChange,
  selected,
  scopeCaption,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: ChannelsOverviewWindow;
  scopeCaption: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={`${styles.theme} max-w-[calc(100vw-28px)] sm:max-w-[520px]`}
      >
        <DialogHeader className="flex-row items-center justify-between border-b pb-4">
          <DialogTitle>Reporting window</DialogTitle>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" className="size-[38px]" aria-label="Close dialog">
              <ChannelIcon name="close" />
            </Button>
          </DialogClose>
        </DialogHeader>
        <div className="grid gap-4 py-1 text-sm">
          <div className="grid gap-1">
            <p className="font-bold">{formatFullRange(selected)}</p>
            <p className="text-xs text-muted-foreground">{scopeCaption}</p>
          </div>
          <DialogDescription>
            The comparison and directory use this same exact reporting window. Each channel shows
            whether its revenue and loss data are available.
          </DialogDescription>
          <dl className="grid gap-2 border-t pt-4 text-sm">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">Grain</dt>
              <dd className="font-medium">
                {GRAIN_LABELS[selected.grain]} ({selected.grain})
              </dd>
            </div>
          </dl>
          <Alert>
            <AlertDescription>
              Figures come from the latest completed channel analyses for these dates and grain.
              Location coverage follows each source analysis; this overview does not establish
              all-location coverage.
            </AlertDescription>
          </Alert>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * V03 four-metric strip (Task 3). Headline visuals round to whole major units;
 * each value carries the exact figure in its accessible name without adding
 * visible buttons. Null is an em dash with the actual reason, never a
 * converted total or a currency prefix pretending over a zero.
 */
function PortfolioSummaryStrip({ portfolio }: { portfolio: ChannelsPortfolioPresentation }) {
  const reported = portfolio.reportedTotal;
  const earned = portfolio.earnedTotal;
  const lost = portfolio.lostTotal;
  const channels = (count: number) => (count === 1 ? "channel" : "channels");

  return (
    <section aria-label="Channel performance summary" className={styles.statStrip}>
      <div
        className={styles.statCell}
        role="group"
        aria-label={
          reported
            ? `Reported revenue ${formatMoney(reported.minorUnits, reported.currency)}, across ${portfolio.reportedCount} of ${portfolio.activeCount} active ${channels(portfolio.activeCount)}.`
            : `Reported revenue unavailable. ${portfolio.comparisonReason ?? ""}`
        }
      >
        <p className={styles.statLabel}>Reported revenue</p>
        <p className={styles.statValue}>
          {reported ? (
            <>
              <span className={styles.statPrefix}>{reported.currency}</span>
              <span>{formatWholeMajorUnits(reported.minorUnits, reported.currency)}</span>
            </>
          ) : (
            <span>—</span>
          )}
        </p>
        <p className={styles.statNote}>
          {reported
            ? `Across ${portfolio.reportedCount} of ${portfolio.activeCount} active ${channels(portfolio.activeCount)}`
            : (portfolio.comparisonReason ?? "No reported revenue figure.")}
        </p>
      </div>

      <div
        className={styles.statCell}
        role="group"
        aria-label={
          earned
            ? `Earned ${formatMoney(earned.minorUnits, earned.currency)}, revenue less loss across ${portfolio.completeCount} ${channels(portfolio.completeCount)}.`
            : `Earned unavailable. ${portfolio.earnedReason ?? ""}`
        }
      >
        <p className={styles.statLabel}>Earned</p>
        <p className={`${styles.statValue} ${styles.statValueEarned}`}>
          {earned ? (
            <>
              <span className={styles.statPrefix}>{earned.currency}</span>
              <span>{formatWholeMajorUnits(earned.minorUnits, earned.currency)}</span>
            </>
          ) : (
            <span>—</span>
          )}
        </p>
        <p className={styles.statNote}>
          {earned
            ? `Revenue less loss · ${portfolio.completeCount} ${channels(portfolio.completeCount)}`
            : (portfolio.earnedReason ?? "No earned figure.")}
        </p>
      </div>

      <div
        className={styles.statCell}
        role="group"
        aria-label={
          lost
            ? `Provider-reported loss ${formatMoney(lost.minorUnits, lost.currency)}, across ${portfolio.completeCount} ${channels(portfolio.completeCount)}.`
            : `Provider-reported loss unavailable. ${portfolio.earnedReason ?? ""}`
        }
      >
        <p className={styles.statLabel}>Provider-reported loss</p>
        <p className={`${styles.statValue} ${styles.statValueLost}`}>
          {lost ? (
            <>
              <span className={styles.statPrefix}>{lost.currency}</span>
              <span>{formatWholeMajorUnits(lost.minorUnits, lost.currency)}</span>
            </>
          ) : (
            <span>—</span>
          )}
        </p>
        <p className={styles.statNote}>
          {lost
            ? `Reported loss · ${portfolio.completeCount} ${channels(portfolio.completeCount)}`
            : (portfolio.earnedReason ?? "No reported loss figure.")}
        </p>
      </div>

      <div
        className={styles.statCell}
        role="group"
        aria-label={`Channel coverage ${portfolio.reportedCount} of ${portfolio.activeCount}. Channels with reported revenue.`}
      >
        <p className={styles.statLabel}>Channel coverage</p>
        <p className={styles.statValue}>
          <span>
            {portfolio.reportedCount} / {portfolio.activeCount}
          </span>
        </p>
        <p className={styles.statNote}>Channels with reported revenue</p>
      </div>
    </section>
  );
}

function UnavailableRollup() {
  const router = useRouter();
  return (
    <Alert>
      <AlertTitle>Channel performance is unavailable</AlertTitle>
      <AlertDescription>
        Your channels are still available. Try loading performance again.
      </AlertDescription>
      <div className="mt-3">
        <Button variant="outline" size="sm" onClick={() => router.refresh()}>
          Try again
        </Button>
      </div>
    </Alert>
  );
}

/**
 * The ready analysis state: one compact reporting-period selector driving the
 * toolbar caption, the context dialog and every figure below it. The selected
 * value always comes from server props, so browser Back/Forward resolves from
 * props rather than stale local state; while a navigation is in flight the old
 * caption and old figures stay on screen together.
 */
function ReadyRollup({
  organizationId,
  view,
}: {
  organizationId: string;
  view: ChannelsOverviewView;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [infoOpen, setInfoOpen] = useState(false);
  // Task 4: `inspectedChannelId` is the chart-opened channel. A chart row
  // opens the full coverage dialog (D02) focused on that row; the rail's
  // Review link opens the same dialog unfocused. One dialog, one model.
  const [inspectedChannelId, setInspectedChannelId] = useState<string | null>(null);
  const [coverageOpen, setCoverageOpen] = useState(false);

  const portfolio = buildChannelsPortfolioPresentation(view);
  const selected = view.selectedWindow;

  const onWindowChange = (value: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("window", value);
    startTransition(() => {
      router.push(`/organizations/${organizationId}/channels?${params.toString()}`);
    });
  };

  if (view.windows.length === 0) {
    return (
      <div className="grid gap-1">
        <p className="text-sm font-semibold">No reporting windows yet.</p>
        <p className="text-sm text-muted-foreground">
          Open a channel to review its reports and setup.
        </p>
      </div>
    );
  }

  return (
    <section aria-label="Channel portfolio analysis" className="grid gap-4">
      <div className="mt-7 mb-[23px] flex flex-wrap items-center justify-between gap-3 max-[650px]:mt-6 max-[650px]:mb-[18px]">
        <div className="flex items-center gap-2.5">
          <Select value={selected?.value ?? ""} onValueChange={onWindowChange} disabled={isPending}>
            <SelectTrigger
              aria-label="Reporting period"
              className="min-h-[38px] border-input bg-card px-2.5 text-xs font-semibold"
            >
              <ChannelIcon name="calendar" className="size-[15px] text-muted-foreground" />
              <SelectValue
                placeholder="Choose a reporting window"
                className="max-w-[165px] truncate"
              />
            </SelectTrigger>
            <SelectContent
              className={`${styles.theme} max-h-[300px] min-w-[var(--radix-select-trigger-width)]`}
            >
              <SelectGroup>
                {view.windows.map((entry) => (
                  <SelectItem key={entry.value} value={entry.value}>
                    {formatChannelsWindowOption(entry, view.windows)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {selected ? scopeCaptionFor(portfolio) : "Reported scope"}
          </p>
        </div>

        {selected ? (
          <Button
            variant="link"
            className="h-auto gap-2.5 px-1 text-xs font-bold no-underline"
            aria-label={`Reporting window: ${formatFullDate(selected.windowStart)} to ${formatFullDate(selected.windowEnd)}`}
            onClick={() => setInfoOpen(true)}
          >
            <span aria-hidden="true" className="size-1.5 rounded-full bg-(--channel-earned)" />
            <span>{formatAbbreviatedRange(selected)} · reported window</span>
            <ChannelIcon name="info" className="size-[18px]" />
          </Button>
        ) : (
          <p className="flex items-center gap-2.5 px-1 text-xs font-bold text-muted-foreground">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-muted-foreground/40" />
            <span>No reporting window selected</span>
            <ChannelIcon name="info" className="size-[18px]" />
          </p>
        )}
      </div>

      {isPending ? (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-3.5" />
          Loading reporting window…
        </p>
      ) : null}

      {selected ? (
        <>
          <PortfolioSummaryStrip portfolio={portfolio} />
          {/* Keyed by organization + window so the Amount/Share choice resets
              on either change; directory filtering never remounts this. */}
          <ChannelPortfolioChart
            key={`${organizationId}::${selected.value}`}
            portfolio={portfolio}
            selectedWindow={selected}
            onInspectChannel={(channelId) => {
              setInspectedChannelId(channelId);
              setCoverageOpen(true);
            }}
            coverageRail={
              <ChannelCoverageRail
                portfolio={portfolio}
                onReview={() => {
                  setInspectedChannelId(null);
                  setCoverageOpen(true);
                }}
              />
            }
            explanationStrip={<ComparisonExplanationStrip portfolio={portfolio} />}
          />
          <ChannelCoverageDialog
            organizationId={organizationId}
            portfolio={portfolio}
            selectedWindow={selected}
            open={coverageOpen}
            onOpenChange={(open) => {
              setCoverageOpen(open);
              if (!open) setInspectedChannelId(null);
            }}
            focusedChannelId={inspectedChannelId}
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Choose a reporting window.</p>
      )}

      {selected ? (
        <ReportingWindowDialog
          open={infoOpen}
          onOpenChange={setInfoOpen}
          selected={selected}
          scopeCaption={scopeCaptionFor(portfolio)}
        />
      ) : null}
    </section>
  );
}

/**
 * One coherent analysis state for the landing, owned by the page. Disabled
 * renders nothing (the gate hides toolbar and portfolio); an unavailable read
 * renders a safe retry that refreshes this page without starting analysis;
 * ready renders the window toolbar over the current figures.
 */
export function ChannelsRollup({
  organizationId,
  analysis,
}: {
  organizationId: string;
  analysis: ChannelsLandingAnalysis;
}) {
  if (analysis.state === "disabled") return null;
  if (analysis.state === "unavailable") return <UnavailableRollup />;
  return <ReadyRollup organizationId={organizationId} view={analysis.view} />;
}
