"use client";

import { Area, AreaChart, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type {
  OverviewChannelPoint,
  OverviewTrendPoint,
} from "@/modules/organizations/application/overview";

/**
 * The two recharts visuals the overview draws. Everything else on the route is
 * a stored amount rendered as a plain div, so only this file needs the client.
 *
 * Neither chart derives a figure. Each point is an amount the ledger recorded,
 * divided into major units at the last possible moment for display.
 */

const trendConfig = {
  grossRevenue: { label: "Recorded sales", color: "var(--chart-3)" },
} satisfies ChartConfig;

const mixConfig = {
  grossRevenue: { label: "Recorded sales", color: "var(--chart-1)" },
} satisfies ChartConfig;

const channelColors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

/**
 * How many minor units make a unit depends on the currency, so the exponent is
 * read from `Intl` rather than assumed to be two. A dinar keeps three places
 * and a yen keeps none; dividing everything by 100 is wrong for both.
 */
function toMajor(minorUnits: number, currency: string): number {
  const exponent =
    new Intl.NumberFormat("en-AE", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2;
  return minorUnits / 10 ** exponent;
}

function compactMoney(major: number, currency: string): string {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 0,
  }).format(major);
}

function formatDay(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone }).format(
    new Date(value),
  );
}

export function OverviewTrendChart({
  trend,
  currency,
  timeZone,
}: {
  trend: readonly OverviewTrendPoint[];
  currency: string;
  timeZone: string;
}) {
  const points = trend.map((point) => ({
    date: formatDay(point.periodStart, timeZone),
    grossRevenue: toMajor(point.grossRevenueMinor, currency),
  }));

  return (
    <ChartContainer
      config={trendConfig}
      className="aspect-auto h-48 w-full"
      data-testid="overview-trend-chart"
    >
      <AreaChart accessibilityLayer data={points} margin={{ left: 4, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="overviewSalesFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.26} />
            <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={10} minTickGap={28} />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          width={58}
          tickFormatter={(value: number) => compactMoney(value, currency)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              hideIndicator
              formatter={(value) => (
                <span className="font-mono font-medium tabular-nums">
                  {new Intl.NumberFormat("en-AE", { style: "currency", currency }).format(
                    Number(value),
                  )}
                </span>
              )}
            />
          }
        />
        <Area
          dataKey="grossRevenue"
          type="monotone"
          stroke="var(--chart-3)"
          strokeWidth={2}
          fill="url(#overviewSalesFill)"
        />
      </AreaChart>
    </ChartContainer>
  );
}

export function OverviewChannelMix({
  channels,
  currency,
}: {
  channels: readonly OverviewChannelPoint[];
  currency: string;
}) {
  const reported = channels.filter((channel) => channel.grossRevenueMinor > 0);
  const total = reported.reduce((sum, channel) => sum + channel.grossRevenueMinor, 0);

  // A share of nothing is not a share. Rather than draw an empty ring, the
  // caller's legend still lists the channels and this returns nothing.
  if (total <= 0) return null;

  const slices = reported.map((channel, index) => ({
    channel: channel.channel,
    grossRevenue: toMajor(channel.grossRevenueMinor, currency),
    color: channelColors[index % channelColors.length],
  }));

  return (
    <ChartContainer
      config={mixConfig}
      className="mx-auto aspect-auto h-44 w-full max-w-52"
      data-testid="overview-channel-mix"
    >
      <PieChart accessibilityLayer>
        <ChartTooltip
          content={
            <ChartTooltipContent
              hideIndicator
              formatter={(value) => (
                <span className="font-mono font-medium tabular-nums">
                  {new Intl.NumberFormat("en-AE", { style: "currency", currency }).format(
                    Number(value),
                  )}
                </span>
              )}
            />
          }
        />
        <Pie
          data={slices}
          dataKey="grossRevenue"
          nameKey="channel"
          innerRadius={46}
          outerRadius={70}
          paddingAngle={2}
          strokeWidth={0}
        >
          {slices.map((slice) => (
            <Cell key={slice.channel} fill={slice.color} />
          ))}
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}

export { channelColors };
