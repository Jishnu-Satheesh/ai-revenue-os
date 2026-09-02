import {
  ChevronDown,
  CircleCheck,
  LayoutDashboard,
  LineChart,
  Radar,
  Settings,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";

import { dashboardMock, illustrativeOpportunity } from "@/components/marketing/content";

function areaChartPaths() {
  const measured =
    "M0,150 L40,142 L80,146 L120,130 L160,124 L200,128 L240,110 L280,104 " +
    "L320,96 L360,88 L400,70 L440,64 L480,52 L520,44 L560,34";
  return { measured };
}

export function DashboardMock() {
  const { measured } = areaChartPaths();

  return (
    <div className="flex overflow-hidden rounded-xl border border-border bg-card text-left">
      <aside className="hidden w-14 flex-col items-center gap-1.5 border-r border-border bg-background/50 py-4 sm:flex">
        <span
          aria-hidden="true"
          className="mb-3 flex size-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground"
        >
          R
        </span>
        {[LayoutDashboard, Radar, LineChart, Settings].map((Icon, index) => (
          <span
            key={index}
            aria-hidden="true"
            className={
              index === 0
                ? "flex size-8 items-center justify-center rounded-md bg-primary/15 text-primary"
                : "flex size-8 items-center justify-center rounded-md text-muted-foreground/60"
            }
          >
            <Icon className="size-4" />
          </span>
        ))}
      </aside>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <span className="flex min-w-0 items-center gap-2 text-xs">
            <span aria-hidden="true" className="size-2 rounded-full bg-success" />
            <span className="truncate font-medium">{dashboardMock.orgName}</span>
            <span className="hidden truncate text-muted-foreground md:inline">
              {dashboardMock.branch}
            </span>
            <ChevronDown aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
          </span>
          <span className="flex items-center gap-1">
            {dashboardMock.ranges.map((range) => (
              <span
                key={range}
                className={
                  range === dashboardMock.activeRange
                    ? "rounded-md border border-primary/30 bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary"
                    : "rounded-md px-2 py-0.5 text-[11px] text-muted-foreground"
                }
              >
                {range}
              </span>
            ))}
          </span>
        </div>

        <div className="grid gap-4 p-4 lg:grid-cols-[1fr_230px]">
          <div className="min-w-0 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {dashboardMock.kpis.map((kpi) => (
                <div
                  key={kpi.label}
                  className="rounded-lg border border-border bg-background/40 p-3"
                >
                  <p className="truncate text-[11px] text-muted-foreground">{kpi.label}</p>
                  <p className="mt-1 truncate text-base font-semibold tabular-nums sm:text-lg">
                    {kpi.value}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-success">
                    <TrendingUp aria-hidden="true" className="size-3" />
                    {kpi.delta}
                  </p>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-border bg-background/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs font-medium">{dashboardMock.chartTitle}</p>
                <span className="flex shrink-0 items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
                    {dashboardMock.legendMeasured}
                  </span>
                  <span className="flex items-center gap-1">
                    <span
                      aria-hidden="true"
                      className="h-0 w-3 border-t border-dashed border-muted-foreground"
                    />
                    {dashboardMock.legendBaseline}
                  </span>
                </span>
              </div>
              <svg
                aria-hidden="true"
                className="mt-2 h-36 w-full"
                viewBox="0 0 560 180"
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient id="mk-area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.32" />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[45, 90, 135].map((y) => (
                  <line
                    key={y}
                    x1="0"
                    x2="560"
                    y1={y}
                    y2={y}
                    stroke="var(--border)"
                    strokeWidth="1"
                  />
                ))}
                <path d={`${measured} L560,180 L0,180 Z`} fill="url(#mk-area)" />
                <path
                  d={measured}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                <path
                  d="M0,158 L560,118"
                  fill="none"
                  stroke="var(--muted-foreground)"
                  strokeWidth="1.5"
                  strokeDasharray="5 5"
                  opacity="0.55"
                />
              </svg>
            </div>
          </div>

          <aside className="min-w-0 rounded-lg border border-border bg-background/40 p-3">
            <p className="text-xs font-medium">{dashboardMock.feedTitle}</p>
            <div className="mt-2.5 space-y-2.5">
              <div className="rounded-lg border border-border bg-card p-2.5">
                <p className="truncate text-xs font-medium">{dashboardMock.feed[0].title}</p>
                <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {dashboardMock.feed[0].meta}
                </p>
                <p className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-warning">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
                  {dashboardMock.feed[0].status}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-2.5">
                <p className="truncate text-xs font-medium">{dashboardMock.feed[1].title}</p>
                <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {dashboardMock.feed[1].meta}
                </p>
                <p className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-success">
                  <CircleCheck aria-hidden="true" className="size-3" />
                  {dashboardMock.feed[1].status}
                </p>
              </div>
              <p className="pt-1 text-[10px] text-muted-foreground">
                {illustrativeOpportunity.impact} · {illustrativeOpportunity.impactLabel}
              </p>
            </div>
            <p className="mt-3 flex items-start gap-1.5 border-t border-border pt-2.5 text-[10px] leading-relaxed text-muted-foreground">
              <ShieldCheck aria-hidden="true" className="mt-0.5 size-3 shrink-0 text-success" />
              {dashboardMock.feedNote}
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
