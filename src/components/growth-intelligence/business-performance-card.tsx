"use client";

import { ArrowRight, ArrowUpRight, Info } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import { formatCount, formatWholeMoney } from "@/components/analysis/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  prettyRange,
  type BusinessPerformanceCardView,
  type PerformanceCardTile,
} from "@/modules/analysis/application/channels-overview";

/**
 * The y-axis top for the trend: the data max lifted a tenth, then rounded up
 * into a 1/2/2.5/4/5 series so the ticks always read round -- 36,000 plots
 * against 0/20,000/40,000, exactly like the prototype.
 */
function roundScaleTop(dataMax: number): number {
  if (!(dataMax > 0)) return 1;
  const raw = dataMax * 1.1;
  const exponent = 10 ** Math.floor(Math.log10(raw));
  const series = [1, 2, 2.5, 4, 5, 10];
  const step = series.find((candidate) => candidate * exponent >= raw) ?? 10;
  return step * exponent;
}

/**
 * Light distinct hues, one per channel, so the pie never reads as shades of
 * one colour. Rank order matches the legend below it.
 */
const SHARE_PIE_PALETTE = [
  "#A7E5C4",
  "#FDE68A",
  "#BFDBFE",
  "#DDD6FE",
  "#FBCFE8",
  "#FED7AA",
  "#BAE6FD",
  "#C7D2FE",
];

function deltaText(tile: PerformanceCardTile): string | null {
  if (tile.deltaPercent === null || tile.deltaLabel === null) return null;
  const sign = tile.deltaPercent > 0 ? "+" : "";
  return `${sign}${tile.deltaPercent}% ${tile.deltaLabel}`;
}

function Tile({ tile, tone }: { tile: PerformanceCardTile; tone?: "danger" }) {
  return (
    <div className="flex min-w-0 flex-col">
      <p className="text-[13px] font-semibold text-muted-foreground">
        {tile.id === "sales"
          ? "Reported sales"
          : tile.id === "orders"
            ? "Orders placed"
            : tile.id === "views"
              ? "Menu views"
              : "Cancelled orders"}
      </p>
      {tile.value ? (
        <p
          className={`mt-2 text-[27px] font-extrabold leading-none tabular-nums sm:text-[34px] ${tone === "danger" ? "text-destructive" : ""}`}
        >
          {tile.value.kind === "money"
            ? formatWholeMoney(tile.value.money.minorUnits, tile.value.money.currency)
            : formatCount(tile.value.value)}
        </p>
      ) : (
        <p className="text-lg font-medium text-muted-foreground">Not reported</p>
      )}
      {tile.value && deltaText(tile) ? (
        <p
          className={`mt-3 text-xs font-semibold tabular-nums ${tile.deltaPercent !== null && tile.deltaPercent > 0 ? "text-primary" : "text-muted-foreground"}`}
        >
          {deltaText(tile)}
        </p>
      ) : null}
      {tile.value && !deltaText(tile) && tile.deltaAbsentReason ? (
        <p className="mt-3 text-xs font-semibold text-muted-foreground">{tile.deltaAbsentReason}</p>
      ) : null}
      {!tile.value && tile.unavailableReason ? (
        <p className="mt-1 text-xs text-muted-foreground">{tile.unavailableReason}</p>
      ) : null}
      {tile.footnote ? <p className="mt-1 text-xs text-muted-foreground">{tile.footnote}</p> : null}
    </div>
  );
}

/**
 * Which of a crowded axis' labels stay readable: the first of each group
 * plus the last, so the latest point is always named. Six or fewer labels
 * all stay -- the February card renders byte-identically.
 */
export function visibleTickIndexes(total: number, maxLabels = 6): boolean[] {
  if (total <= maxLabels) return Array.from({ length: total }, () => true);
  const step = Math.ceil(total / maxLabels);
  return Array.from({ length: total }, (_, index) => index % step === 0 || index === total - 1);
}

/**
 * Which bars keep their on-top value label: thirty-one or fewer keeps
 * every label, past that every nth plus the latest -- the same first-plus-
 * latest rule as the axis, with a wider budget for small numerals.
 */
export const MAX_BAR_LABELS = 31;

export function visibleBarLabelIndexes(total: number): boolean[] {
  return visibleTickIndexes(total, MAX_BAR_LABELS);
}

/**
 * Five round y-axis ticks -- zero plus quarters of the existing rounded
 * top -- so the grid grows from [0, mid, top] without changing the top.
 */
export function trendYAxisTicks(dataMax: number): number[] {
  const top = roundScaleTop(dataMax);
  return [0, top / 4, top / 2, (top * 3) / 4, top];
}

function TrendChart({ card }: { card: BusinessPerformanceCardView }) {
  if (card.trend.state === "empty") {
    // The axes keep their shape while the plot stays empty: week labels
    // along the bottom, a zero baseline, and the plain reason in the middle
    // where the line would be.
    const visible = visibleTickIndexes(card.trend.weeks.length);
    return (
      <div
        role="img"
        aria-label={`Sales trend unavailable: ${card.trend.reason}`}
        className="relative h-64 rounded-lg border border-dashed p-4 pb-10"
      >
        <div className="flex h-full flex-col justify-between" aria-hidden="true">
          {[0, 1, 2].map((line) => (
            <div key={line} className="border-t border-dashed border-border" />
          ))}
        </div>
        <p className="absolute inset-x-8 top-1/2 -translate-y-1/2 text-center text-sm text-muted-foreground">
          {card.trend.reason}
        </p>
        <div
          className="absolute inset-x-4 bottom-3 flex items-start justify-between gap-2 text-xs text-muted-foreground"
          aria-hidden="true"
        >
          {card.trend.weeks.map((week, index) =>
            visible[index] === true ? <span key={week}>{week}</span> : null,
          )}
        </div>
      </div>
    );
  }

  // The plot speaks whole currency units, like the prototype's "24,000":
  // minor units would print "2,400,000" on every label and tick.
  const group = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
  const exponent =
    new Intl.NumberFormat("en", {
      style: "currency",
      currency: card.trend.state === "ready" ? card.trend.currency : "AED",
    }).resolvedOptions().maximumFractionDigits ?? 2;
  const points =
    card.trend.state === "ready"
      ? card.trend.buckets.map((bucket) => ({
          label: bucket.label,
          value: bucket.minorUnits / 10 ** exponent,
        }))
      : [];
  // Whatever buckets arrive plot -- daily now, gaps stay absent with no
  // zero-fill -- with a wider axis-label budget: up to ten labels (always
  // the latest) while every bar stays plotted and named for assistive tech
  // above. Every bar also carries its whole-unit total on top, thinning to
  // every nth plus the latest past thirty-one bars. A crowded chart earns a
  // wider right margin so the latest point -- always named -- never clips
  // off the edge.
  const crowded = points.length > 8;
  const visible = visibleTickIndexes(points.length, 10);
  const labelVisible = visibleBarLabelIndexes(points.length);
  const dataMax = Math.max(...points.map((point) => point.value));
  const scaleTop = roundScaleTop(dataMax);
  const yTicks = trendYAxisTicks(dataMax);
  return (
    <div
      className="h-55 w-full"
      role="img"
      aria-label={`Weekly reported sales: ${points.map((point) => `${point.label} ${group.format(point.value)}`).join(", ")}. ${card.trend.state === "ready" ? card.trend.coverageNote : ""}.`}
    >
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={points} margin={{ top: 20, right: crowded ? 28 : 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 5" stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            tickMargin={8}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickFormatter={(value: string, index: number) => (visible[index] === true ? value : "")}
            interval={0}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={56}
            domain={[0, scaleTop]}
            ticks={yTicks}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickFormatter={(value: number) => group.format(value)}
          />
          <Bar
            dataKey="value"
            name="Reported sales"
            fill="var(--primary)"
            radius={[6, 6, 0, 0]}
            maxBarSize={8}
          >
            <LabelList
              position="top"
              fontSize={11}
              fill="var(--muted-foreground)"
              style={{ fontVariantNumeric: "tabular-nums" }}
              valueAccessor={(entry, index) => {
                if (labelVisible[index] !== true) return undefined;
                return typeof entry.value === "number" ? group.format(entry.value) : undefined;
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function DataSourcesDialog({ card }: { card: BusinessPerformanceCardView }) {
  const sections = [
    ["Reporting period", card.sources.reportingPeriod],
    ["Selected scope", card.sources.scope],
    ["Sales and orders", card.sources.salesOrdersNote],
    ["Menu views", card.sources.menuViewsNote],
    ["Cost and profit context", card.sources.costNote],
  ] as const;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="link" className="h-auto gap-1 p-0 font-semibold">
          View data sources
          <ArrowUpRight aria-hidden="true" className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Where these figures come from</DialogTitle>
        </DialogHeader>
        <dl className="flex flex-col gap-4">
          {sections.map(([term, detail]) => (
            <div key={term} className="flex flex-col gap-1">
              <dt className="text-sm font-bold">{term}</dt>
              <dd className="text-sm leading-relaxed text-muted-foreground">{detail}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

function FulfillmentDialog({ card }: { card: BusinessPerformanceCardView }) {
  const share = card.cancelledShare !== null ? ` ${card.cancelledShare.percent}%` : "";
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="link" className="h-auto gap-1 p-0 font-semibold">
          Order &amp; fulfillment details
          <ArrowRight aria-hidden="true" className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Orders &amp; fulfillment</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {`${prettyRange(card.month.from, card.month.to)} · ${card.sources.scope}`}
        </p>
        <div className="mt-5 grid grid-cols-2 gap-4">
          <div className="rounded-lg bg-muted p-4">
            <p className="text-xs text-muted-foreground">Orders placed</p>
            <p className="mt-2 text-2xl font-bold tabular-nums">
              {card.fulfillment.ordersPlaced !== null
                ? formatCount(card.fulfillment.ordersPlaced)
                : "Not reported"}
            </p>
            {card.fulfillment.ordersPlaced === null ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {card.fulfillment.ordersAbsentReason}
              </p>
            ) : null}
          </div>
          <div className="rounded-lg bg-muted p-4">
            <p className="text-xs text-muted-foreground">Cancelled orders</p>
            <p className="mt-2 text-2xl font-bold tabular-nums">
              {card.fulfillment.cancelled !== null
                ? `${formatCount(card.fulfillment.cancelled)}`
                : "Not reported"}
              {card.fulfillment.cancelled !== null && share ? (
                <span className="ml-1 text-sm font-normal text-muted-foreground">{share}</span>
              ) : null}
            </p>
            {card.fulfillment.cancelled === null ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {card.fulfillment.cancelledAbsentReason}
              </p>
            ) : null}
          </div>
        </div>
        <h3 className="mt-6 text-sm font-bold">Delivery completion and delivery time</h3>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          These details weren&apos;t supplied in the current reports. Add a fulfillment report to
          include them in this view.
        </p>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          Order totals and cancellations alone do not establish which orders were delivered.
        </p>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The Overview performance card, matching the approved prototype: a tinted
 * header with the rule-composed headline and four tiles, a trend-plus-shares
 * row, and a footer carrying coverage into the fulfillment modal.
 *
 * Presentational: every figure arrives in `card`, computed by
 * `buildBusinessPerformanceCard` from governed findings.
 */
export function BusinessPerformanceCard({ card }: { card: BusinessPerformanceCardView }) {
  const compared =
    card.tiles.sales.deltaPercent !== null
      ? ` · compared with ${prettyRange(card.previous.from, card.previous.to)}`
      : "";
  const cancelled = card.tiles.cancelled;
  // The cancelled tile moves with its share of orders rather than a
  // standalone delta: the point change beside it is the comparison.
  const silentCancelled: PerformanceCardTile = {
    ...cancelled,
    footnote: null,
    deltaPercent: null,
    deltaLabel: null,
    deltaAbsentReason: null,
  };
  const share = card.cancelledShare;
  const shareLine =
    share !== null && cancelled.value
      ? `${share.percent}% of orders${share.pointChange === null || cancelled.deltaLabel === null ? "" : share.pointChange === 0 ? " · unchanged" : ` · ${share.pointChange > 0 ? "+" : ""}${share.pointChange} pts ${cancelled.deltaLabel}`}`
      : null;

  return (
    <Card
      className="gap-0 overflow-hidden rounded-2xl py-0"
      data-testid="business-performance-card"
    >
      <div className="flex flex-col gap-5 bg-primary/5 px-5 pt-5 pb-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
            Business performance
          </p>
          <DataSourcesDialog card={card} />
        </div>
        <div className="flex flex-col gap-2">
          <h2 className="text-xl leading-snug font-bold tracking-tight sm:text-[26px]">
            {card.headline}
          </h2>
          <p className="text-[13px] text-muted-foreground">
            {`${prettyRange(card.month.from, card.month.to)}${compared} · ${card.sources.scope}`}
          </p>
        </div>
        <div className="mt-1 grid grid-cols-2 gap-x-5 gap-y-6 lg:grid-cols-4">
          <Tile tile={card.tiles.sales} />
          <Tile tile={card.tiles.orders} />
          <Tile tile={card.tiles.views} />
          <div className="flex min-w-0 flex-col gap-1">
            <Tile tile={silentCancelled} tone="danger" />
            {shareLine ? (
              <p className="text-xs text-muted-foreground tabular-nums">{shareLine}</p>
            ) : null}
            {cancelled.footnote ? (
              <p className="text-xs text-muted-foreground">{cancelled.footnote}</p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1.5fr)_auto_minmax(0,1fr)]">
        <section aria-label="How sales changed" className="flex min-w-0 flex-col gap-4 p-5 sm:p-7">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">How sales changed</h3>
            {card.trend.state === "ready" ? (
              <p className="text-xs text-muted-foreground tabular-nums">
                {`Reported sales · ${card.trend.currency}`}
              </p>
            ) : null}
          </div>
          <TrendChart card={card} />
          {card.trend.state === "ready" ? (
            <p className="text-xs text-muted-foreground">{card.trend.coverageNote}</p>
          ) : null}
        </section>
        <Separator className="hidden h-full lg:block" orientation="vertical" />
        <Separator className="lg:hidden" />
        <section
          aria-label="Where sales came from"
          className="flex min-w-0 flex-col gap-4 p-5 sm:p-7"
        >
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold">Where sales came from</h3>
            <p className="text-xs text-muted-foreground">Share of sales in this reporting period</p>
          </div>
          {card.shares ? (
            <div className="flex flex-col gap-4">
              <div
                className="h-55 w-full"
                role="img"
                aria-label={`Channel shares: ${card.shares.rows.map((row) => `${row.displayName} ${row.sharePercent}%`).join(", ")}`}
              >
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={card.shares.rows.map((row) => ({
                        name: row.displayName,
                        value: row.minorUnits,
                        channelId: row.channelId,
                      }))}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={3}
                      stroke="var(--card)"
                      strokeWidth={2}
                    >
                      {card.shares.rows.map((row, index) => (
                        <Cell
                          key={row.channelId}
                          fill={SHARE_PIE_PALETTE[index % SHARE_PIE_PALETTE.length]}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="flex flex-col gap-2.5">
                {card.shares.rows.map((row, index) => (
                  <li
                    key={row.channelId}
                    className="flex items-center justify-between gap-3 text-[13px]"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="size-3 shrink-0 rounded-full border"
                        style={{
                          background: SHARE_PIE_PALETTE[index % SHARE_PIE_PALETTE.length],
                          borderColor: "var(--border)",
                        }}
                      />
                      <span className="truncate font-semibold">{row.displayName}</span>
                    </span>
                    <span className="shrink-0 font-bold tabular-nums">
                      {formatWholeMoney(row.minorUnits, row.currency)}{" "}
                      <span className="ml-1 font-normal text-muted-foreground">
                        {row.sharePercent}%
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {card.sharesAbsentReason}
            </p>
          )}
          {card.tiles.sales.footnote ? (
            <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
              <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              Cost data is needed to explain how much of these sales became profit.
            </p>
          ) : null}
        </section>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/40 px-5 py-3 sm:px-6">
        <p className="text-xs text-muted-foreground">{card.footer}</p>
        <FulfillmentDialog card={card} />
      </div>
    </Card>
  );
}
