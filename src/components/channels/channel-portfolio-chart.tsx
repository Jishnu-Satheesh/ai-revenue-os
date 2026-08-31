"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";

import { formatMoney } from "@/components/analysis/format";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Separator } from "@/components/ui/separator";
import type {
  ChannelsOverviewRow,
  ChannelsOverviewView,
} from "@/modules/analysis/application/channels-overview";

const channelColors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

const performanceConfig = {
  earned: {
    label: "Earned",
    color: "var(--chart-2)",
  },
  lost: {
    label: "Provider-reported loss",
    color: "var(--destructive)",
  },
  reported: {
    label: "Revenue reported; loss not recorded",
    color: "var(--chart-4)",
  },
} satisfies ChartConfig;

const mixConfig = {
  reported: {
    label: "Reported revenue",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function compactMoney(minorUnits: number, currency: string): string {
  const formatter = new Intl.NumberFormat("en", { style: "currency", currency });
  const exponent = formatter.resolvedOptions().maximumFractionDigits ?? 2;

  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 0,
  }).format(minorUnits / 10 ** exponent);
}

function moneyLabel(row: ChannelsOverviewRow): string {
  if (row.band.state === "complete" && row.band.potential && row.band.earned && row.band.lost) {
    return `${row.displayName}: ${formatMoney(
      row.band.potential.minorUnits,
      row.band.potential.currency,
    )} potential, ${formatMoney(row.band.earned.minorUnits, row.band.earned.currency)} earned, and ${formatMoney(
      row.band.lost.minorUnits,
      row.band.lost.currency,
    )} lost.`;
  }

  if (row.band.state === "revenue_only" && row.band.potential) {
    return `${row.displayName}: ${formatMoney(
      row.band.potential.minorUnits,
      row.band.potential.currency,
    )} revenue reported; loss not recorded.`;
  }

  return `${row.displayName}: no completed analysis for this window.`;
}

function coverageNote(coverage: ChannelsOverviewView["coverage"]): string {
  const statements = [`Across ${coverage.assessedCount} of ${coverage.channelCount} channels.`];

  if (coverage.revenueOnlyNames.length > 0) {
    statements.push(
      `${listNames(coverage.revenueOnlyNames)} reported revenue but no recorded loss, so ${
        coverage.revenueOnlyNames.length === 1 ? "it is" : "they are"
      } not in the earned total.`,
    );
  }

  if (coverage.unassessedNames.length > 0) {
    statements.push(
      `${listNames(coverage.unassessedNames)} ${
        coverage.unassessedNames.length === 1 ? "has" : "have"
      } no analysis for this window.`,
    );
  }

  return statements.join(" ");
}

export function ChannelPortfolioChart({
  rows,
  total,
  coverage,
  refusalReason,
}: {
  rows: readonly ChannelsOverviewRow[];
  total: ChannelsOverviewView["total"];
  coverage: ChannelsOverviewView["coverage"];
  refusalReason: string | null;
}) {
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [previewChannelId, setPreviewChannelId] = useState<string | null>(null);
  const activeChannelId = previewChannelId ?? selectedChannelId;
  const reportedRows = rows.filter(
    (
      row,
    ): row is ChannelsOverviewRow & {
      band: { potential: NonNullable<typeof row.band.potential> };
    } => row.band.potential !== null,
  );
  const currencies = new Set(reportedRows.map((row) => row.band.potential.currency));
  const [currency] = currencies;
  const reportedTotal = reportedRows.reduce((sum, row) => sum + row.band.potential.minorUnits, 0);
  const canVisualize = currencies.size === 1 && currency !== undefined && reportedTotal > 0;
  const mixRows = reportedRows.map((row, index) => ({
    channelId: row.channelId,
    name: row.displayName,
    reported: row.band.potential.minorUnits,
    currency: row.band.potential.currency,
    share:
      reportedTotal > 0 ? Math.round((row.band.potential.minorUnits / reportedTotal) * 100) : 0,
    color: channelColors[index % channelColors.length],
    state: row.band.state,
    label: moneyLabel(row),
  }));
  const performanceRows = reportedRows.map((row) => ({
    channelId: row.channelId,
    name: row.displayName,
    earned: row.band.state === "complete" ? (row.band.earned?.minorUnits ?? null) : null,
    lost: row.band.state === "complete" ? (row.band.lost?.minorUnits ?? null) : null,
    reported: row.band.state === "revenue_only" ? row.band.potential.minorUnits : null,
  }));
  const lossRows = rows
    .flatMap((row) => {
      if (row.band.state !== "complete" || !row.band.lost) return [];
      return [{ row, lost: row.band.lost }];
    })
    .sort(
      (left, right) =>
        right.lost.minorUnits - left.lost.minorUnits ||
        left.row.displayName.localeCompare(right.row.displayName),
    );
  const totalLostMinorUnits = total.lost?.minorUnits ?? 0;
  const earnedShare =
    total.potential && total.earned && total.potential.minorUnits > 0
      ? (total.earned.minorUnits / total.potential.minorUnits) * 100
      : null;
  const lostShare =
    total.potential && total.lost && total.potential.minorUnits > 0
      ? (total.lost.minorUnits / total.potential.minorUnits) * 100
      : null;

  const setPreview = (channelId: string | null) => setPreviewChannelId(channelId);
  const toggleSelected = (channelId: string) =>
    setSelectedChannelId((current) => (current === channelId ? null : channelId));
  const faded = (channelId: string) => activeChannelId !== null && activeChannelId !== channelId;

  return (
    <div
      className="flex flex-col"
      data-active-channel={activeChannelId ?? ""}
      data-testid="channel-performance-report"
    >
      <div className="grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <section aria-label="Revenue outcome" className="flex min-w-0 flex-col gap-5 p-5 sm:p-7">
          <div className="flex flex-col gap-1">
            <h3 className="font-heading text-sm font-semibold">Revenue outcome</h3>
            <p className="text-xs text-muted-foreground">Complete bands in the selected window</p>
          </div>

          {total.potential ? (
            <div className="flex flex-col gap-4">
              <div>
                <p className="font-mono text-3xl tracking-tight tabular-nums">
                  {formatMoney(total.potential.minorUnits, total.potential.currency)}
                </p>
                <p className="text-xs text-muted-foreground">Potential across complete bands</p>
              </div>

              {earnedShare !== null && lostShare !== null ? (
                <div
                  aria-label={`${earnedShare.toFixed(0)}% earned and ${lostShare.toFixed(0)}% provider-reported loss`}
                  className="flex h-1.5 overflow-hidden rounded-full bg-muted"
                >
                  <span
                    aria-hidden="true"
                    className="h-full bg-(--chart-2)"
                    style={{ width: `${earnedShare}%` }}
                  />
                  <span
                    aria-hidden="true"
                    className="h-full bg-destructive"
                    style={{ width: `${lostShare}%` }}
                  />
                </div>
              ) : null}

              <dl className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <dt className="text-xs text-muted-foreground">Earned</dt>
                  <dd className="font-mono text-lg tabular-nums">
                    {total.earned
                      ? formatMoney(total.earned.minorUnits, total.earned.currency)
                      : "—"}
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs text-muted-foreground">Provider-reported loss</dt>
                  <dd className="font-mono text-lg tabular-nums">
                    {total.lost ? formatMoney(total.lost.minorUnits, total.lost.currency) : "—"}
                  </dd>
                </div>
              </dl>
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">{refusalReason}</p>
          )}
        </section>

        <Separator className="hidden h-full lg:block" orientation="vertical" />
        <Separator className="lg:hidden" />

        <section
          aria-label="Reported revenue mix"
          className="flex min-w-0 flex-col gap-5 p-5 sm:p-7"
        >
          <div className="flex flex-col gap-1">
            <h3 className="font-heading text-sm font-semibold">Reported revenue mix</h3>
            <p className="text-xs text-muted-foreground">
              Share of every channel with a revenue figure
            </p>
          </div>

          {canVisualize ? (
            <div className="grid items-center gap-4 sm:grid-cols-[minmax(10rem,0.8fr)_minmax(0,1fr)]">
              <ChartContainer
                config={mixConfig}
                className="mx-auto h-44 w-full max-w-52 aspect-auto"
                data-testid="reported-revenue-mix-chart"
              >
                <PieChart accessibilityLayer>
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        hideIndicator
                        formatter={(value) => (
                          <span className="font-mono font-medium tabular-nums">
                            {formatMoney(Number(value), currency)}
                          </span>
                        )}
                      />
                    }
                  />
                  <Pie
                    data={mixRows}
                    dataKey="reported"
                    innerRadius={46}
                    nameKey="name"
                    outerRadius={70}
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {mixRows.map((entry) => (
                      <Cell
                        key={entry.channelId}
                        fill={entry.color}
                        fillOpacity={faded(entry.channelId) ? 0.2 : 1}
                        onMouseEnter={() => setPreview(entry.channelId)}
                        onMouseLeave={() => setPreview(null)}
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>

              <ul className="flex min-w-0 flex-col gap-1" aria-label="Reported revenue legend">
                {mixRows.map((entry) => (
                  <li key={entry.channelId}>
                    <Button
                      aria-label={`Focus ${entry.label}`}
                      aria-pressed={activeChannelId === entry.channelId}
                      className="h-auto w-full justify-start px-2 py-2 text-left"
                      onBlur={() => setPreview(null)}
                      onClick={() => toggleSelected(entry.channelId)}
                      onFocus={() => setPreview(entry.channelId)}
                      onMouseEnter={() => setPreview(entry.channelId)}
                      onMouseLeave={() => setPreview(null)}
                      size="sm"
                      variant="ghost"
                    >
                      <span
                        aria-hidden="true"
                        className="size-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: entry.color }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{entry.name}</span>
                        <span className="block truncate font-mono text-xs font-normal tabular-nums text-muted-foreground">
                          {formatMoney(entry.reported, entry.currency)} · {entry.share}%
                          {entry.state === "revenue_only" ? " · loss not recorded" : ""}
                        </span>
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {currencies.size > 1
                ? "Revenue mix cannot be combined because channels reported different currencies."
                : "No channel has a positive reported revenue figure for this window."}
            </p>
          )}
        </section>
      </div>

      <Separator />

      <section
        aria-label="Channel performance chart"
        className="flex min-w-0 flex-col gap-5 p-5 sm:p-7"
      >
        <div className="flex flex-col gap-1">
          <h3 className="font-heading text-sm font-semibold">Performance by channel</h3>
          <p className="text-xs text-muted-foreground">
            Earned and provider-reported loss for this selected reporting window
          </p>
        </div>

        {canVisualize ? (
          <>
            <ChartContainer
              config={performanceConfig}
              className="h-72 w-full aspect-auto"
              data-testid="channel-performance-chart"
            >
              <BarChart accessibilityLayer data={performanceRows} margin={{ left: 4, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={10} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value: number) => compactMoney(value, currency)}
                  width={58}
                />
                <ChartTooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.35 }}
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => (
                        <>
                          <span className="text-muted-foreground">
                            {performanceConfig[String(name) as keyof typeof performanceConfig]
                              ?.label ?? name}
                          </span>
                          <span className="font-mono font-medium tabular-nums">
                            {formatMoney(Number(value), currency)}
                          </span>
                        </>
                      )}
                    />
                  }
                />
                <Bar
                  dataKey="earned"
                  fill="var(--color-earned)"
                  maxBarSize={112}
                  radius={[4, 4, 0, 0]}
                  stackId="revenue"
                >
                  {performanceRows.map((entry) => (
                    <Cell
                      key={entry.channelId}
                      fillOpacity={faded(entry.channelId) ? 0.2 : 1}
                      onMouseEnter={() => setPreview(entry.channelId)}
                      onMouseLeave={() => setPreview(null)}
                    />
                  ))}
                </Bar>
                <Bar
                  dataKey="lost"
                  fill="var(--color-lost)"
                  maxBarSize={112}
                  radius={[4, 4, 0, 0]}
                  stackId="revenue"
                >
                  {performanceRows.map((entry) => (
                    <Cell
                      key={entry.channelId}
                      fillOpacity={faded(entry.channelId) ? 0.2 : 1}
                      onMouseEnter={() => setPreview(entry.channelId)}
                      onMouseLeave={() => setPreview(null)}
                    />
                  ))}
                </Bar>
                <Bar
                  dataKey="reported"
                  fill="var(--color-reported)"
                  maxBarSize={112}
                  radius={[4, 4, 0, 0]}
                  stackId="revenue"
                >
                  {performanceRows.map((entry) => (
                    <Cell
                      key={entry.channelId}
                      fillOpacity={faded(entry.channelId) ? 0.2 : 1}
                      onMouseEnter={() => setPreview(entry.channelId)}
                      onMouseLeave={() => setPreview(null)}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>

            <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-2">
                <span aria-hidden="true" className="size-2 rounded-sm bg-(--chart-2)" />
                Earned
              </span>
              <span className="flex items-center gap-2">
                <span aria-hidden="true" className="size-2 rounded-sm bg-destructive" />
                Provider-reported loss
              </span>
              <span className="flex items-center gap-2">
                <span aria-hidden="true" className="size-2 rounded-sm bg-(--chart-4)" />
                Revenue reported; loss not recorded
              </span>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {currencies.size > 1
                ? "Visual comparison is unavailable because channels reported different currencies."
                : "No channel has a positive reported revenue figure for this window."}
            </p>
            <ul aria-label="Exact channel summaries" className="flex flex-col gap-2">
              {reportedRows.map((row) => (
                <li
                  key={row.channelId}
                  aria-label={moneyLabel(row)}
                  className="flex flex-wrap items-center justify-between gap-3 text-sm"
                >
                  <span className="font-medium">{row.displayName}</span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {row.band.state === "complete" && row.band.earned && row.band.lost
                      ? `${formatMoney(row.band.earned.minorUnits, row.band.earned.currency)} earned · ${formatMoney(
                          row.band.lost.minorUnits,
                          row.band.lost.currency,
                        )} provider-reported loss`
                      : `${formatMoney(row.band.potential.minorUnits, row.band.potential.currency)} revenue reported · loss not recorded`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <Separator />

      <div className="grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <section
          aria-label="Where revenue was lost"
          className="flex min-w-0 flex-col gap-5 p-5 sm:p-7"
        >
          <div className="flex flex-col gap-1">
            <h3 className="font-heading text-sm font-semibold">Where revenue was lost</h3>
            <p className="text-xs text-muted-foreground">
              Largest contributors within complete bands
            </p>
          </div>

          {lossRows.length > 0 && totalLostMinorUnits > 0 ? (
            <ol className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              {lossRows.slice(0, 4).map(({ row, lost }) => (
                <li
                  key={row.channelId}
                  className="flex flex-col gap-1"
                  data-testid={`loss-contributor-${row.channelId}`}
                >
                  <p className="font-mono text-2xl tracking-tight tabular-nums">
                    {Math.round((lost.minorUnits / totalLostMinorUnits) * 100)}%
                  </p>
                  <p className="font-medium">{row.displayName}</p>
                  <p className="font-mono text-xs tabular-nums text-muted-foreground">
                    {formatMoney(lost.minorUnits, lost.currency)} provider-reported loss
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {lossRows.length > 0
                ? "No provider-reported loss was recorded in the complete bands."
                : "No completed split is available for this window."}
            </p>
          )}
        </section>

        <Separator className="hidden h-full lg:block" orientation="vertical" />
        <Separator className="lg:hidden" />

        <section aria-label="Evidence coverage" className="flex min-w-0 flex-col gap-5 p-5 sm:p-7">
          <div className="flex flex-col gap-1">
            <h3 className="font-heading text-sm font-semibold">Evidence coverage</h3>
            <p className="text-xs text-muted-foreground">What the selected window can support</p>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <p className="font-mono text-xl tracking-tight tabular-nums">
              {coverage.assessedCount} complete
            </p>
            <p className="font-mono text-xl tracking-tight tabular-nums">
              {coverage.revenueOnlyNames.length} revenue-only
            </p>
            <p className="font-mono text-xl tracking-tight tabular-nums">
              {coverage.unassessedNames.length} awaiting analysis
            </p>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">{coverageNote(coverage)}</p>
        </section>
      </div>
    </div>
  );
}
