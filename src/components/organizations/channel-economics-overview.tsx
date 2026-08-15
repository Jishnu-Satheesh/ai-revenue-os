"use client";

import Link from "next/link";
import { BarChart3, Receipt, TriangleAlert } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { OverviewEconomics } from "@/modules/organizations/application/overview";

type EconomicsResult = { status: "ready"; data: OverviewEconomics } | { status: "failed" };

const chartConfig = {
  grossRevenue: { label: "Gross revenue", color: "var(--chart-1)" },
  contributionMargin: { label: "Contribution margin", color: "var(--chart-2)" },
  indicativeCeiling: { label: "Indicative margin upper bound", color: "var(--chart-4)" },
} satisfies ChartConfig;

export function ChannelEconomicsOverview({
  organizationId,
  result,
}: Readonly<{ organizationId: string; result: EconomicsResult }>) {
  const href = `/organizations/${organizationId}/economics`;

  if (result.status === "failed") {
    return (
      <Card id="channel-economics">
        <CardHeader>
          <CardTitle>Channel Economics</CardTitle>
          <CardDescription>Revenue, contribution, and evidence quality.</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>Channel economics are temporarily unavailable</AlertTitle>
            <AlertDescription>
              The ledger could not be checked. No performance conclusion has been substituted.
            </AlertDescription>
          </Alert>
        </CardContent>
        <CardFooter>
          <Button asChild variant="outline" size="sm">
            <Link href={href}>Open channel economics</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const { data } = result;
  if (data.state === "empty") {
    return (
      <Card id="channel-economics">
        <CardHeader>
          <CardTitle>Channel Economics</CardTitle>
          <CardDescription>{windowLabel(data)} · complete local days</CardDescription>
        </CardHeader>
        <CardContent>
          <Empty className="min-h-56 border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Receipt />
              </EmptyMedia>
              <EmptyTitle>No trade recorded in this window</EmptyTitle>
              <EmptyDescription>
                Once imported revenue reaches the ledger, this card will compare channel revenue,
                contribution, and evidence quality without filling missing days with zeroes.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
        <CardFooter>
          <Button asChild variant="outline" size="sm">
            <Link href={href}>Open channel economics</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const trend = data.trend.map((point) => ({
    date: formatDay(point.periodStart, data.window.timeZone),
    grossRevenue: toMajor(point.grossRevenueMinor),
    contributionMargin:
      point.contributionMarginMinor === null ? null : toMajor(point.contributionMarginMinor),
    indicativeCeiling: point.atMostMinor === null ? null : toMajor(point.atMostMinor),
    grade: point.grade,
  }));
  const channels = data.channels.map((channel) => ({
    channel: readableChannel(channel.channel),
    grossRevenue: toMajor(channel.grossRevenueMinor),
    contributionMargin:
      channel.contributionMarginMinor === null ? null : toMajor(channel.contributionMarginMinor),
    indicativeCeiling: channel.atMostMinor === null ? null : toMajor(channel.atMostMinor),
    grade: channel.grade,
  }));

  return (
    <Card id="channel-economics">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <CardTitle>Channel Economics</CardTitle>
          <CardDescription>{windowLabel(data)} · complete local days</CardDescription>
        </div>
        <Badge variant={data.gradeCounts.indicative > 0 ? "secondary" : "outline"}>
          {data.gradeCounts.indicative > 0 ? "Evidence limited" : "Evidence usable"}
        </Badge>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue={data.gradeCounts.indicative === data.trend.length ? "trust" : "trend"}>
          <div className="overflow-x-auto pb-1">
            <TabsList aria-label="Channel economics views">
              <TabsTrigger value="trend">Trend</TabsTrigger>
              <TabsTrigger value="channels">Channel comparison</TabsTrigger>
              <TabsTrigger value="trust">Data trust</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="trend" className="mt-5">
            <ChartKey />
            <ChartContainer
              config={chartConfig}
              className="mt-3 h-72 w-full min-w-0 aspect-auto"
              aria-label="Daily channel economics trend"
            >
              <AreaChart accessibilityLayer data={trend} margin={{ left: 8, right: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => compactMoney(value, data.currency)}
                  width={64}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => (
                        <TooltipValue
                          label={String(
                            chartConfig[String(name) as keyof typeof chartConfig]?.label ?? name,
                          )}
                          value={formatMoney(Number(value), data.currency)}
                        />
                      )}
                    />
                  }
                />
                <Area
                  dataKey="grossRevenue"
                  type="monotone"
                  fill="var(--color-grossRevenue)"
                  fillOpacity={0.12}
                  stroke="var(--color-grossRevenue)"
                  strokeWidth={2}
                />
                <Area
                  dataKey="contributionMargin"
                  type="monotone"
                  fill="var(--color-contributionMargin)"
                  fillOpacity={0.08}
                  stroke="var(--color-contributionMargin)"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "var(--color-contributionMargin)" }}
                  connectNulls={false}
                />
                <Area
                  dataKey="indicativeCeiling"
                  type="monotone"
                  fill="transparent"
                  stroke="var(--color-indicativeCeiling)"
                  strokeDasharray="5 5"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "var(--color-indicativeCeiling)" }}
                  connectNulls={false}
                />
              </AreaChart>
            </ChartContainer>
            <ChartTextSummary data={data} />
          </TabsContent>

          <TabsContent value="channels" className="mt-5">
            <ChartKey />
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {data.channels.map((channel) => (
                <li
                  key={channel.channel}
                  className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
                >
                  <span className="font-medium">{readableChannel(channel.channel)}</span>
                  <Badge variant="outline">{channel.grade}</Badge>
                </li>
              ))}
            </ul>
            <ChartContainer
              config={chartConfig}
              className="mt-3 h-72 w-full min-w-0 aspect-auto"
              aria-label="Economics comparison by channel"
            >
              <BarChart accessibilityLayer data={channels} margin={{ left: 8, right: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="channel" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => compactMoney(value, data.currency)}
                  width={64}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => (
                        <TooltipValue
                          label={String(
                            chartConfig[String(name) as keyof typeof chartConfig]?.label ?? name,
                          )}
                          value={formatMoney(Number(value), data.currency)}
                        />
                      )}
                    />
                  }
                />
                <Bar dataKey="grossRevenue" fill="var(--color-grossRevenue)" radius={4} />
                <Bar
                  dataKey="contributionMargin"
                  fill="var(--color-contributionMargin)"
                  radius={4}
                />
                <Bar
                  dataKey="indicativeCeiling"
                  fill="var(--color-indicativeCeiling)"
                  fillOpacity={0.5}
                  radius={4}
                />
              </BarChart>
            </ChartContainer>
            <ul className="sr-only">
              {data.channels.map((channel) => (
                <li key={channel.channel}>
                  {readableChannel(channel.channel)}: gross revenue{" "}
                  {formatMinor(channel.grossRevenueMinor, data.currency)};{" "}
                  {channel.contributionMarginMinor === null
                    ? `indicative margin upper bound ${formatMinor(channel.atMostMinor ?? 0, data.currency)}`
                    : `contribution margin ${formatMinor(channel.contributionMarginMinor, data.currency)}`}
                  ; evidence {channel.grade}.
                </li>
              ))}
            </ul>
          </TabsContent>

          <TabsContent value="trust" className="mt-5">
            <DataTrust data={data} />
          </TabsContent>
        </Tabs>

        {data.gradeCounts.indicative > 0 ? (
          <Alert className="mt-5">
            <TriangleAlert />
            <AlertTitle>Some margin values are an upper bound</AlertTitle>
            <AlertDescription>
              Missing cost evidence can only reduce margin. Indicative periods are excluded from
              profit conclusions and shown with a dashed series.
            </AlertDescription>
          </Alert>
        ) : null}
        <p className="mt-5 text-sm text-muted-foreground">{data.takeaway}</p>
      </CardContent>
      <CardFooter>
        <Button asChild variant="outline" size="sm">
          <Link href={href}>
            <BarChart3 data-icon="inline-start" />
            View channel economics
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function ChartKey() {
  return (
    <div aria-label="Chart legend" className="flex flex-wrap gap-3 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-chart-1" aria-hidden="true" />
        Gross revenue
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-chart-2" aria-hidden="true" />
        Contribution margin
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-chart-4" aria-hidden="true" />
        Indicative margin upper bound
      </span>
    </div>
  );
}

function DataTrust({ data }: { data: OverviewEconomics }) {
  const measuredPercent = data.coverage.applicable
    ? Math.round((data.coverage.measured / data.coverage.applicable) * 100)
    : 0;
  const pricedPercent = data.coverage.applicable
    ? Math.round((data.coverage.priced / data.coverage.applicable) * 100)
    : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-3">
        {(["complete", "partial", "indicative"] as const).map((grade) => (
          <div key={grade} className="rounded-lg border p-4">
            <p className="text-2xl font-semibold tabular-nums">{data.gradeCounts[grade]}</p>
            <p className="mt-1 text-sm capitalize text-muted-foreground">{grade} days</p>
          </div>
        ))}
      </div>
      {data.catalogAvailable ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <CoverageRow
            label="Measured costs"
            value={`${data.coverage.measured} of ${data.coverage.applicable}`}
            percentage={measuredPercent}
          />
          <CoverageRow
            label="Priced costs"
            value={`${data.coverage.priced} of ${data.coverage.applicable}`}
            percentage={pricedPercent}
          />
        </div>
      ) : (
        <Alert>
          <TriangleAlert />
          <AlertTitle>Cost coverage could not be checked</AlertTitle>
          <AlertDescription>
            No all-clear is shown when the catalog is unavailable.
          </AlertDescription>
        </Alert>
      )}
      {data.gaps.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Evidence gaps</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {data.gaps.slice(0, 4).map((gap) => (
              <li key={gap.key} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{gap.label}</span>
                  <Badge variant="outline">{readableGapState(gap.state)}</Badge>
                </div>
                <p className="mt-1 text-muted-foreground">{gap.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function CoverageRow({
  label,
  value,
  percentage,
}: {
  label: string;
  value: string;
  percentage: number;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm tabular-nums text-muted-foreground">{value}</span>
      </div>
      <Progress value={percentage} aria-label={`${label}: ${value}`} />
    </div>
  );
}

function TooltipValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex w-full min-w-48 items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium tabular-nums">{value}</span>
    </div>
  );
}

function ChartTextSummary({ data }: { data: OverviewEconomics }) {
  return (
    <ul className="sr-only">
      {data.trend.map((point) => (
        <li key={point.periodStart}>
          {formatDay(point.periodStart, data.window.timeZone)}: gross revenue{" "}
          {formatMinor(point.grossRevenueMinor, data.currency)};{" "}
          {point.contributionMarginMinor === null
            ? `indicative margin upper bound ${formatMinor(point.atMostMinor ?? 0, data.currency)}`
            : `contribution margin ${formatMinor(point.contributionMarginMinor, data.currency)}`}
          ; evidence {point.grade}.
        </li>
      ))}
    </ul>
  );
}

function windowLabel(data: OverviewEconomics): string {
  const end = new Date(new Date(data.window.rangeEndExclusive).getTime() - 1);
  return `${formatDate(data.window.rangeStart, data.window.timeZone)} – ${formatDate(end.toISOString(), data.window.timeZone)}`;
}

function formatDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  }).format(new Date(value));
}

function formatDay(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone,
  }).format(new Date(value));
}

function formatMinor(value: number, currency: string | null): string {
  return formatMoney(toMajor(value), currency);
}

function formatMoney(value: number, currency: string | null): string {
  if (!currency) return value.toLocaleString("en-GB");
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function compactMoney(value: number, currency: string | null): string {
  if (!currency) return value.toLocaleString("en-GB", { notation: "compact" });
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function toMajor(value: number): number {
  return value / 100;
}

function readableChannel(value: string): string {
  return value
    .split(/[_-]/)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function readableGapState(value: OverviewEconomics["gaps"][number]["state"]): string {
  if (value === "not_yet_possible") return "Needs source data";
  if (value === "unpriced") return "Unpriced";
  return "Estimated";
}
