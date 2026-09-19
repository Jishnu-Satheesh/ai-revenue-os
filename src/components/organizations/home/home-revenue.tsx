"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronDown, Hourglass } from "lucide-react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import { formatWholeMoney } from "@/components/analysis/format";
import { HomeRefreshButton } from "@/components/organizations/home/home-refresh-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { Separator } from "@/components/ui/separator";
import type {
  RevenueScenario,
  RevenueScenarioReady,
  RevenueScenarioUnquantified,
  RevenueHorizonPoint,
} from "@/domain/organizations/revenue-scenario";
import {
  projectRevenueHorizon,
  REVENUE_HORIZON_MONTHS,
} from "@/domain/organizations/revenue-scenario";
import type { OrganizationHomeView } from "@/modules/organizations/application/home-types";
import type {
  GrowthProgressSection,
  GrowthProgressView,
} from "@/modules/organizations/application/growth-progress-view";
import {
  formatFooterDay,
  HomeGrowthChart,
} from "@/components/organizations/home/home-growth-chart";
import {
  growthStateCopy,
  HomeGrowthFailed,
  HomeGrowthMethodDialog,
} from "@/components/organizations/home/home-growth-details";
import { HomeGrowthInsight } from "@/components/organizations/home/home-growth-insight";
import styles from "@/components/organizations/home/organization-home.module.css";

export type RevenueChartRow = {
  label: string;
  actual: number | null;
  current: number | null;
  low: number | null;
  high: number | null;
};

function majorExponent(currency: string): number {
  return (
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

/**
 * Chart rows in major units: reported buckets as solid actuals, then one
 * cumulative point per horizon month. The future accumulates the flat
 * monthly level — current course and the with-actions band grow linearly,
 * never compounded. Grain is preserved: one row per reported bucket, no
 * interpolated days.
 */
export function buildRevenueChartRows(
  scenario: RevenueScenarioReady,
  months: number,
  asOfDate: string,
): { rows: RevenueChartRow[]; points: RevenueHorizonPoint[] } {
  const exponent = majorExponent(scenario.currency);
  const toMajor = (minorUnits: number) => minorUnits / 10 ** exponent;
  const points = projectRevenueHorizon(scenario, months, asOfDate);
  const rows: RevenueChartRow[] = scenario.history.map((point) => ({
    label: point.label,
    actual: toMajor(point.minorUnits),
    current: null,
    low: null,
    high: null,
  }));
  const last = rows[rows.length - 1];
  if (last) last.current = toMajor(scenario.currentCourseMinorUnits);
  for (const point of points) {
    rows.push({
      label: point.label,
      actual: null,
      current: toMajor(point.currentCourseMinorUnits),
      low: toMajor(point.lowMinorUnits),
      high: toMajor(point.highMinorUnits),
    });
  }
  return { rows, points };
}

function chartAriaLabel(scenario: RevenueScenarioReady, months: number, endLabel: string): string {
  const parts = scenario.history.map(
    (point) => `${point.label} ${formatWholeMoney(point.minorUnits, scenario.currency)}`,
  );
  return [
    `Reported revenue: ${parts.join(", ") || "none"}.`,
    `Over the next ${months} month${months === 1 ? "" : "s"} to ${endLabel},` +
      ` cumulatively ${formatWholeMoney(scenario.currentCourseMinorUnits * months, scenario.currency)} on the current course,` +
      ` ${formatWholeMoney(scenario.withActionsLowMinorUnits * months, scenario.currency)} to` +
      ` ${formatWholeMoney(scenario.withActionsHighMinorUnits * months, scenario.currency)} with the included actions.`,
    scenario.gapNote ?? "",
  ]
    .filter((part) => part.length > 0)
    .join(" ");
}

function ActionLink({ href, title }: { href: string | null; title: string }) {
  if (!href) return <span className={styles.revenueActionName}>{title}</span>;
  return (
    <Link href={href} className={styles.inlineLink}>
      {title} <ArrowRight aria-hidden="true" />
    </Link>
  );
}

/**
 * An unquantified rail row: alive like the quantified rows but honest about
 * having no number. The header is a plain row (pending icon + ActionLink
 * title + status + dashed "Estimate pending" placeholder); a separate small
 * chevron button toggles the exact server reason inline with an instant
 * show/hide (no animation, so still under prefers-reduced-motion by
 * construction). Title and toggle are siblings — never nested interactives.
 */
function UnquantifiedRow({ action }: { action: RevenueScenarioUnquantified }) {
  const [expanded, setExpanded] = useState(false);
  const regionId = `revenue-unquantified-${action.actionId}`;
  return (
    <li className={styles.revenueUnquantifiedRow}>
      <div className={styles.revenueUnquantifiedHeader}>
        <Hourglass aria-hidden="true" className={styles.revenueUnquantifiedIcon} />
        <span className={styles.revenueUnquantifiedBody}>
          <ActionLink href={action.href} title={action.title} />
          <span className={styles.revenueUnquantifiedMeta}>
            <StatusBadge label={action.status} tone="neutral" />
          </span>
          <span className={`${styles.revenueFigureSub} ${styles.revenueUnquantifiedPending}`}>
            Estimate pending
          </span>
        </span>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={regionId}
          aria-label={
            expanded ? `Hide details for ${action.title}` : `Show details for ${action.title}`
          }
          onClick={() => setExpanded((open) => !open)}
          className={styles.revenueUnquantifiedToggle}
        >
          <ChevronDown aria-hidden="true" className={styles.revenueUnquantifiedChevron} />
        </button>
      </div>
      {expanded ? (
        <p id={regionId} className={styles.revenueUnquantifiedReason}>
          {action.reason}
        </p>
      ) : null}
    </li>
  );
}

/**
 * The racing tip: a pulsing ring on the current course's latest point, so the
 * line reads as moving toward the projected band. Opacity-and-scale only, and
 * fully static under prefers-reduced-motion (see the stylesheet).
 */
export function PulsingTipDot({
  cx,
  cy,
  index,
  lastIndex,
}: {
  cx?: number;
  cy?: number;
  index?: number;
  lastIndex: number;
}) {
  if (cx === undefined || cy === undefined || index !== lastIndex) return <g />;
  return (
    <g aria-hidden="true">
      <circle cx={cx} cy={cy} r={5} className={styles.revenuePulse} />
      <circle
        cx={cx}
        cy={cy}
        r={4}
        fill="var(--muted-foreground)"
        stroke="var(--card)"
        strokeWidth={2}
      />
    </g>
  );
}

function ScenarioChart({ scenario, months }: { scenario: RevenueScenarioReady; months: number }) {
  const { rows, points } = buildRevenueChartRows(scenario, months, scenario.today);
  const endLabel = points[points.length - 1]?.label ?? "";
  const group = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
  const max = Math.max(
    0,
    ...rows
      .flatMap((row) => [row.actual, row.current, row.low, row.high])
      .filter((value): value is number => value !== null),
  );
  const boundary = scenario.history[scenario.history.length - 1]?.label;
  const lastIndex = rows.length - 1;
  return (
    <div
      className={styles.revenueChart}
      role="img"
      aria-label={`${chartAriaLabel(scenario, months, endLabel)} ${scenario.coverageNote}.`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 5" stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            tickMargin={8}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            interval="preserveStartEnd"
            minTickGap={24}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={56}
            domain={[0, max]}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickFormatter={(value: number) => group.format(value)}
          />
          {boundary ? (
            <ReferenceLine
              x={boundary}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              label={{ value: "Last reported", fontSize: 11, fill: "var(--muted-foreground)" }}
            />
          ) : null}
          <Line
            type="linear"
            dataKey="actual"
            name="Reported"
            stroke="var(--primary)"
            strokeWidth={3}
            dot={{ r: 3, fill: "var(--primary)" }}
            activeDot={{ r: 4 }}
          />
          <Line
            type="linear"
            dataKey="current"
            name="Current course"
            connectNulls
            stroke="var(--muted-foreground)"
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={(dotProps) => <PulsingTipDot {...dotProps} lastIndex={lastIndex} />}
            activeDot={{ r: 4 }}
          />
          <Line
            type="linear"
            dataKey="low"
            name="With actions (low)"
            connectNulls
            stroke="var(--success)"
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
            activeDot={{ r: 4 }}
          />
          <Line
            type="linear"
            dataKey="high"
            name="With actions (high)"
            connectNulls
            stroke="var(--success)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--success)" }}
            activeDot={{ r: 4 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function ScenarioFigures({ scenario, months }: { scenario: RevenueScenarioReady; months: number }) {
  const history = scenario.history;
  const latest = history[history.length - 1];
  const previous = history[history.length - 2];
  const delta =
    latest && previous && previous.minorUnits > 0
      ? Math.round(((latest.minorUnits - previous.minorUnits) / previous.minorUnits) * 100)
      : null;
  const uplift =
    scenario.upliftLowPercent !== null && scenario.upliftHighPercent !== null
      ? `+${scenario.upliftLowPercent}% to +${scenario.upliftHighPercent}% vs current course`
      : "Uplift percentage not stated — see notes.";
  const horizonNoun = months === 1 ? "month" : "months";
  const endLabel = projectRevenueHorizon(scenario, months, scenario.today)[months - 1]?.label ?? "";
  return (
    <dl className={styles.revenueFigures}>
      <div>
        <dt>Latest reported revenue</dt>
        <dd>
          {latest ? formatWholeMoney(latest.minorUnits, scenario.currency) : "Not reported yet"}
        </dd>
        <dd className={styles.revenueFigureSub}>
          {delta !== null && previous
            ? `${delta >= 0 ? "+" : ""}${delta}% vs ${previous.label}`
            : "No comparable earlier bucket."}
        </dd>
      </div>
      <div>
        <dt>
          Current course · {months} {horizonNoun}
        </dt>
        <dd>{formatWholeMoney(scenario.currentCourseMinorUnits * months, scenario.currency)}</dd>
        <dd className={styles.revenueFigureSub}>Cumulative to {endLabel}; flat monthly level.</dd>
      </div>
      <div>
        <dt>With the included actions</dt>
        <dd>
          {formatWholeMoney(scenario.withActionsLowMinorUnits * months, scenario.currency)} –{" "}
          {formatWholeMoney(scenario.withActionsHighMinorUnits * months, scenario.currency)}
        </dd>
        <dd className={styles.revenueFigureSub}>{uplift}</dd>
      </div>
    </dl>
  );
}

/**
 * Fixed-projection growth section (visual contract V00–V04/V06/V08).
 *
 * The thin orchestrator for the new Overview growth card: a restrained Card
 * header with the horizon selector, the two-line chart with same-date
 * summaries, the advice rail, and the projection/reports/scope footer. No
 * model calls, no reforecasting — the selector only switches between the
 * fixed periods the loader already composed. Task 7 layers interaction,
 * disclosure, responsive refinement and the remaining degraded states onto
 * these same files.
 */

const GROWTH_HORIZONS = [1, 3, 6, 12] as const;

function formatMonthYear(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const month = date.toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
  return `${month} ${date.getUTCFullYear()}`;
}

function addMonthsUtc(isoDate: string, months: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCMonth(date.getUTCMonth() + months);
  // Clamp overflow (Jan 31 + 1 month → Feb 28, not Mar 3) the same way the
  // domain period arithmetic anchors the original day.
  if (date.getUTCDate() < day) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

function subtractDayUtc(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * V04 subtitle: a whole calendar month reads "Revenue this month ·
 * September 2026"; any other fixed range prints its exact start/end dates.
 */
export function growthPeriodSubtitle(view: GrowthProgressView): string {
  const { period } = view;
  // No frozen period exists behind a missing projection (the service marks
  // "no period" with an epoch placeholder): printing it would read
  // "1 Jan–1 Jan 1970". A dateless label stays honest instead.
  if (view.projectionId === null) return "Revenue over this period";
  const isWholeCalendarMonth =
    period.startDate.endsWith("-01") &&
    period.endDateExclusive === addMonthsUtc(period.startDate, period.horizonMonths);
  if (period.horizonMonths === 1 && isWholeCalendarMonth) {
    return `Revenue this month · ${formatMonthYear(period.startDate)}`;
  }
  const endInclusive = subtractDayUtc(period.endDateExclusive);
  const endYear = new Date(`${endInclusive}T00:00:00Z`).getUTCFullYear();
  return `Revenue over this period · ${formatFooterDay(period.startDate)}–${formatFooterDay(endInclusive)} ${endYear}`;
}

/** V07 footer identity line: when the estimate was fixed, what it covers. */
export function growthFooterLine(view: GrowthProgressView): string {
  const parts: string[] = [];
  if (view.issuedAt !== null)
    parts.push(`Projection set ${formatFooterDay(view.issuedAt.slice(0, 10))}`);
  if (view.sourceCutoffDate !== null)
    parts.push(`Reports through ${formatFooterDay(view.sourceCutoffDate)}`);
  parts.push(view.scopeLabel);
  return parts.join(" · ");
}

/**
 * V07 right-panel for a non-ready horizon view: the state title plus what is
 * shown and what is missing. Mixed currency and overlapping reports link to
 * the source-owned review destination when permitted — never a replacement
 * mutation, and omitted entirely without permission.
 */
function GrowthStatePanel({
  view,
  reviewHref,
}: Readonly<{ view: GrowthProgressView; reviewHref: string | null }>) {
  const copy = growthStateCopy(view);
  const reviewable =
    view.reasonCode === "CURRENCY_MISMATCH" || view.reasonCode === "OVERLAP_CONFLICT";
  return (
    <div className={styles.growthStateNote}>
      <p className={styles.growthEyebrow}>
        {view.latestComparableDate !== null
          ? `AS OF ${formatFooterDay(view.latestComparableDate).toUpperCase()}`
          : "AS OF —"}
      </p>
      <p className={styles.growthStateTitle}>{copy.title}</p>
      <p className={styles.emptyNote}>{copy.body}</p>
      {reviewable && reviewHref !== null ? (
        <p className={styles.growthRecommendationsRow}>
          <Link href={reviewHref} className={styles.growthRecommendationsLink}>
            Review the source reports <ArrowRight aria-hidden="true" />
          </Link>
        </p>
      ) : null}
    </div>
  );
}

/**
 * On-demand run of tonight's build, rendered only on a blank
 * (missing-projection) view for a permitted viewer. The route re-checks the
 * role and the flag, so hiding the button hides the control but never the
 * authorization. Success means "accepted": the worker answers
 * asynchronously, and a stale baseline still refuses inside the worker with
 * its honest reason on the next load.
 */
function GrowthProjectionTrigger({ organizationId }: Readonly<{ organizationId: string }>) {
  const [status, setStatus] = useState<"idle" | "pending" | "sent" | "failed">("idle");

  async function trigger() {
    setStatus("pending");
    try {
      const response = await fetch(
        `/api/organizations/${organizationId}/growth/projection`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
        },
      );
      setStatus(response.ok ? "sent" : "failed");
    } catch {
      setStatus("failed");
    }
  }

  if (status === "sent") {
    return (
      <div className={styles.growthTriggerNote}>
        <p className={styles.emptyNote}>
          Requested — tracking usually appears within a few minutes. Refresh to check.
        </p>
        <HomeRefreshButton label="Refresh to check" />
      </div>
    );
  }
  return (
    <div className={styles.growthTriggerNote}>
      <Button
        type="button"
        variant="secondary"
        disabled={status === "pending"}
        onClick={trigger}
      >
        {status === "pending" ? "Requesting…" : "Set up tracking now"}
      </Button>
      {status === "failed" ? (
        <p className={styles.emptyNote}>
          The worker could not be reached just now — tonight&apos;s scheduled run is
          unaffected. Try again.
        </p>
      ) : (
        <p className={styles.emptyNote}>
          Runs tonight&apos;s check immediately — the first projection starts tomorrow.
        </p>
      )}
    </div>
  );
}

/**
 * Polite announcement for a horizon switch: the new period plus its latest
 * comparison, so screen-reader users get the atomic view change as one
 * sentence. Never a transient zero or a stale comparison under new label.
 */
export function growthHorizonAnnouncement(view: GrowthProgressView): string {
  const currency = view.currency ?? "AED";
  const comparison = view.latestComparison;
  const verdict =
    view.state !== "ready" || comparison === null
      ? growthStateCopy(view).title
      : comparison.state === "behind" && comparison.differenceMinor !== null
        ? `${formatWholeMoney(Math.abs(comparison.differenceMinor), currency)} behind`
        : comparison.state === "ahead" && comparison.differenceMinor !== null
          ? `${formatWholeMoney(Math.abs(comparison.differenceMinor), currency)} ahead`
          : comparison.state === "within_range"
            ? "Tracking within the estimate"
            : comparison.state === "equal"
              ? "Current revenue matches this estimate"
              : "Comparison unavailable";
  const asOf =
    view.latestComparableDate !== null
      ? ` as of ${formatFooterDay(view.latestComparableDate)}`
      : "";
  return `${growthPeriodSubtitle(view)} — ${verdict}${asOf}.`;
}

function HomeRevenueGrowth({
  organizationId,
  section,
}: Readonly<{
  organizationId: string;
  section: Extract<GrowthProgressSection, { state: "ready" }>;
}>) {
  const [horizon, setHorizon] = useState<1 | 3 | 6 | 12>(section.initialHorizon);
  const [horizonAnnouncement, setHorizonAnnouncement] = useState("");
  const view = section.views[horizon];
  const ready = view.state === "ready";
  // Sparse and partial views still plot their valid points with the state
  // panel beside them; a view with no points at all shows the panel alone.
  const hasPoints = view.points.length > 0 && view.currency !== null;
  const recommendationsHref = `/organizations/${organizationId}/growth-intelligence#recommendations`;

  const switchHorizon = (option: 1 | 3 | 6 | 12) => {
    if (option === horizon) return;
    setHorizon(option);
    setHorizonAnnouncement(growthHorizonAnnouncement(section.views[option]));
  };

  return (
    <section
      id="home-revenue"
      aria-label="Current vs projected growth"
      className={styles.growth}
      data-projection-digest={view.projectionDigest ?? undefined}
    >
      <Card className="gap-0 overflow-hidden rounded-2xl py-0 shadow-none">
        <div className={styles.growthHead}>
          <div className={styles.growthHeadRow}>
            <div className={styles.growthHeadings}>
              <h2 className={styles.growthTitle}>Current vs projected growth</h2>
              <p className={styles.growthSubtitle}>{growthPeriodSubtitle(view)}</p>
            </div>
            <div
              className={styles.growthHorizonRow}
              role="group"
              aria-label="Projection horizon in months"
            >
              {GROWTH_HORIZONS.map((option) => (
                <Button
                  key={option}
                  variant={horizon === option ? "secondary" : "ghost"}
                  size="sm"
                  aria-pressed={horizon === option}
                  aria-label={option === 1 ? "1 month" : `${option} months`}
                  onClick={() => switchHorizon(option)}
                >
                  {option}M
                </Button>
              ))}
            </div>
          </div>
        </div>
        <p aria-live="polite" data-testid="growth-horizon-announcement" className="sr-only">
          {horizonAnnouncement}
        </p>
        <div className={styles.growthGrid}>
          <div className={styles.growthMain}>
            {ready || hasPoints ? (
              // Remount per horizon: period, chart, advice and announcement
              // switch atomically and any pinned tooltip is cleared.
              <HomeGrowthChart key={horizon} view={view} />
            ) : null}
            {!ready && !hasPoints ? (
              <GrowthStatePanel view={view} reviewHref={recommendationsHref} />
            ) : null}
            {view.state === "missing" && section.canTriggerImmediatePublication ? (
              <GrowthProjectionTrigger organizationId={organizationId} />
            ) : null}
          </div>
          <Separator
            orientation="vertical"
            className={`${styles.growthDivider} ${styles.growthDividerVertical}`}
          />
          <Separator className={`${styles.growthDivider} ${styles.growthDividerHorizontal}`} />
          <div className={styles.growthSide}>
            {ready ? (
              <HomeGrowthInsight view={view} recommendationsHref={recommendationsHref} />
            ) : hasPoints ? (
              <GrowthStatePanel view={view} reviewHref={recommendationsHref} />
            ) : null}
          </div>
        </div>
        {ready ? (
          <div className={styles.growthFoot}>
            <div className={styles.growthFootLines}>
              <p className={styles.growthFootLine}>{growthFooterLine(view)}</p>
              {view.limitations.length > 0 ? (
                <p className={styles.growthFootLine}>{view.limitations.join(" ")}</p>
              ) : null}
              {view.freshness.status === "stale" ? (
                <p className={styles.growthFootLine}>
                  {view.freshness.note ??
                    `Latest complete report: ${formatFooterDay(view.sourceCutoffDate ?? view.period.startDate)}`}
                </p>
              ) : null}
            </div>
            <HomeGrowthMethodDialog view={view} />
          </div>
        ) : null}
      </Card>
    </section>
  );
}

/**
 * Current vs projected growth: the first home section. Reported history is
 * solid, the future is two labelled conditional paths after a marked
 * boundary, and every forward figure is a labelled rough estimate with its
 * inputs on the same surface — never a forecast wearing certainty.
 */
export function HomeRevenue({
  organizationId,
  section,
  growth,
}: Readonly<{
  organizationId: string;
  section: OrganizationHomeView["revenue"];
  growth?: GrowthProgressSection;
}>) {
  // Legacy hooks stay unconditionally first: the growth branches below return
  // early, and hooks must keep the same order on every render.
  const [proposed, setProposed] = useState<RevenueScenario | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [months, setMonths] = useState<number>(1);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (growth?.state === "ready") {
    return <HomeRevenueGrowth organizationId={organizationId} section={growth} />;
  }
  if (growth?.state === "failed") {
    // A refresh failure keeps the last readable view's report date on
    // screen; the initial load (no retained view) keeps the shaped failure.
    // Retry only re-runs the reads — it never reforecasts or publishes.
    return (
      <section id="home-revenue" aria-label="Current vs projected growth" className={styles.growth}>
        <HomeGrowthFailed retainedView={growth.retainedView} onRetry={() => router.refresh()} />
      </section>
    );
  }
  if (section.status === "disabled") return null;
  if (section.status === "failed") {
    return (
      <section
        id="home-revenue"
        aria-label="Current vs projected growth"
        className={styles.revenue}
      >
        <Alert>
          <AlertTitle>Growth outlook is unavailable right now</AlertTitle>
          <AlertDescription>
            The recent reports could not be read. Nothing is estimated in their place.{" "}
            <HomeRefreshButton label="Retry" />
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  const scenario = proposed && proposed.state === "ready" ? proposed : section.data;
  if (scenario.state === "refused") {
    return (
      <section
        id="home-revenue"
        aria-label="Current vs projected growth"
        className={styles.revenue}
      >
        <div className={styles.sectionHead}>
          <h2 className={styles.railTitle}>Current vs projected growth</h2>
        </div>
        <p className={styles.emptyNote}>{scenario.reason}</p>
      </section>
    );
  }

  const quantified = scenario.shares;
  const unquantified = scenario.unquantified;
  // The rail names only the three largest uplifts so it reads like the
  // prototype's Top 3; the chart math still combines every quantified share.
  const topQuantified = [...quantified]
    .sort((left, right) => right.highMinorUnits - left.highMinorUnits)
    .slice(0, 3);
  // The Growth Intelligence workspace keeps recommendations behind a hash tab
  // (see growth-intelligence-workspace.tsx TAB_IDS); deep-link straight there.
  const recommendationsHref = `/organizations/${organizationId}/growth-intelligence#recommendations`;

  function proposeEstimates() {
    setProposeError(null);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/organizations/${organizationId}/revenue/proposals`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
        });
        const body = (await response.json().catch(() => null)) as {
          scenario?: RevenueScenario;
          aiNote?: string;
          message?: string;
        } | null;
        if (!response.ok || !body?.scenario) {
          throw new Error(body?.message ?? "The proposal could not be prepared.");
        }
        setProposed(body.scenario);
        setAiNote(body.aiNote ?? null);
      } catch {
        setProposeError(
          "Rough estimates are unavailable right now — the current course above still stands.",
        );
      }
    });
  }

  return (
    <section id="home-revenue" aria-label="Current vs projected growth" className={styles.revenue}>
      <Card className="gap-0 overflow-hidden rounded-2xl py-0">
        <div className={styles.revenueHead}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>Current vs projected growth</h2>
            <StatusBadge label="Rough estimate" tone="neutral" />
          </div>
        </div>
        <div className={styles.revenueGrid}>
          <div className={styles.revenueMain}>
            <div
              className={styles.revenueHorizonRow}
              role="group"
              aria-label="Projection horizon in months"
            >
              {REVENUE_HORIZON_MONTHS.map((option) => (
                <Button
                  key={option}
                  variant={months === option ? "secondary" : "ghost"}
                  size="sm"
                  aria-pressed={months === option}
                  onClick={() => setMonths(option)}
                >
                  {option}M
                </Button>
              ))}
            </div>
            <ScenarioFigures scenario={scenario} months={months} />
            <ScenarioChart scenario={scenario} months={months} />
            <ul className={styles.revenueLegend} aria-label="Chart key">
              <li>
                <span className={styles.revenueSwatchSolid} aria-hidden="true" /> Reported revenue
              </li>
              <li>
                <span className={styles.revenueSwatchDashed} aria-hidden="true" /> Current course
              </li>
              <li>
                <span className={styles.revenueSwatchRange} aria-hidden="true" /> With the included
                actions (range)
              </li>
            </ul>
            {scenario.stalenessGap && scenario.gapNote ? (
              <p className={styles.revenueGap}>{scenario.gapNote}</p>
            ) : null}
            <p className={styles.revenueLine}>{scenario.cutoffNote}</p>
            <p className={styles.revenueLine}>{scenario.coverageNote}</p>
          </div>
          <Separator className="hidden h-full lg:block" orientation="vertical" />
          <Separator className="lg:hidden" />
          <div className={styles.revenueSide}>
            {topQuantified.length > 0 ? (
              <>
                <h3 className={styles.revenueSideTitle}>Top 3 AI recommendations</h3>
                <ul className={styles.revenueActionList}>
                  {topQuantified.map((share) => {
                    const shareLabel =
                      share.shareLow !== null && share.shareHigh !== null
                        ? share.shareLow === share.shareHigh
                          ? `${share.shareHigh}%`
                          : `${share.shareLow}–${share.shareHigh}%`
                        : share.shareHigh !== null
                          ? `${share.shareHigh}%`
                          : null;
                    return (
                      <li key={share.actionId}>
                        <ActionLink href={share.href} title={share.title} />
                        <p className={styles.revenueActionFigure}>
                          {`+${formatWholeMoney(share.lowMinorUnits, scenario.currency)} – +${formatWholeMoney(share.highMinorUnits, scenario.currency)}${shareLabel ? ` · ${shareLabel} of estimated upside` : ""}`}
                        </p>
                        <p className={styles.revenueActionMeta}>
                          <StatusBadge label={share.status} tone="neutral" />{" "}
                          {share.jointGroup ? (
                            <StatusBadge label="Shared figure" tone="warning" />
                          ) : null}{" "}
                          {`Cites ${share.citedFindingId.slice(0, 8)}…`}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : null}
            {quantified.length === 0 && unquantified.length === 0 ? (
              <p className={styles.emptyNote}>No recommended actions are on file yet.</p>
            ) : null}
            {unquantified.length > 0 ? (
              <>
                <h3 className={styles.revenueSideTitle}>Not yet quantified</h3>
                <ul className={styles.revenueActionList}>
                  {unquantified.slice(0, 3).map((action) => (
                    <UnquantifiedRow key={action.actionId} action={action} />
                  ))}
                </ul>
                <Button onClick={proposeEstimates} disabled={pending} variant="secondary">
                  {pending ? "Preparing rough estimates…" : "Propose rough estimates"}
                </Button>
                {proposeError ? (
                  <Alert>
                    <AlertDescription>{proposeError}</AlertDescription>
                  </Alert>
                ) : null}
              </>
            ) : null}
            <div className={styles.revenueViewMoreRow}>
              <Button variant="link" size="sm" asChild className={styles.revenueViewMore}>
                <Link href={recommendationsHref}>
                  View more <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
        <div className={styles.revenueFoot}>
          <ul className={styles.revenueNotes}>
            {scenario.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
            {aiNote ? <li>{aiNote}</li> : null}
          </ul>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost">How this outlook is worked out</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>How this outlook is worked out</DialogTitle>
                <DialogDescription>
                  A hold-current-level scenario plus a combined range over the listed actions.
                </DialogDescription>
              </DialogHeader>
              <ul className={styles.revenueNotes}>
                <li>
                  Baseline method: {scenario.baselineMethod} — the latest reported level carried
                  flat across {scenario.horizonLabel}. A scenario, never a learned forecast.
                </li>
                <li>
                  Each unit of upside traces to a listed action and its cited input; joint groups
                  share one figure until a defensible allocation rule is approved.
                </li>
                <li>
                  Wide bands, never precise lines. Unquantified actions stay visible beside the
                  scenario and are never counted as zero.
                </li>
              </ul>
            </DialogContent>
          </Dialog>
        </div>
      </Card>
    </section>
  );
}
