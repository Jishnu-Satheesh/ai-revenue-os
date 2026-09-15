"use client";

import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type PostPerformancePoint = {
  metricKey: string;
  label: string;
  observedAt: string;
  presence: "observed" | "absent";
  value: number | null;
};

export type PostPerformanceSeries = {
  actionRunId: string;
  /** What this post is called on screen, resolved by the caller. */
  postLabel: string;
  points: readonly PostPerformancePoint[];
};

/**
 * What Instagram is reporting about each published post.
 *
 * Every figure here is Instagram's own, under Instagram's own name. The
 * platform used to insist on `impressions`, which Meta deprecated for anything
 * published after 2024-07-02 — so the honest choice was to report what the
 * provider actually answers rather than keep a familiar label over a number
 * nobody can collect.
 *
 * Each figure is a **lifetime running total for the post**, because the media
 * insights endpoint fixes its period at `lifetime` and will not be asked for
 * anything else. That is said on the surface, not just in the data: a reader
 * who takes a lifetime total for yesterday's reach has been misled by the
 * screen, not by the provider.
 *
 * The chart is a picture of the same rows the table already states, so it is
 * hidden from assistive technology and the table carries the meaning. Nothing
 * is shown here that is not in the table.
 */

const numberFormat = new Intl.NumberFormat("en-GB");

export function PostPerformance({
  series,
  timeZone,
}: Readonly<{
  series: readonly PostPerformanceSeries[];
  timeZone: string;
}>) {
  if (series.length === 0) {
    return (
      <section className="flex flex-col gap-2" aria-labelledby="post-performance-heading">
        <h3 id="post-performance-heading" className="text-base font-semibold">
          What Instagram is reporting
        </h3>
        <p className="text-sm text-muted-foreground">
          Nothing has been collected yet. Figures appear once a post has been published and
          Instagram has had time to report on it — that is different from a post that reached
          nobody.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-6" aria-labelledby="post-performance-heading">
      <div className="flex flex-col gap-1">
        <h3 id="post-performance-heading" className="text-base font-semibold">
          What Instagram is reporting
        </h3>
        <p className="text-sm text-muted-foreground">
          Instagram&rsquo;s own figures, under its own names. Every number is a running total for
          the life of the post, not a figure for one day, so it only ever goes up.
        </p>
      </div>

      {series.map((post) => (
        <PostCard key={post.actionRunId} post={post} timeZone={timeZone} />
      ))}
    </section>
  );
}

function PostCard({
  post,
  timeZone,
}: Readonly<{ post: PostPerformanceSeries; timeZone: string }>) {
  const { rows, chartData, config, readings } = useMemo(
    () => summarise(post.points, timeZone),
    [post.points, timeZone],
  );

  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <h4 className="text-sm font-medium">{post.postLabel}</h4>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Measure</TableHead>
              <TableHead className="text-right">Latest</TableHead>
              <TableHead className="text-right">Change since first reading</TableHead>
              <TableHead>Last read</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.metricKey}>
                <TableCell className="font-medium">{row.label}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.latest === null ? (
                    // Never a zero. Instagram reporting nothing and Instagram
                    // reporting none are different answers.
                    <span className="text-muted-foreground">Not reported</span>
                  ) : (
                    numberFormat.format(row.latest)
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.change === null ? (
                    <span className="text-muted-foreground">
                      {row.readingCount < 2 ? "Only one reading" : "Not reported"}
                    </span>
                  ) : (
                    `+${numberFormat.format(row.change)}`
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {row.lastReadAt === null ? "Never" : formatDay(row.lastReadAt, timeZone)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {readings >= 2 ? (
        <div aria-hidden="true">
          <ChartContainer config={config} className="aspect-auto h-[220px] w-full">
            <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis tickLine={false} axisLine={false} width={48} />
              <ChartTooltip />
              {rows.map((row) => (
                <Line
                  key={row.metricKey}
                  dataKey={row.metricKey}
                  type="monotone"
                  stroke={`var(--color-${row.metricKey.replace(/[^a-z0-9]/gi, "-")})`}
                  strokeWidth={2}
                  dot={false}
                  // A day the provider reported nothing leaves a gap in the
                  // line. Joining across it would draw a measurement that was
                  // never taken.
                  connectNulls={false}
                />
              ))}
            </LineChart>
          </ChartContainer>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          A trend needs at least two readings. There is only one so far.
        </p>
      )}
    </div>
  );
}

type SummaryRow = {
  metricKey: string;
  label: string;
  latest: number | null;
  change: number | null;
  lastReadAt: string | null;
  readingCount: number;
};

function summarise(points: readonly PostPerformancePoint[], timeZone: string) {
  const byMetric = new Map<string, PostPerformancePoint[]>();
  for (const point of points) {
    byMetric.set(point.metricKey, [...(byMetric.get(point.metricKey) ?? []), point]);
  }

  const rows: SummaryRow[] = [...byMetric.entries()].map(([metricKey, metricPoints]) => {
    const observed = metricPoints.filter((point) => point.presence === "observed");
    const first = observed.at(0) ?? null;
    const last = observed.at(-1) ?? null;
    return {
      metricKey,
      label: metricPoints[0]?.label ?? metricKey,
      latest: last?.value ?? null,
      // Two readings of a running total is the only thing that makes a change
      // meaningful. One reading is a position, not a movement.
      change:
        observed.length >= 2 && first?.value !== null && last?.value !== null
          ? (last?.value ?? 0) - (first?.value ?? 0)
          : null,
      lastReadAt: last?.observedAt ?? null,
      readingCount: observed.length,
    };
  });

  const days = [...new Set(points.map((point) => point.observedAt))].sort(
    (left, right) => Date.parse(left) - Date.parse(right),
  );

  const chartData = days.map((observedAt) => {
    const row: Record<string, string | number | null> = {
      day: formatDay(observedAt, timeZone),
    };
    for (const [metricKey, metricPoints] of byMetric) {
      const point = metricPoints.find((entry) => entry.observedAt === observedAt);
      row[metricKey] = point?.presence === "observed" ? point.value : null;
    }
    return row;
  });

  const config: ChartConfig = Object.fromEntries(
    rows.map((row, index) => [
      row.metricKey,
      { label: row.label, color: `var(--chart-${(index % 5) + 1})` },
    ]),
  );

  return { rows, chartData, config, readings: days.length };
}

function formatDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone,
  }).format(new Date(iso));
}
