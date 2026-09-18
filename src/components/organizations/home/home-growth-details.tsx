"use client";

import { Info } from "lucide-react";

import { formatWholeMoney } from "@/components/analysis/format";
import {
  formatFooterDay,
  formatShortDate,
} from "@/components/organizations/home/home-growth-chart";
import styles from "@/components/organizations/home/organization-home.module.css";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { GrowthProgressView } from "@/modules/organizations/application/growth-progress-view";

/**
 * Method disclosure and degraded states for the Overview growth section
 * (visual contract V05–V07).
 *
 * Like the museum label's fine print: this file says when the estimate was
 * fixed, what it covers and where every number came from. It never invents
 * an explanation, never claims the platform earned anything, and never
 * treats a Planned action as completed work. No model calls, no
 * reforecasting — every figure is read from the frozen view the loader
 * already composed.
 */

/** Human comparability for one chart date in the value table. */
export function growthDateComparability(point: {
  currentMinor: number | null;
  currentCoverage: GrowthProgressView["points"][number]["currentCoverage"];
  reasonCode: GrowthProgressView["points"][number]["reasonCode"];
}): string {
  if (point.currentCoverage === "complete" && point.currentMinor !== null) return "Reported";
  switch (point.reasonCode) {
    case "FUTURE_DATE":
      return "Future date — no current value";
    case "COVERAGE_GAP":
      return "Not reported — incomplete coverage";
    case "OVERLAP_CONFLICT":
      return "Not comparable — overlapping reports";
    case "CURRENCY_MISMATCH":
      return "Not comparable — mixed currency";
    default:
      return "Not reported";
  }
}

/**
 * V07 copy for every non-ready view state. Titles name the state plainly;
 * bodies say what is shown and what is missing. Mixed currency never plots a
 * combined amount; overlapping reports name the conflict instead of picking
 * a side.
 */
export function growthStateCopy(view: GrowthProgressView): { title: string; body: string } {
  switch (view.state) {
    case "upcoming":
      return {
        title: `Tracking starts ${formatFooterDay(view.period.startDate)}`,
        body: `The outlook for ${formatFooterDay(view.period.startDate)}–${formatFooterDay(view.period.endDateExclusive)} is set. No ahead or behind verdict yet.`,
      };
    case "awaiting_reports":
      return {
        title: "Waiting for reported revenue",
        body: "The projection is set. Current revenue reads “Awaiting reports” until the first complete report arrives.",
      };
    case "missing":
      return {
        title: "Projection not set for this period",
        body: "Reported revenue is shown where supported. The frozen estimate for this horizon is missing — nothing is estimated in its place.",
      };
    case "unavailable":
      switch (view.reasonCode) {
        case "CURRENCY_MISMATCH":
          return {
            title: "Comparison unavailable — mixed currency",
            body: "Reports in this period use more than one currency, so no combined amount is plotted. Review the source reports for the per-currency detail.",
          };
        case "OVERLAP_CONFLICT":
          return {
            title: "Comparison unavailable — overlapping reports",
            body: "Two reports claim the same dates, so no single total can be compared. Review the source reports to resolve the overlap.",
          };
        default:
          return {
            title: "Comparison unavailable for the latest reports",
            body: "Coverage for the latest reports is incomplete, so the blue line breaks instead of bridging the gap. Earlier comparable dates still stand.",
          };
      }
    case "ready":
      return { title: "", body: "" };
  }
}

/**
 * V05 method dialog. Assumptions, source coverage, the fixed issue time and
 * the accessible value table live here — not in the chart, which keeps only
 * compact labels. Radix Dialog traps focus while open and returns focus to
 * the trigger on close. Sources and advice render only what the loader
 * already permission-filtered; denied titles never reach this DOM.
 */
export function HomeGrowthMethodDialog({ view }: Readonly<{ view: GrowthProgressView }>) {
  const currency = view.currency ?? "AED";
  const issued = view.issuedAt !== null ? formatFooterDay(view.issuedAt.slice(0, 10)) : null;
  const endInclusive = (() => {
    const date = new Date(`${view.period.endDateExclusive}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return formatFooterDay(date.toISOString().slice(0, 10));
  })();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className={styles.growthMethodButton}>
          How this is estimated <Info aria-hidden="true" className={styles.growthMethodIcon} />
        </Button>
      </DialogTrigger>
      <DialogContent className={styles.growthDialog}>
        <DialogHeader>
          <DialogTitle>How this is estimated</DialogTitle>
          <DialogDescription>
            A frozen projection compared with reported revenue. An estimate with stated
            assumptions — never a promise of what will happen.
          </DialogDescription>
        </DialogHeader>
        <dl className={styles.growthMethodFacts}>
          <div>
            <dt>Estimate fixed</dt>
            <dd>{issued !== null ? `${issued} (fixed at publication)` : "Not yet fixed"}</dd>
          </div>
          <div>
            <dt>Period</dt>
            <dd>
              {formatFooterDay(view.period.startDate)}–{endInclusive} · {view.period.horizonMonths}{" "}
              {view.period.horizonMonths === 1 ? "month" : "months"}
            </dd>
          </div>
          <div>
            <dt>Coverage</dt>
            <dd>{view.scopeLabel}</dd>
          </div>
          <div>
            <dt>Sources</dt>
            <dd>
              {view.sources.length > 0
                ? view.sources.map((source) => source.label).join("; ")
                : "No source labels available"}
            </dd>
          </div>
        </dl>
        <ul className={styles.growthMethodAssumptions}>
          <li>Even-pace assumption: the central estimate spreads the period target evenly.</li>
          <li>
            Action assumptions: included actions contribute only their listed ranges; planned
            means intent, not completed work.
          </li>
          <li>
            Central and range: the dashed line is the central scenario estimate; the low–high
            band is the stored scenario range, not a calibrated promise.
          </li>
          <li>
            Revision and freshness: figures freeze at publication.{" "}
            {view.freshness.status === "stale" && view.freshness.note !== null
              ? view.freshness.note
              : "Later reports do not rewrite this estimate."}{" "}
            {view.limitations.length > 0 ? view.limitations.join(" ") : null}
          </li>
        </ul>
        <Table className={styles.growthMethodTable}>
          <TableCaption>
            Reported and estimated revenue per date in {currency}. Full amounts; the chart
            abbreviates these with k/M labels.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Date</TableHead>
              <TableHead scope="col">Current</TableHead>
              <TableHead scope="col">Projected low</TableHead>
              <TableHead scope="col">Projected central</TableHead>
              <TableHead scope="col">Projected high</TableHead>
              <TableHead scope="col">Comparability</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.points.map((point) => (
              <TableRow key={point.date}>
                <TableCell>{formatShortDate(point.date)}</TableCell>
                <TableCell>
                  {point.currentMinor !== null && point.currentCoverage === "complete"
                    ? formatWholeMoney(point.currentMinor, currency)
                    : "—"}
                </TableCell>
                <TableCell>
                  {point.projectedLowMinor !== null
                    ? formatWholeMoney(point.projectedLowMinor, currency)
                    : "—"}
                </TableCell>
                <TableCell>
                  {point.projectedCentralMinor !== null
                    ? formatWholeMoney(point.projectedCentralMinor, currency)
                    : "—"}
                </TableCell>
                <TableCell>
                  {point.projectedHighMinor !== null
                    ? formatWholeMoney(point.projectedHighMinor, currency)
                    : "—"}
                </TableCell>
                <TableCell>{growthDateComparability(point)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}

/**
 * V07 loading skeleton. Reserves the summary, chart and rail space with
 * blank blocks — no fake wavy lines, no example amounts.
 */
export function HomeGrowthLoading() {
  return (
    <div className={styles.growthLoading} role="status" aria-label="Loading growth outlook">
      <div className={styles.growthLoadingSummaries}>
        <Skeleton className={styles.growthLoadingSummary} />
        <Skeleton className={styles.growthLoadingSummary} />
      </div>
      <Skeleton className={styles.growthLoadingChart} />
      <Skeleton className={styles.growthLoadingRail} />
    </div>
  );
}

/**
 * V07 read/refresh failure that keeps the last successful view on screen.
 * The retained view stays labelled with its own dates so a stale chart is
 * never presented as fresh; the initial load (no retained view) uses the
 * shaped failure state instead. Copy stays safe: no raw provider or
 * database error reaches the surface.
 */
export function HomeGrowthFailed({
  retainedView,
  onRetry,
}: Readonly<{ retainedView: GrowthProgressView | null; onRetry: () => void }>) {
  return (
    <div className={styles.growthFailed}>
      <Alert>
        <AlertTitle>Growth outlook is unavailable right now</AlertTitle>
        <AlertDescription>
          {retainedView !== null && retainedView.sourceCutoffDate !== null ? (
            <>
              Showing the last readable view, with reports through{" "}
              {formatFooterDay(retainedView.sourceCutoffDate)}. Nothing is estimated in the
              missing reports&apos; place.{" "}
            </>
          ) : (
            <>The recent reports could not be read. Nothing is estimated in their place. </>
          )}
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
