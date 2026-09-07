import Link from "next/link";
import {
  Cable,
  Check,
  CircleDashed,
  Clock,
  Fingerprint,
  Receipt,
  Settings2,
  ShieldCheck,
  TrendingUp,
  Waypoints,
} from "lucide-react";

import { formatCount, formatMoney, formatPercent } from "@/components/analysis/format";
import { HealthStatusBadge } from "@/components/integrations/health-status";
import { OrganizationManagement } from "@/components/organizations/digital-twin-workspace";
import {
  channelColors,
  OverviewChannelMix,
  OverviewTrendChart,
} from "@/components/organizations/overview-visuals";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import type { DigitalTwinSnapshot } from "@/modules/organizations/infrastructure/repository";
import type {
  DigitalTwinReadiness,
  getOverviewPermissions,
  OverviewActionItem,
  OverviewComparison,
  OverviewEconomics,
  OverviewIntegration,
  OverviewMoneyScale,
} from "@/modules/organizations/application/overview";

/**
 * The organization overview, as a report rather than a dashboard.
 *
 * Structure is deliberately the channel workspace's: a full-bleed verdict band
 * over a Sales / Costs / Kept scale, a strip stating exactly what is on screen,
 * a flat chapter map, then chapters that pair an eight-column card with a
 * four-column rail carrying one figure, one sentence and one way into the
 * evidence. Two routes that answer different questions should still read as one
 * product. See `docs/design/overview-redesign/`.
 *
 * Every sentence here is written for a member who does not work in analytics,
 * and stays industry-neutral: "items you sell", never "dishes". An industry
 * pack supplies its own nouns.
 */

type Permissions = ReturnType<typeof getOverviewPermissions>;
type EconomicsResult = { status: "ready"; data: OverviewEconomics } | { status: "failed" };
type IntegrationResult =
  | { status: "disabled" }
  | { status: "failed" }
  | { status: "ready"; data: OverviewIntegration };

export function OverviewReport({
  snapshot,
  readiness,
  permissions,
  reportingWindow,
  economics,
  integration,
  scale,
  comparison,
  actions,
}: Readonly<{
  snapshot: DigitalTwinSnapshot;
  readiness: DigitalTwinReadiness;
  permissions: Permissions;
  reportingWindow: OverviewEconomics["window"];
  economics: EconomicsResult;
  integration: IntegrationResult;
  scale: OverviewMoneyScale | null;
  comparison: OverviewComparison | null;
  actions: readonly OverviewActionItem[];
}>) {
  const organization = snapshot.organization;
  const timeZone = organization.default_timezone;
  const data = economics.status === "ready" ? economics.data : null;
  const hasTrade = data !== null && data.state === "ready";

  return (
    <div className="flex w-full min-w-0 flex-col gap-8">
      <VerdictBand
        organizationName={organization.name}
        scale={scale}
        economicsFailed={economics.status === "failed"}
        window={reportingWindow}
        gradeCounts={data?.gradeCounts ?? null}
      />

      <StatusStrip
        economics={economics}
        integration={integration}
        window={reportingWindow}
        snapshot={snapshot}
        timeZone={timeZone}
      />

      <ChapterMap hasTrade={hasTrade} />

      <section aria-label="Overview chapters" className="flex flex-col gap-10">
        <NeedsYouChapter actions={actions} />
        {hasTrade ? (
          <MoneyInChapter data={data} comparison={comparison} timeZone={timeZone} />
        ) : (
          <NoTradeChapter failed={economics.status === "failed"} />
        )}
        {hasTrade ? <ChannelMixChapter data={data} /> : null}
        {hasTrade ? <SolidityChapter data={data} /> : null}
        <ProfileChapter
          readiness={readiness}
          integration={integration}
          organizationId={organization.id}
        />
      </section>

      <ChangedSection snapshot={snapshot} timeZone={timeZone} />
      <AwaitingShelf data={data} />
      <ReportFooter organization={organization} canManageCore={permissions.canManageCore} />

      {/* Editing the organization's own record stays on this route rather than
          disappearing with the card that used to hold it. The footer's
          "Manage organization" link is this anchor. */}
      {permissions.canManageCore ? (
        <OrganizationManagement
          organizationId={organization.id}
          snapshot={snapshot}
          permissions={permissions}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Verdict band
// ---------------------------------------------------------------------------

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * The one sentence the page leads with, saying only what the ledger supports.
 *
 * Three shapes, and the wording itself tells the reader which one they are in:
 * an exact figure when every recorded day could state a margin, a floor and a
 * range when some could not, and a refusal when there is nothing to report. No
 * shape substitutes a guess for the part it cannot state.
 */
function VerdictBand({
  organizationName,
  scale,
  economicsFailed,
  window,
  gradeCounts,
}: {
  organizationName: string;
  scale: OverviewMoneyScale | null;
  economicsFailed: boolean;
  window: OverviewEconomics["window"];
  gradeCounts: OverviewEconomics["gradeCounts"] | null;
}) {
  const recordedDays = gradeCounts
    ? gradeCounts.complete + gradeCounts.partial + gradeCounts.indicative
    : 0;

  return (
    <section
      aria-label="Where you stand"
      // Full-bleed: negative margins escape the shell's horizontal padding so
      // the tint runs edge to edge, with its own padding re-applied inside.
      className="-mx-4 border-b border-border bg-emerald-50/40 px-4 py-14 sm:-mx-8 sm:px-8 lg:py-16"
    >
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <div className="flex flex-col gap-6 lg:col-span-7">
          <div className="flex items-center gap-2.5">
            <span
              className={
                scale
                  ? "flex size-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600"
                  : "flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground"
              }
            >
              <ShieldCheck aria-hidden="true" className="size-4" />
            </span>
            <Kicker>
              {organizationName} ·{" "}
              {scale ? formatWindowLabel(window) : "nothing recorded yet"}
            </Kicker>
          </div>

          <p className="max-w-2xl text-3xl font-bold leading-[1.1] tracking-[-0.03em] text-pretty lg:text-[42px]">
            {economicsFailed ? (
              "We could not read your figures just now."
            ) : scale === null ? (
              "We cannot tell you anything about your money yet."
            ) : scale.hasUnprovenBand ? (
              <>
                You took in{" "}
                <Money value={scale.salesMinor} currency={scale.currency} /> and kept at least{" "}
                <Money value={scale.keptFloorMinor} currency={scale.currency} /> of it.
              </>
            ) : (
              <>
                You took in{" "}
                <Money value={scale.salesMinor} currency={scale.currency} /> and kept{" "}
                <Money value={scale.keptFloorMinor} currency={scale.currency} /> of it.
              </>
            )}
          </p>

          <p className="max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
            {economicsFailed
              ? "The ledger could not be checked, and no figure has been substituted for the one that is missing. Everything else on this page is current."
              : scale === null
                ? "That is not a fault — nothing has reached us for this window. Once sales arrive, this becomes a plain sentence about what you took in and what you kept. We will not guess in the meantime."
                : scale.hasUnprovenBand
                  ? unprovenSentence(scale, gradeCounts)
                  : `Every one of the ${formatCount(recordedDays)} recorded day${recordedDays === 1 ? "" : "s"} has its costs behind it, so that is an exact figure rather than a range.`}
          </p>

          <div className="flex flex-wrap items-center gap-2.5">
            {gradeCounts && recordedDays > 0 ? (
              <Chip tone={gradeCounts.complete === recordedDays ? "success" : "warning"}>
                {formatCount(gradeCounts.complete)} of {formatCount(recordedDays)} days fully
                costed
              </Chip>
            ) : null}
            {scale ? <Chip tone="success">Your own records — nothing estimated</Chip> : null}
          </div>
        </div>

        <div className="flex flex-col gap-6 lg:col-span-5">
          <MoneyScale scale={scale} />
        </div>
      </div>
    </section>
  );
}

function unprovenSentence(
  scale: OverviewMoneyScale,
  gradeCounts: OverviewEconomics["gradeCounts"] | null,
): React.ReactNode {
  const incomplete = gradeCounts ? gradeCounts.partial + gradeCounts.indicative : 0;
  const recorded = gradeCounts
    ? gradeCounts.complete + gradeCounts.partial + gradeCounts.indicative
    : 0;
  return (
    <>
      {incomplete > 0 ? (
        <>
          {formatCount(incomplete)} of the {formatCount(recorded)} days{" "}
          {incomplete === 1 ? "is" : "are"} missing cost figures, so what you really kept is
          somewhere between{" "}
        </>
      ) : (
        <>Some costs are not recorded yet, so what you really kept is somewhere between </>
      )}
      <span className="font-mono font-semibold text-foreground tabular-nums">
        {formatMoney(scale.keptFloorMinor, scale.currency)}
      </span>{" "}
      and{" "}
      <span className="font-mono font-semibold text-foreground tabular-nums">
        {formatMoney(scale.keptCeilingMinor, scale.currency)}
      </span>
      . Fill them in and the range becomes one number.
    </>
  );
}

function Money({ value, currency }: { value: number; currency: string }) {
  return (
    <span className="whitespace-nowrap font-mono font-bold text-emerald-600 tabular-nums">
      {formatMoney(value, currency)}
    </span>
  );
}

function Chip({ tone, children }: { tone: "success" | "warning"; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold">
      <span
        aria-hidden="true"
        className={tone === "success" ? "size-1.5 rounded-full bg-success" : "size-1.5 rounded-full bg-warning"}
      />
      {children}
    </span>
  );
}

/**
 * Sales, costs recorded, and kept, each bar's height its own share of sales.
 *
 * The kept bar carries a dashed outline at the ceiling the evidence allows, so
 * the part that cannot be confirmed has a size on screen rather than only a
 * caveat in prose. No bar is drawn at all when there is no window to describe,
 * because an empty scale reads as a measurement of zero.
 */
function MoneyScale({ scale }: { scale: OverviewMoneyScale | null }) {
  if (scale === null || scale.salesMinor <= 0) {
    return (
      <div
        role="img"
        aria-label="No sales, costs and kept split can be stated for this window."
        className="flex min-h-24 items-center rounded-lg border border-dashed border-border bg-card/60 px-4 text-xs leading-relaxed text-muted-foreground"
      >
        The sales, costs and kept split cannot be stated for this window yet.
      </div>
    );
  }

  const share = (value: number) => Math.min(Math.round((value / scale.salesMinor) * 100), 100);
  const bars = [
    { label: "Sales", value: scale.salesMinor, tone: "neutral" as const, ceiling: null },
    { label: "Costs", value: scale.costsRecordedMinor, tone: "neutral" as const, ceiling: null },
    {
      label: "Kept",
      value: scale.keptFloorMinor,
      tone: "success" as const,
      ceiling: scale.hasUnprovenBand ? share(scale.keptCeilingMinor) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div
        role="img"
        aria-label={`Sales ${formatMoney(scale.salesMinor, scale.currency)}; costs recorded ${formatMoney(scale.costsRecordedMinor, scale.currency)}; kept ${scale.hasUnprovenBand ? "at least " : ""}${formatMoney(scale.keptFloorMinor, scale.currency)}${scale.hasUnprovenBand ? `, and at most ${formatMoney(scale.keptCeilingMinor, scale.currency)}` : ""}.`}
        className="relative flex h-56 w-full items-end gap-3 px-6 pb-4"
      >
        <span aria-hidden="true" className="absolute bottom-8 left-0 right-0 h-px bg-border" />
        {bars.map((bar) => (
          <div key={bar.label} className="flex flex-1 flex-col items-center gap-3">
            <span
              className={
                bar.tone === "success"
                  ? "font-mono text-sm font-bold text-emerald-600"
                  : "font-mono text-sm font-bold text-foreground"
              }
            >
              {formatMoney(bar.value, scale.currency)}
            </span>
            {/* Fixed-height track so a percentage resolves against real pixels. */}
            <div className="relative flex h-40 w-full items-end">
              {bar.ceiling !== null ? (
                <div
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 rounded-t-[2px] border border-dashed border-emerald-500"
                  style={{ height: `${bar.ceiling}%` }}
                />
              ) : null}
              <div
                className={
                  bar.tone === "success"
                    ? "w-full rounded-t-[2px] bg-emerald-500"
                    : "w-full rounded-t-[2px] bg-slate-200"
                }
                style={{ height: `${share(bar.value)}%` }}
              />
            </div>
            <span
              className={
                bar.tone === "success"
                  ? "text-[10px] font-bold uppercase tracking-widest text-emerald-600"
                  : "text-[10px] font-bold uppercase tracking-widest text-muted-foreground"
              }
            >
              {bar.label}
            </span>
          </div>
        ))}
      </div>
      {scale.hasUnprovenBand ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          The dashed outline is the ceiling — where “kept” could reach once the missing costs are
          recorded. “Costs” counts only what was actually recorded, never sales minus kept.
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status strip and chapter map
// ---------------------------------------------------------------------------

/** What is on screen, stated exactly. A rounded month name would be a claim. */
function StatusStrip({
  economics,
  integration,
  window,
  snapshot,
  timeZone,
}: {
  economics: EconomicsResult;
  integration: IntegrationResult;
  window: OverviewEconomics["window"];
  snapshot: DigitalTwinSnapshot;
  timeZone: string;
}) {
  const stopped =
    integration.status === "ready" ? integration.data.actionRequiredConnections : 0;
  const lastEvent = snapshot.auditEvents[0];

  return (
    <div
      aria-label="Reporting status"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-xs"
    >
      {economics.status === "failed" ? (
        <>
          <StatusBadge label="Unavailable" tone="danger" />
          <span className="text-muted-foreground">
            Your figures could not be read for this window.
          </span>
        </>
      ) : economics.data.state === "empty" ? (
        <>
          <StatusBadge label="Nothing recorded" tone="neutral" />
          <span className="text-muted-foreground">
            No sales have reached your records for {isoDate(window.rangeStart)} to{" "}
            {isoDate(window.rangeEndExclusive, -1)}.
          </span>
        </>
      ) : (
        <>
          <StatusBadge label="Showing" tone="success" />
          <span className="text-muted-foreground">
            your own records for{" "}
            <span className="font-mono">{isoDate(window.rangeStart)}</span> to{" "}
            <span className="font-mono">{isoDate(window.rangeEndExclusive, -1)}</span> ·{" "}
            {window.timeZone} · day by day
          </span>
        </>
      )}
      {stopped > 0 ? (
        <StatusBadge
          label={`${stopped} connection${stopped === 1 ? "" : "s"} stopped`}
          tone="warning"
        />
      ) : null}
      {lastEvent ? (
        <span className="ml-auto text-muted-foreground">
          Last change {formatInstant(lastEvent.occurred_at, timeZone)}
        </span>
      ) : null}
    </div>
  );
}

/** A flat map of the report. The narrative is meant to be scrolled, not navigated around. */
function ChapterMap({ hasTrade }: { hasTrade: boolean }) {
  const entries = [
    ["needs-you", "What needs you"],
    ["money-in", "Money in"],
    ...(hasTrade
      ? ([
          ["channel-mix", "Which places"],
          ["solidity", "How solid"],
        ] as const)
      : []),
    ["profile", "What we know"],
    ["changed", "What changed"],
  ] as const;

  return (
    <nav aria-label="Overview sections">
      <ul className="flex flex-wrap items-center gap-x-1 gap-y-1">
        {entries.map(([id, label]) => (
          <li key={id}>
            <Link
              href={`#${id}`}
              className="block whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Chapter shell
// ---------------------------------------------------------------------------

function Chapter({
  id,
  number,
  heading,
  description,
  state,
  children,
  rail,
}: {
  id: string;
  number: number;
  heading: string;
  description: string;
  state: React.ReactNode;
  children: React.ReactNode;
  rail: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-label={`${heading} chapter`}
      // `items-start` because a grid item stretches to its row by default, and
      // a brief chapter would otherwise draw its card border around a screenful
      // of nothing — which reads as content that failed to load.
      className="grid scroll-mt-24 grid-cols-1 items-start gap-6 lg:grid-cols-12"
    >
      <Card className="lg:col-span-8">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                {String(number).padStart(2, "0")} · {heading}
              </CardTitle>
              <CardDescription className="text-xs">{description}</CardDescription>
            </div>
            {state}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">{children}</CardContent>
      </Card>
      <aside aria-label={`${heading} figures`} className="flex flex-col gap-8 lg:col-span-4">
        {rail}
      </aside>
    </section>
  );
}

function Rail({
  figure,
  figureClass = "text-foreground",
  reason,
  children,
}: {
  figure: string;
  figureClass?: string;
  reason: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <>
      <div className="flex flex-col gap-3">
        <p className={`font-mono text-4xl font-bold tracking-tight tabular-nums ${figureClass}`}>
          {figure}
        </p>
        <div className="text-[15px] leading-relaxed text-muted-foreground">{reason}</div>
      </div>
      {children}
    </>
  );
}

/** One stored ratio as a split bar, the fill being the numerator's share. */
function RatioBar({
  label,
  numerator,
  denominator,
  tone,
  note,
}: {
  label: string;
  numerator: number;
  denominator: number;
  tone: "success" | "warning" | "neutral";
  note?: string;
}) {
  const percent = denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);
  // Below ~18% a label inside the segment clips; it moves to the legend instead.
  const labelInside = percent >= 18;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="text-[11px] font-semibold tabular-nums">
          {formatCount(numerator)} of {formatCount(denominator)}
        </span>
      </div>
      <div
        role="img"
        aria-label={`${label}: ${numerator} of ${denominator}.`}
        className="flex h-8 w-full overflow-hidden rounded-lg bg-muted"
      >
        <div
          className={`flex h-full items-center px-3 ${labelInside ? "justify-start" : "justify-end"} ${
            tone === "success"
              ? "bg-chart-2"
              : tone === "warning"
                ? "bg-warning"
                : "bg-foreground/35"
          }`}
          style={{ width: `${percent}%` }}
        >
          {labelInside ? (
            <span className="text-[10px] font-bold tabular-nums text-white">{percent}%</span>
          ) : null}
        </div>
      </div>
      {!labelInside || note ? (
        <p className="text-[11px] leading-snug tabular-nums text-muted-foreground">
          {labelInside ? note : `${percent}% of the base.${note ? ` ${note}` : ""}`}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

function NeedsYouChapter({ actions }: { actions: readonly OverviewActionItem[] }) {
  return (
    <Chapter
      id="needs-you"
      number={1}
      heading="What needs you"
      description="Each one is holding back a number on this page."
      state={
        actions.length === 0 ? (
          <StatusBadge label="Nothing open" tone="success" />
        ) : (
          <StatusBadge label="Needs you" tone="warning" />
        )
      }
      rail={
        actions.length === 0 ? (
          <Rail
            figure="0 open"
            reason="Nothing on this page is waiting on you. That reflects the records we hold, not a promise that the business itself is healthy."
          />
        ) : (
          <Rail
            figure={`${formatCount(actions.length)} open`}
            reason={`${actions.length === 1 ? "One thing is" : `${formatCount(actions.length)} things are`} holding a number back on this page, and none of them can be done for you.`}
          />
        )
      }
    >
      {actions.length === 0 ? (
        <div className="flex items-start gap-3 rounded-lg border border-border p-4">
          <Check aria-hidden="true" className="size-4 shrink-0 text-success" />
          <div>
            <p className="text-sm font-semibold">No blocking gap is visible</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Everything this page needs from you is on file.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border">
          {actions.map((action) => (
            <div
              key={`${action.kind}:${action.title}`}
              className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-x-3.5 gap-y-2.5 p-3.5 sm:grid-cols-[1.75rem_minmax(0,1fr)_auto] sm:items-center"
            >
              <span
                className={
                  action.kind === "foundation"
                    ? "flex size-7 items-center justify-center rounded-[0.5625rem] bg-muted text-muted-foreground"
                    : "flex size-7 items-center justify-center rounded-[0.5625rem] bg-warning/20 text-foreground"
                }
              >
                {action.kind === "integration" ? (
                  <Cable aria-hidden="true" className="size-3.5" />
                ) : action.kind === "economics" ? (
                  <Receipt aria-hidden="true" className="size-3.5" />
                ) : (
                  <ShieldCheck aria-hidden="true" className="size-3.5" />
                )}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13px] font-semibold">{action.title}</span>
                <span className="text-[11px] leading-snug text-muted-foreground">
                  {action.impact}
                </span>
              </span>
              {action.href && action.actionLabel ? (
                <Button
                  asChild
                  size="sm"
                  variant={action.kind === "economics" ? "default" : "outline"}
                  className="col-span-2 w-full sm:col-span-1 sm:w-auto"
                >
                  <Link href={action.href}>{action.actionLabel}</Link>
                </Button>
              ) : (
                <StatusBadge label="Read only" tone="neutral" />
              )}
            </div>
          ))}
        </div>
      )}
    </Chapter>
  );
}

function MoneyInChapter({
  data,
  comparison,
  timeZone,
}: {
  data: OverviewEconomics;
  comparison: OverviewComparison | null;
  timeZone: string;
}) {
  const salesMinor = data.trend.reduce((total, point) => total + point.grossRevenueMinor, 0);
  const currency = data.currency ?? "AED";

  return (
    <Chapter
      id="money-in"
      number={2}
      heading="What came in, day by day"
      description="Every point is one trading day, exactly as recorded. Days left blank are absent, not zero."
      state={<StatusBadge label="Reported" tone="success" />}
      rail={
        <Rail
          figure={formatMoney(salesMinor, currency)}
          figureClass="text-emerald-600"
          reason={
            comparison ? (
              <>
                <span className="mb-2 flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold ${
                      comparison.deltaMinor >= 0
                        ? "bg-success/12 text-success"
                        : "bg-destructive/10 text-destructive"
                    }`}
                  >
                    <TrendingUp aria-hidden="true" className="size-3" />
                    {comparison.deltaMinor >= 0 ? "+" : "−"}
                    {formatPercent(Math.abs(comparison.deltaMinor), comparison.priorMinor)}
                  </span>
                  <span className="text-xs">on the window before</span>
                </span>
                {comparison.deltaMinor >= 0 ? "Up from " : "Down from "}
                <span className="font-mono font-semibold text-foreground tabular-nums">
                  {formatMoney(comparison.priorMinor, comparison.currency)}
                </span>{" "}
                in the previous window of the same length.
              </>
            ) : (
              "There is no earlier window with recorded trade to compare this against, so no change is stated."
            )
          }
        />
      }
    >
      <OverviewTrendChart trend={data.trend} currency={currency} timeZone={timeZone} />
      <p className="text-xs leading-relaxed text-muted-foreground">{data.takeaway}</p>
    </Chapter>
  );
}

function NoTradeChapter({ failed }: { failed: boolean }) {
  return (
    <Chapter
      id="money-in"
      number={2}
      heading="What came in, day by day"
      description="Every point will be one trading day, exactly as recorded."
      state={<StatusBadge label={failed ? "Unavailable" : "Not measured"} tone="neutral" />}
      rail={
        <Rail
          figure="—"
          figureClass="text-muted-foreground"
          reason={
            failed
              ? "The ledger could not be read. No figure has been substituted for the one that is missing."
              : "No figure can be stated. A zero here would be a claim about your trading, and we have not been told anything about it."
          }
        />
      }
    >
      {failed ? (
        <Alert variant="destructive">
          <TrendingUp />
          <AlertTitle>Your figures are temporarily unavailable</AlertTitle>
          <AlertDescription>
            The rest of this page reflects records that were read successfully.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
          <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <TrendingUp aria-hidden="true" className="size-4" />
          </span>
          <p className="text-sm font-semibold">No chart is drawn — an empty one would mislead</p>
          <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
            A chart drawn over no data looks like a business with no sales. Rather than a flat line
            at zero, this stays blank until there is something real in it.
          </p>
        </div>
      )}
    </Chapter>
  );
}

function ChannelMixChapter({ data }: { data: OverviewEconomics }) {
  const currency = data.currency ?? "AED";
  const reported = data.channels.filter((channel) => channel.grossRevenueMinor > 0);
  const total = reported.reduce((sum, channel) => sum + channel.grossRevenueMinor, 0);
  const leading = [...reported].sort(
    (left, right) => right.grossRevenueMinor - left.grossRevenueMinor,
  )[0];

  return (
    <Chapter
      id="channel-mix"
      number={3}
      heading="Which places brought it in"
      description="Share of every place with a recorded revenue figure for this window."
      state={<StatusBadge label="Reported" tone="success" />}
      rail={
        <Rail
          figure={
            leading && total > 0
              ? `${formatPercent(leading.grossRevenueMinor, total)} ${readableChannel(leading.channel)}`
              : "—"
          }
          reason={
            leading && total > 0 ? (
              <>
                {readableChannel(leading.channel)} recorded the largest share. That is a comparison
                of what each place reported — not a claim that one earns you more than another.
                Which is actually most profitable depends on the costs still outstanding.
              </>
            ) : (
              "No place recorded a positive revenue figure for this window, so no share can be stated."
            )
          }
        >
          <Button
            asChild
            variant="outline"
            className="h-10 w-full justify-center gap-2.5 rounded-lg text-[11px] font-bold uppercase tracking-widest text-muted-foreground"
          >
            <Link href="#changed">
              <Waypoints aria-hidden="true" className="size-4" />
              Open all channels
            </Link>
          </Button>
        </Rail>
      }
    >
      <div className="grid items-center gap-6 sm:grid-cols-[minmax(10rem,0.8fr)_minmax(0,1fr)]">
        <OverviewChannelMix channels={data.channels} currency={currency} />
        <ul className="flex min-w-0 flex-col gap-0.5" aria-label="Recorded revenue by place">
          {reported.map((channel, index) => (
            <li
              key={channel.channel}
              className="flex items-center gap-2.5 rounded-md px-2 py-1.5"
            >
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: channelColors[index % channelColors.length] }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">
                  {readableChannel(channel.channel)}
                </span>
                <span className="block truncate font-mono text-[11px] tabular-nums text-muted-foreground">
                  {formatMoney(channel.grossRevenueMinor, currency)} ·{" "}
                  {formatPercent(channel.grossRevenueMinor, total)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Chapter>
  );
}

function SolidityChapter({ data }: { data: OverviewEconomics }) {
  const { complete, partial, indicative } = data.gradeCounts;
  const recorded = complete + partial + indicative;

  return (
    <Chapter
      id="solidity"
      number={4}
      heading="How solid these numbers are"
      description="The same days, graded by what evidence sits behind each one."
      state={
        complete === recorded ? (
          <StatusBadge label="Complete" tone="success" />
        ) : (
          <StatusBadge label="Needs data" tone="warning" />
        )
      }
      rail={
        <Rail
          figure={`${formatCount(complete)} of ${formatCount(recorded)}`}
          reason={
            complete === recorded
              ? "Every recorded day can state an exact profit, so the headline is one number rather than a range."
              : `${formatCount(complete)} day${complete === 1 ? "" : "s"} can state an exact profit. The other ${formatCount(recorded - complete)} ${recorded - complete === 1 ? "is" : "are"} why the headline is a range.`
          }
        >
          <Button
            asChild
            variant="outline"
            className="h-10 w-full justify-center gap-2.5 rounded-lg text-[11px] font-bold uppercase tracking-widest text-muted-foreground"
          >
            <Link href="#needs-you">
              <Fingerprint aria-hidden="true" className="size-4" />
              What is missing
            </Link>
          </Button>
        </Rail>
      }
    >
      <RatioBar
        label="Days with sales and every cost recorded"
        numerator={complete}
        denominator={recorded}
        tone="success"
        note="Profit for these days is exact."
      />
      {partial > 0 ? (
        <RatioBar
          label="Days where some costs are missing"
          numerator={partial}
          denominator={recorded}
          tone="warning"
          note="Profit for these days is close, but not final."
        />
      ) : null}
      {indicative > 0 ? (
        <RatioBar
          label="Days with sales only, no costs at all"
          numerator={indicative}
          denominator={recorded}
          tone="neutral"
          note="No profit is claimed for these days at all."
        />
      ) : null}
    </Chapter>
  );
}

function ProfileChapter({
  readiness,
  integration,
  organizationId,
}: {
  readiness: DigitalTwinReadiness;
  integration: IntegrationResult;
  organizationId: string;
}) {
  return (
    <Chapter
      id="profile"
      number={5}
      heading="What we know about you"
      description="The more of this is on file, the more specific the advice above can get."
      state={
        readiness.groundedCount === readiness.totalCount ? (
          <StatusBadge label="Complete" tone="success" />
        ) : (
          <StatusBadge label="Needs data" tone="warning" />
        )
      }
      rail={
        <Rail
          figure={`${formatCount(readiness.groundedCount)} of ${formatCount(readiness.totalCount)}`}
          reason={
            readiness.missingLabels.length === 0
              ? "Everything we ask for is on file."
              : `Still missing: ${readiness.missingLabels.join(", ").toLowerCase()}.`
          }
        >
          <Button
            asChild
            variant="outline"
            className="h-10 w-full justify-center gap-2.5 rounded-lg text-[11px] font-bold uppercase tracking-widest text-muted-foreground"
          >
            <Link href="#organization-management">
              <Settings2 aria-hidden="true" className="size-4" />
              Open your business profile
            </Link>
          </Button>
        </Rail>
      }
    >
      <ul className="grid gap-2 sm:grid-cols-2">
        {readiness.sections.map((section) => (
          <li
            key={section.key}
            className={
              section.complete
                ? "flex items-start gap-2.5 rounded-lg bg-success/6 px-3 py-2.5"
                : "flex items-start gap-2.5 rounded-lg bg-muted px-3 py-2.5 ring-1 ring-border"
            }
          >
            {section.complete ? (
              <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            ) : (
              <CircleDashed aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
            )}
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold">{section.label}</span>
              <span className="block text-[11px] text-muted-foreground">{section.detail}</span>
            </span>
          </li>
        ))}
      </ul>

      {integration.status === "disabled" ? null : (
        <div className="flex items-center justify-between gap-4 border-t border-border pt-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <Cable aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            {integration.status === "failed" ? (
              <p className="text-xs text-muted-foreground">
                Connection health could not be checked just now.
              </p>
            ) : (
              <p className="min-w-0 truncate text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {integration.data.healthyConnections} of {integration.data.totalConnections}{" "}
                  connections working.
                </span>{" "}
                {integration.data.connections[0] ? (
                  <>
                    {integration.data.connections[0].accountLabel}:{" "}
                    {integration.data.connections[0].explanation}
                  </>
                ) : null}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {integration.status === "ready" && integration.data.connections[0] ? (
              <HealthStatusBadge state={integration.data.connections[0].state} />
            ) : null}
            <Button asChild variant="ghost" size="sm">
              <Link href={`/organizations/${organizationId}/integrations`}>Integration Hub</Link>
            </Button>
          </div>
        </div>
      )}
    </Chapter>
  );
}

// ---------------------------------------------------------------------------
// Closing sections
// ---------------------------------------------------------------------------

function ChangedSection({
  snapshot,
  timeZone,
}: {
  snapshot: DigitalTwinSnapshot;
  timeZone: string;
}) {
  const recent = snapshot.auditEvents.slice(0, 4);

  return (
    <section
      id="changed"
      aria-label="What changed recently"
      className="flex scroll-mt-24 flex-col gap-3 border-t border-border pt-8"
    >
      <Kicker>What changed recently</Kicker>
      {recent.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[11px] leading-relaxed text-muted-foreground">
          Nothing has changed yet. Governed changes to your records appear here, with who made
          them.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {recent.map((event) => (
            <div
              key={event.id}
              className="grid grid-cols-1 gap-1.5 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-center sm:gap-3"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-xs font-semibold">
                  {readableKey(event.event_name)}
                </span>
                <span className="text-[11px] leading-snug text-muted-foreground">
                  {readableKey(event.entity_type)}
                </span>
              </span>
              <StatusBadge label={event.actor_type} tone="neutral" />
              <time
                className="font-mono text-[11px] tabular-nums text-muted-foreground"
                dateTime={event.occurred_at}
              >
                {formatInstant(event.occurred_at, timeZone)}
              </time>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * What this page will hold later, each entry naming what it waits on in its own
 * terms. Paraphrasing a data dependency is how wrong promises about "soon" get
 * written, so nothing here is dated.
 */
function AwaitingShelf({ data }: { data: OverviewEconomics | null }) {
  const incomplete = data ? data.gradeCounts.partial + data.gradeCounts.indicative : null;
  const recorded = data
    ? data.gradeCounts.complete + data.gradeCounts.partial + data.gradeCounts.indicative
    : 0;

  const pending = [
    {
      title: "What to promote next",
      reason:
        incomplete === null || incomplete > 0
          ? `Waits on one window where every recorded day has its costs behind it${
              incomplete !== null && recorded > 0
                ? `. Right now that is ${formatCount(recorded - incomplete)} of ${formatCount(recorded)} days`
                : ""
            }.`
          : "Waits on a longer run of costed trade than this window holds.",
    },
    {
      title: "Which of your items actually pay",
      reason:
        "Waits on a cost for every item you sell. A ranking missing part of the range would mislead more than it helps.",
    },
    {
      title: "How you compare to similar businesses",
      reason:
        "Waits on enough comparable organizations agreeing to share. Not yet reached.",
    },
  ];

  return (
    <section
      aria-label="Not ready yet"
      className="flex flex-col gap-4 rounded-xl border border-border bg-muted/30 p-6"
    >
      <div className="flex items-center gap-2">
        <Clock aria-hidden="true" className="size-3.5 text-muted-foreground" />
        <Kicker>Not ready yet</Kicker>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {pending.map((entry) => (
          <article
            key={entry.title}
            aria-label={entry.title}
            className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4"
          >
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {entry.title}
            </span>
            <p className="text-xs leading-relaxed text-muted-foreground">{entry.reason}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ReportFooter({
  organization,
  canManageCore,
}: {
  organization: DigitalTwinSnapshot["organization"];
  canManageCore: boolean;
}) {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6 text-xs">
      <dl className="flex flex-wrap items-center gap-x-6 gap-y-1">
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Organization</dt>
          <dd className="font-mono">{organization.slug}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Currency</dt>
          <dd className="font-mono">{organization.base_currency}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Timezone</dt>
          <dd className="font-mono">{organization.default_timezone}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="sr-only">Basis</dt>
          <dd>
            <StatusBadge label="Your own records · no estimates" tone="neutral" />
          </dd>
        </div>
      </dl>
      <div className="flex items-center gap-2">
        {canManageCore ? (
          <Button asChild variant="outline" size="sm">
            <Link href="#organization-management">Manage organization</Link>
          </Button>
        ) : null}
        <Button asChild variant="ghost" size="sm">
          <Link href={`/organizations/${organization.id}/onboarding`}>Guided onboarding</Link>
        </Button>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Exact dates as recorded, never a month name that rounds the window. */
function isoDate(value: string, dayOffset = 0): string {
  const date = new Date(new Date(value).getTime() + dayOffset * 86_400_000);
  return date.toISOString().slice(0, 10);
}

function formatWindowLabel(window: OverviewEconomics["window"]): string {
  return `${isoDate(window.rangeStart)} to ${isoDate(window.rangeEndExclusive, -1)}`;
}

function formatInstant(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(new Date(value));
}

function readableKey(value: string): string {
  return value
    .split(/[_.-]/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function readableChannel(value: string): string {
  return value
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
