"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import type {
  RevenueScenario,
  RevenueScenarioReady,
} from "@/domain/organizations/revenue-scenario";
import type { OrganizationHomeView } from "@/modules/organizations/application/home-types";
import styles from "@/components/organizations/home/organization-home.module.css";

export type RevenueChartRow = {
  label: string;
  actual: number | null;
  current: number | null;
  low: number | null;
  high: number | null;
};

const FUTURE_LABEL = "Next month";

function majorExponent(currency: string): number {
  return (
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

/**
 * Chart rows in major units, oldest first with one future point. History
 * stays solid actuals; the two next-month paths start at the last reported
 * point so the boundary is drawn, never smoothed over. Grain is preserved:
 * one row per reported bucket, no interpolated days.
 */
export function buildRevenueChartRows(scenario: RevenueScenarioReady): RevenueChartRow[] {
  const exponent = majorExponent(scenario.currency);
  const toMajor = (minorUnits: number) => minorUnits / 10 ** exponent;
  const rows: RevenueChartRow[] = scenario.history.map((point) => ({
    label: point.label,
    actual: toMajor(point.minorUnits),
    current: null,
    low: null,
    high: null,
  }));
  const last = rows[rows.length - 1];
  if (last) last.current = toMajor(scenario.currentCourseMinorUnits);
  rows.push({
    label: FUTURE_LABEL,
    actual: null,
    current: toMajor(scenario.currentCourseMinorUnits),
    low: toMajor(scenario.withActionsLowMinorUnits),
    high: toMajor(scenario.withActionsHighMinorUnits),
  });
  return rows;
}

function chartAriaLabel(scenario: RevenueScenarioReady): string {
  const parts = scenario.history.map(
    (point) => `${point.label} ${formatWholeMoney(point.minorUnits, scenario.currency)}`,
  );
  return [
    `Reported revenue: ${parts.join(", ") || "none"}.`,
    `Current course next month: ${formatWholeMoney(scenario.currentCourseMinorUnits, scenario.currency)}.`,
    `With the included actions: ${formatWholeMoney(scenario.withActionsLowMinorUnits, scenario.currency)} to ${formatWholeMoney(scenario.withActionsHighMinorUnits, scenario.currency)}.`,
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

function ScenarioChart({ scenario }: { scenario: RevenueScenarioReady }) {
  const rows = buildRevenueChartRows(scenario);
  const group = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
  const max = Math.max(
    0,
    ...rows
      .flatMap((row) => [row.actual, row.current, row.low, row.high])
      .filter((value): value is number => value !== null),
  );
  const boundary = scenario.history[scenario.history.length - 1]?.label;
  return (
    <div
      className={styles.revenueChart}
      role="img"
      aria-label={`${chartAriaLabel(scenario)} ${scenario.coverageNote}.`}
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
            tickFormatter={(value: string) => (value.length > 7 ? value.slice(5) : value)}
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
            dot={false}
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

function ScenarioFigures({ scenario }: { scenario: RevenueScenarioReady }) {
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
        <dt>Current course · {scenario.horizonLabel}</dt>
        <dd>{formatWholeMoney(scenario.currentCourseMinorUnits, scenario.currency)}</dd>
        <dd className={styles.revenueFigureSub}>Hold-current-level scenario.</dd>
      </div>
      <div>
        <dt>With the included actions</dt>
        <dd>
          {formatWholeMoney(scenario.withActionsLowMinorUnits, scenario.currency)} –{" "}
          {formatWholeMoney(scenario.withActionsHighMinorUnits, scenario.currency)}
        </dd>
        <dd className={styles.revenueFigureSub}>{uplift}</dd>
      </div>
    </dl>
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
}: Readonly<{
  organizationId: string;
  section: OrganizationHomeView["revenue"];
}>) {
  const [proposed, setProposed] = useState<RevenueScenario | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
      <div className={styles.sectionHead}>
        <h2 className={styles.railTitle}>Current vs projected growth</h2>
        <StatusBadge label="Rough estimate" tone="neutral" />
      </div>
      <div className={styles.revenueGrid}>
        <div className={styles.revenueMain}>
          <ScenarioFigures scenario={scenario} />
          <ScenarioChart scenario={scenario} />
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
        <div className={styles.revenueSide}>
          <h3 className={styles.revenueSideTitle}>What the upside is made of</h3>
          {quantified.length === 0 && unquantified.length === 0 ? (
            <p className={styles.emptyNote}>No recommended actions are on file yet.</p>
          ) : null}
          {quantified.length > 0 ? (
            <ul className={styles.revenueActionList}>
              {quantified.map((share) => {
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
          ) : null}
          {unquantified.length > 0 ? (
            <>
              <h3 className={styles.revenueSideTitle}>Not yet quantified</h3>
              <ul className={styles.revenueActionList}>
                {unquantified.map((action) => (
                  <li key={action.actionId}>
                    <ActionLink href={action.href} title={action.title} />
                    <p className={styles.revenueActionMeta}>
                      <StatusBadge label={action.status} tone="neutral" /> {action.reason}
                    </p>
                  </li>
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
        </div>
      </div>
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
              Baseline method: {scenario.baselineMethod} — the latest reported level carried flat
              across {scenario.horizonLabel}. A scenario, never a learned forecast.
            </li>
            <li>
              Each unit of upside traces to a listed action and its cited input; joint groups share
              one figure until a defensible allocation rule is approved.
            </li>
            <li>
              Wide bands, never precise lines. Unquantified actions stay visible beside the scenario
              and are never counted as zero.
            </li>
          </ul>
        </DialogContent>
      </Dialog>
    </section>
  );
}
