"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, XAxis, YAxis } from "recharts";

import { formatMoney } from "@/components/analysis/format";
import styles from "@/components/channels/channels-landing.module.css";
import type { ChannelsPortfolioPresentation } from "@/components/channels/channels-presentation";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type {
  ChannelsOverviewRow,
  ChannelsOverviewWindow,
} from "@/modules/analysis/application/channels-overview";

/**
 * Task 3 — horizontal stacked revenue comparison (visual contract V04).
 *
 * One shared scale, one display mode at a time. The chart owns the
 * Amount/Share toggle only; the inspected-channel dialog lives in
 * ChannelsRollup (`inspectedChannelId`) so keyboard/touch inspection shows the
 * same band details without a second evidence model. Bars are decorative
 * (`aria-hidden` plot): every row's accessible name carries the full figures,
 * so color is never the only encoding. Zero values render zero width — no
 * minimum-bar invention.
 */

const ROW_HEIGHT = 49;
const ROW_HEIGHT_NARROW = 45;
const AXIS_HEIGHT = 24;
const NARROW_QUERY = "(max-width: 650px)";

/**
 * The content breakpoint is an explicit 650px media query (never Tailwind's
 * sm). Row bands must match the CSS row height exactly, or names drift off
 * their bars — so the chart reads the same query the stylesheet uses.
 */
function useNarrowPlot(): boolean {
  const read = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(NARROW_QUERY).matches;
  const [narrow, setNarrow] = useState(read);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

const comparisonConfig = {
  earned: {
    label: "Earned",
    color: "var(--channel-earned)",
  },
  lost: {
    label: "Reported loss",
    color: "var(--channel-loss)",
  },
  reported: {
    label: "Revenue only",
    color: "var(--channel-reported)",
  },
} satisfies ChartConfig;

export type ComparisonDisplayMode = "amount" | "share";

export type ComparisonRow = {
  channelId: string;
  name: string;
  state: ChannelsOverviewRow["band"]["state"];
  reportedMinor: number | null;
  earnedMinor: number | null;
  lostMinor: number | null;
  /** Original per-channel currency; null only when the band states no figure. */
  currency: string | null;
};

export type AmountScale = {
  /** Shared domain in minor units, for Recharts. */
  domain: [number, number];
  /** Evenly spaced ticks in minor units, for Recharts. */
  ticks: number[];
};

/** Currency exponent from Intl, never a hand-kept table (JPY 0, BHD 3). */
export function currencyMinorExponent(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/**
 * Whole major units for headline/end-label visuals only (`138,000`).
 * Detail surfaces (tooltips, dialogs, accessible names) always use the exact
 * `formatMoney` figure with the currency's own exponent.
 */
export function formatWholeMajorUnits(minorUnits: number, currency: string): string {
  const exponent = currencyMinorExponent(currency);
  return new Intl.NumberFormat("en-AE", { maximumFractionDigits: 0 }).format(
    minorUnits / 10 ** exponent,
  );
}

function trimNumber(value: number): string {
  return String(Number(value.toFixed(6)));
}

/** Compact axis tick in major units: `0`, `20k`, `2.5M`. */
export function formatMajorTick(majorUnits: number): string {
  if (majorUnits === 0) return "0";
  const abs = Math.abs(majorUnits);
  if (abs >= 1_000_000) return `${trimNumber(majorUnits / 1_000_000)}M`;
  if (abs >= 1_000) return `${trimNumber(majorUnits / 1_000)}k`;
  return trimNumber(majorUnits);
}

/** One-decimal share endpoint: `58.0%`. */
export function formatShareValue(percent: number): string {
  return `${percent.toFixed(1)}%`;
}

/**
 * Amount domain in major units, then converted back to minor units for
 * Recharts. The step is the deterministic 1/2/5×10^n choice with four
 * intervals, so the AED 80,000 reference maximum yields domain 0–80,000 with
 * 20k ticks. Signed minima extend the domain below zero instead of clamping
 * negatives into positive bars.
 */
export function computeAmountScale(
  minMinor: number | null,
  maxMinor: number | null,
  currency: string,
): AmountScale {
  const exponent = currencyMinorExponent(currency);
  const factor = 10 ** exponent;
  const loMajor = Math.min(0, minMinor ?? 0) / factor;
  const hiMajor = Math.max(0, maxMinor ?? 0) / factor;
  const toMinor = (major: number) => Math.round(major * factor);
  if (hiMajor <= 0 && loMajor >= 0) {
    // Genuine all-zero input: zero-width bars on a 0–1-major axis. No nonzero
    // minimum bar is invented; the rows read `0` with exact zero detail.
    return { domain: [0, factor], ticks: [0] };
  }
  const rawStep = (hiMajor - loMajor) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const niceLo = Math.floor(loMajor / step) * step;
  const niceHi = Math.ceil(hiMajor / step) * step;
  const ticks: number[] = [];
  for (let major = niceLo; major <= niceHi + step / 2; major += step) {
    ticks.push(toMinor(major));
  }
  return { domain: [toMinor(niceLo), toMinor(niceHi)], ticks };
}

/**
 * Chart order: descending reported amount, unknown amounts last, ties by
 * display name then channel ID. Directory filters/sort never change this.
 */
export function sortComparisonRows(rows: readonly ChannelsOverviewRow[]): ComparisonRow[] {
  return rows
    .map((row) => ({
      channelId: row.channelId,
      name: row.displayName,
      state: row.band.state,
      reportedMinor: row.band.potential?.minorUnits ?? null,
      earnedMinor: row.band.state === "complete" ? (row.band.earned?.minorUnits ?? null) : null,
      lostMinor: row.band.state === "complete" ? (row.band.lost?.minorUnits ?? null) : null,
      currency:
        row.band.potential?.currency ??
        row.band.earned?.currency ??
        row.band.lost?.currency ??
        null,
    }))
    .sort((left, right) => {
      if (left.reportedMinor === null && right.reportedMinor === null) {
        return left.name.localeCompare(right.name) || left.channelId.localeCompare(right.channelId);
      }
      if (left.reportedMinor === null) return 1;
      if (right.reportedMinor === null) return -1;
      return (
        right.reportedMinor - left.reportedMinor ||
        left.name.localeCompare(right.name) ||
        left.channelId.localeCompare(right.channelId)
      );
    });
}

/**
 * Full UTC-safe range for tooltips and accessible names
 * (`1 February 2026 – 28 February 2026`). Never a truncated month label, so a
 * March month/span pair stays unambiguous.
 */
export function formatComparisonPeriod(window: ChannelsOverviewWindow): string {
  const months = [
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
  const parts = (date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    return `${day} ${months[(month ?? 1) - 1]} ${year}`;
  };
  return `${parts(window.windowStart)} – ${parts(window.windowEnd)}`;
}

/**
 * The exact-value sentence behind each row: tooltip, dialog and accessible
 * name all read from this one description so retiring the doughnut/top-four
 * layouts loses no per-channel information.
 */
export function describeComparisonRow(row: ComparisonRow, period: string): string {
  if (row.reportedMinor === null || row.currency === null) {
    return `${row.name}: No comparable revenue figure for this window. ${period}.`;
  }
  const reported = formatMoney(row.reportedMinor, row.currency);
  const earned =
    row.earnedMinor === null || row.currency === null
      ? "not recorded"
      : formatMoney(row.earnedMinor, row.currency);
  const lost =
    row.lostMinor === null || row.currency === null
      ? "not recorded"
      : formatMoney(row.lostMinor, row.currency);
  return `${row.name}: reported revenue ${reported}, earned ${earned}, reported loss ${lost}. ${period}.`;
}

export function ChannelComparisonTooltip({
  active,
  payload,
  period,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: ComparisonRow }>;
  period: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0]?.payload;
  if (!datum) return null;
  return (
    <div className={`${styles.theme} rounded-lg border bg-popover px-3 py-2 text-xs shadow-md`}>
      <p className="font-semibold text-popover-foreground">{datum.name}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{period}</p>
      {datum.reportedMinor === null || datum.currency === null ? (
        <p className="mt-1.5 text-muted-foreground">
          No comparable revenue figure for this window.
        </p>
      ) : (
        <dl className="mt-1.5 grid gap-0.5">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Reported revenue</dt>
            <dd className="font-medium tabular-nums">
              {formatMoney(datum.reportedMinor, datum.currency)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Earned</dt>
            <dd className="font-medium tabular-nums">
              {datum.earnedMinor === null
                ? "Not recorded"
                : formatMoney(datum.earnedMinor, datum.currency)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Reported loss</dt>
            <dd className="font-medium tabular-nums">
              {datum.lostMinor === null
                ? "Not recorded"
                : formatMoney(datum.lostMinor, datum.currency)}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}

type ChartDatum = ComparisonRow & {
  earnedBar: number;
  lostBar: number;
  reportedBar: number;
  earnedShare: number;
  lostShare: number;
  reportedShare: number;
};

function toChartData(rows: readonly ComparisonRow[], totalMinor: number | null): ChartDatum[] {
  return rows.map((row) => ({
    ...row,
    earnedBar: row.earnedMinor ?? 0,
    lostBar: row.lostMinor ?? 0,
    reportedBar: row.state === "revenue_only" ? (row.reportedMinor ?? 0) : 0,
    earnedShare: row.earnedMinor !== null && totalMinor ? (row.earnedMinor / totalMinor) * 100 : 0,
    lostShare: row.lostMinor !== null && totalMinor ? (row.lostMinor / totalMinor) * 100 : 0,
    reportedShare:
      row.state === "revenue_only" && row.reportedMinor !== null && totalMinor
        ? (row.reportedMinor / totalMinor) * 100
        : 0,
  }));
}

/**
 * The V04 comparison Card: header with Amount/Share toggle, legend, one
 * horizontal stacked plot with outer label/value gutters, axis, refusal
 * states and the earned-definition footer. Task 4 appends the coverage rail
 * beside the plot inside this same Card.
 */
export function ChannelPortfolioChart({
  portfolio,
  selectedWindow,
  onInspectChannel,
}: {
  portfolio: ChannelsPortfolioPresentation;
  selectedWindow: ChannelsOverviewWindow | null;
  onInspectChannel: (channelId: string) => void;
}) {
  const [mode, setMode] = useState<ComparisonDisplayMode>("amount");
  const [reducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const rows = sortComparisonRows(portfolio.rows);
  const currency = portfolio.comparisonCurrency;
  const totalMinor = portfolio.reportedTotal?.minorUnits ?? null;
  const period = selectedWindow ? formatComparisonPeriod(selectedWindow) : "";

  // Share needs a nonzero unsigned total in one currency. Mixed/unusable
  // totals disable the Share choice; signed/zero totals keep it selectable so
  // the honest refusal is visible instead of a silent dead control.
  const shareDisabled = currency === null;
  const shareReady = !shareDisabled && totalMinor !== null && portfolio.comparisonReason === null;
  const showShare = mode === "share" && shareReady;

  const reportedMinors = rows
    .map((row) => row.reportedMinor)
    .filter((value): value is number => value !== null);
  const scale =
    currency === null
      ? null
      : computeAmountScale(
          reportedMinors.length > 0 ? Math.min(...reportedMinors) : null,
          reportedMinors.length > 0 ? Math.max(...reportedMinors) : null,
          currency,
        );
  const exponent = currency === null ? 2 : currencyMinorExponent(currency);
  const factor = 10 ** exponent;

  const data = toChartData(rows, totalMinor);
  const rowHeight = useNarrowPlot() ? ROW_HEIGHT_NARROW : ROW_HEIGHT;
  const chartHeight = rows.length * rowHeight + AXIS_HEIGHT;

  const onModeChange = (value: string) => {
    // Single-select must not clear: clicking the active choice keeps it.
    if (value === "amount" || value === "share") setMode(value);
  };

  const barsVisible = currency !== null && rows.length > 0 && (mode === "amount" || shareReady);

  return (
    <Card
      role="region"
      aria-label="Revenue comparison"
      className="gap-0 overflow-hidden rounded-xl border border-border bg-card py-0 ring-0"
    >
      <CardHeader className="flex flex-row items-start justify-between gap-2.5 px-[25px] pt-[23px] max-[1200px]:px-[18px] max-[1200px]:pt-[22px] max-[650px]:flex-col max-[650px]:px-4 max-[650px]:pt-5">
        <div className="grid gap-1">
          <CardTitle className="text-[17px] font-bold tracking-[-0.5px] max-[650px]:text-base">
            Revenue by channel
          </CardTitle>
          <CardDescription className="mt-1.5 text-[11px] leading-[1.6] max-[650px]:text-[10px]">
            A shared scale. A clearer view of your channel mix.
          </CardDescription>
        </div>
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={onModeChange}
          aria-label="Comparison display"
          className="shrink-0 rounded-[7px] border border-border bg-muted p-[3px]"
        >
          <ToggleGroupItem
            value="amount"
            aria-label="Show amounts"
            className="rounded px-[9px] py-[5px] text-[10px] font-medium text-muted-foreground data-[state=on]:bg-white data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=on]:shadow-[0_1px_3px_#00000012] max-[1200px]:px-1.5"
          >
            Amount
          </ToggleGroupItem>
          <ToggleGroupItem
            value="share"
            aria-label="Show shares"
            disabled={shareDisabled}
            className="rounded px-[9px] py-[5px] text-[10px] font-medium text-muted-foreground data-[state=on]:bg-white data-[state=on]:font-bold data-[state=on]:text-foreground data-[state=on]:shadow-[0_1px_3px_#00000012] max-[1200px]:px-1.5"
          >
            Share
          </ToggleGroupItem>
        </ToggleGroup>
      </CardHeader>

      <CardContent className="px-[25px] pt-0 pb-[15px] max-[1200px]:px-[18px] max-[1200px]:pb-4 max-[650px]:px-4">
        {barsVisible ? (
          <div className="mt-[22px] mb-[9px] flex flex-wrap gap-x-[17px] gap-y-2 text-[10px] text-muted-foreground max-[650px]:gap-x-2.5 max-[650px]:text-[9px]">
            <span className="flex items-center">
              <span
                aria-hidden="true"
                className="mr-[5px] inline-block size-[7px] rounded-[2px] bg-(--channel-earned)"
              />
              Earned
            </span>
            <span className="flex items-center">
              <span
                aria-hidden="true"
                className="mr-[5px] inline-block size-[7px] rounded-[2px] bg-(--channel-loss)"
              />
              Reported loss
            </span>
            <span className="flex items-center">
              <span
                aria-hidden="true"
                className="mr-[5px] inline-block size-[7px] rounded-[2px] bg-(--channel-reported)"
              />
              Revenue only
            </span>
          </div>
        ) : null}

        {rows.length === 0 ? (
          <p className="mt-[22px] text-sm leading-relaxed text-muted-foreground">
            No active channels to compare.
          </p>
        ) : currency === null || scale === null ? (
          <div className="mt-[22px] grid gap-3">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {portfolio.comparisonReason ?? "Revenue cannot be compared across currencies."}
            </p>
            <ul aria-label="Channel figures in original currencies" className="grid gap-2">
              {rows.map((row) => (
                <li
                  key={row.channelId}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-sm"
                >
                  <button
                    type="button"
                    onClick={() => onInspectChannel(row.channelId)}
                    aria-label={`${describeComparisonRow(row, period)} Show band details.`}
                    className="min-w-0 truncate text-left text-[11px] font-semibold"
                  >
                    {row.name}
                  </button>
                  <span className="text-xs font-semibold tabular-nums">
                    {row.reportedMinor !== null && row.currency !== null ? (
                      <>
                        <span className="mr-1 text-[10px] font-medium text-muted-foreground">
                          {row.currency}
                        </span>
                        {formatWholeMajorUnits(row.reportedMinor, row.currency)}
                      </>
                    ) : (
                      <span className="text-muted-foreground">No comparable figure</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : mode === "share" && !shareReady ? (
          <div className="mt-[22px] grid gap-3">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {portfolio.comparisonReason ??
                "No proportional comparison is available for zero reported revenue."}
            </p>
            <ul aria-label="Channel reported revenue" className="grid gap-2">
              {rows.map((row) => (
                <li
                  key={row.channelId}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-sm"
                >
                  <button
                    type="button"
                    onClick={() => onInspectChannel(row.channelId)}
                    aria-label={`${describeComparisonRow(row, period)} Show band details.`}
                    className="min-w-0 truncate text-left text-[11px] font-semibold"
                  >
                    {row.name}
                  </button>
                  <span aria-hidden="true" className="text-[11px] font-semibold tabular-nums">
                    {row.reportedMinor === null ? (
                      <span className="font-normal text-muted-foreground">—</span>
                    ) : (
                      formatWholeMajorUnits(row.reportedMinor, currency)
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className={styles.compareGrid}>
            <div className={styles.compareNames}>
              {rows.map((row) => (
                <div key={row.channelId} className={styles.compareCell}>
                  <button
                    type="button"
                    onClick={() => onInspectChannel(row.channelId)}
                    aria-label={`${describeComparisonRow(row, period)} Show band details.`}
                    title={row.name}
                    className={styles.compareNameButton}
                  >
                    {row.name}
                  </button>
                </div>
              ))}
            </div>
            <div aria-hidden="true" className={styles.comparePlot}>
              <ChartContainer
                config={comparisonConfig}
                className="aspect-auto w-full"
                style={{ height: chartHeight }}
              >
                <BarChart
                  accessibilityLayer
                  data={data}
                  layout="vertical"
                  margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                >
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={false}
                    tickLine={false}
                    axisLine={false}
                    width={0}
                  />
                  {showShare ? (
                    <XAxis
                      type="number"
                      domain={[0, 100]}
                      ticks={[0, 25, 50, 75, 100]}
                      tickFormatter={(value: number) => `${value}%`}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 9 }}
                      tickMargin={6}
                      height={AXIS_HEIGHT}
                      interval={0}
                    />
                  ) : (
                    <XAxis
                      type="number"
                      domain={scale.domain}
                      ticks={scale.ticks}
                      tickFormatter={(value: number) => formatMajorTick(Number(value) / factor)}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 9 }}
                      tickMargin={6}
                      height={AXIS_HEIGHT}
                      interval={0}
                    />
                  )}
                  <ChartTooltip
                    cursor={{ fill: "var(--channel-soft)", opacity: 0.7 }}
                    content={<ChannelComparisonTooltip period={period} />}
                  />
                  <Bar
                    dataKey={showShare ? "earnedShare" : "earnedBar"}
                    stackId="revenue"
                    fill="var(--color-earned)"
                    barSize={17}
                    radius={[3, 0, 0, 3]}
                    background={{ fill: "var(--channel-soft)" }}
                    isAnimationActive={!reducedMotion}
                  />
                  <Bar
                    dataKey={showShare ? "lostShare" : "lostBar"}
                    stackId="revenue"
                    fill="var(--color-lost)"
                    barSize={17}
                    radius={[0, 3, 3, 0]}
                    background={{ fill: "var(--channel-soft)" }}
                    isAnimationActive={!reducedMotion}
                  />
                  <Bar
                    dataKey={showShare ? "reportedShare" : "reportedBar"}
                    stackId="revenue"
                    fill="var(--color-reported)"
                    barSize={17}
                    radius={[3, 3, 3, 3]}
                    background={{ fill: "var(--channel-soft)" }}
                    isAnimationActive={!reducedMotion}
                  />
                </BarChart>
              </ChartContainer>
              {rows.map((row, index) =>
                row.state === "refused" ? (
                  <div
                    key={row.channelId}
                    aria-hidden="true"
                    className={styles.compareNoFigure}
                    style={{ top: index * rowHeight, height: rowHeight }}
                  >
                    No comparable figure
                  </div>
                ) : null,
              )}
            </div>
            <div aria-hidden="true" className={styles.compareValues}>
              {rows.map((row) =>
                row.state === "refused" || row.reportedMinor === null ? (
                  <div key={row.channelId} className={styles.compareCell}>
                    <span className={styles.compareDash}>—</span>
                  </div>
                ) : showShare && totalMinor ? (
                  <div key={row.channelId} className={styles.compareCell}>
                    <span className={styles.compareEndValue}>
                      {formatShareValue((row.reportedMinor / totalMinor) * 100)}
                    </span>
                  </div>
                ) : (
                  <div key={row.channelId} className={styles.compareCell}>
                    <span className={styles.compareEndValue}>
                      {formatWholeMajorUnits(row.reportedMinor, currency)}
                    </span>
                  </div>
                ),
              )}
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter className="mt-5 block border-t border-border bg-transparent px-[25px] pt-[13px] pb-[15px] text-[11px] leading-[1.6] text-muted-foreground max-[1200px]:px-[18px] max-[650px]:px-4">
        Earned = reported revenue minus provider-reported loss. These figures are not profit.
      </CardFooter>
    </Card>
  );
}
