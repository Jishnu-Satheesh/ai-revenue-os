import { addLocalDays, localDaysBetween } from "@/domain/analysis/calendar";
import { formatCount, formatMoney, formatPercent } from "@/components/analysis/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import type {
  WorkspaceChapterView,
  WorkspaceFindingView,
  WorkspaceRunView,
} from "@/modules/analysis/application/read-model";

type DailyAvailability = {
  closedMinutes?: number;
  scheduledMinutes?: number;
};

function monthLabel(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function dayNumber(date: string): number {
  return Number(date.slice(8, 10));
}

function heatClass(closedMinutes: number, scheduledMinutes: number): string {
  if (scheduledMinutes <= 0) return "border border-dashed border-border bg-muted/30";
  const share = closedMinutes / scheduledMinutes;
  if (share >= 0.75) return "bg-destructive text-destructive-foreground";
  if (share >= 0.5) return "bg-warning/70 text-foreground";
  if (share >= 0.25) return "bg-primary/45 text-foreground";
  return "bg-primary/15 text-primary";
}

function calendarDates(run: WorkspaceRunView): string[] {
  if (run.periodGrain !== "day") return [];
  const count = localDaysBetween(run.windowStart, run.windowEnd);
  return Array.from({ length: count + 1 }, (_, index) => addLocalDays(run.windowStart, index));
}

function citedAvailability(finding: WorkspaceFindingView): Map<string, DailyAvailability> {
  const byDate = new Map<string, DailyAvailability>();
  for (const citation of finding.evidence) {
    if (!citation.metric) continue;
    const current = byDate.get(citation.metric.periodStart) ?? {};
    if (citation.role === "component") current.closedMinutes = citation.metric.numerator;
    if (citation.role === "denominator") current.scheduledMinutes = citation.metric.numerator;
    byDate.set(citation.metric.periodStart, current);
  }
  return byDate;
}

function AvailabilityCalendar({
  run,
  finding,
}: {
  run: WorkspaceRunView;
  finding: WorkspaceFindingView;
}) {
  const dates = calendarDates(run);
  const byDate = citedAvailability(finding);
  if (dates.length === 0 || byDate.size === 0) return null;

  const months = new Map<string, string[]>();
  for (const date of dates) {
    const month = date.slice(0, 7);
    const entries = months.get(month) ?? [];
    entries.push(date);
    months.set(month, entries);
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      {[...months.values()].map((monthDates) => {
        const first = monthDates[0];
        const leadingBlankCount = new Date(`${first}T00:00:00Z`).getUTCDay();
        return (
          <div key={first.slice(0, 7)} className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {monthLabel(first)}
              </p>
              <p aria-hidden="true" className="font-mono text-[9px] text-muted-foreground">
                S M T W T F S
              </p>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: leadingBlankCount }, (_, index) => (
                <span key={`blank-${index}`} aria-hidden="true" className="aspect-square" />
              ))}
              {monthDates.map((date) => {
                const point = byDate.get(date);
                const hasPair =
                  point?.closedMinutes !== undefined && point.scheduledMinutes !== undefined;
                const label = hasPair
                  ? `${date}: ${point.closedMinutes} closed minutes of ${point.scheduledMinutes} scheduled minutes.`
                  : `${date}: no closed and scheduled minute pair is cited by this finding.`;
                return (
                  <span
                    key={date}
                    role="img"
                    aria-label={label}
                    title={label}
                    className={cn(
                      "flex aspect-square min-h-8 items-center justify-center rounded-sm font-mono text-[9px] tabular-nums",
                      hasPair
                        ? heatClass(point.closedMinutes as number, point.scheduledMinutes as number)
                        : "border border-dashed border-border bg-muted/20 text-muted-foreground",
                    )}
                  >
                    {dayNumber(date)}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function reasonRows(chapter: WorkspaceChapterView): Array<{
  findingId: string;
  reason: string;
  count: number;
}> {
  return chapter.findings.flatMap((finding) => {
    if (finding.code !== "OPERATIONS_CLOSED_DAYS" || finding.value?.kind !== "count") return [];
    const reasons = new Set(
      finding.evidence.flatMap((citation) => {
        const reason = citation.metric?.dimensions.reason_code;
        return reason ? [reason] : [];
      }),
    );
    if (reasons.size !== 1) return [];
    return [{ findingId: finding.id, reason: [...reasons][0], count: finding.value.value }];
  });
}

function AvailabilityReasons({ chapter }: { chapter: WorkspaceChapterView }) {
  const rows = reasonRows(chapter).sort(
    (left, right) => right.count - left.count || left.reason.localeCompare(right.reason),
  );
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (rows.length === 0 || total <= 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Cited closure reasons
      </p>
      {rows.map((row) => {
        const percent = Math.round((row.count / total) * 100);
        return (
          <div
            key={row.findingId}
            role="img"
            aria-label={`${row.reason}: ${row.count} of ${total} cited closed days.`}
            className="flex flex-col gap-1.5"
          >
            <div className="flex items-baseline justify-between gap-3 text-[11px]">
              <span className="truncate font-mono font-semibold">{row.reason}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {formatCount(row.count)} · {percent}%
              </span>
            </div>
            <div className="h-7 overflow-hidden rounded-md bg-muted">
              <div
                aria-hidden="true"
                className="flex h-full items-center bg-chart-2 px-3"
                style={{ width: `${Math.max(percent, 5)}%` }}
              >
                <span className="text-[10px] font-bold tabular-nums text-white">
                  {formatCount(row.count)}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AvailabilityVisual({
  chapter,
  run,
}: {
  chapter: WorkspaceChapterView;
  run: WorkspaceRunView | null;
}) {
  const finding = chapter.findings.find(
    (entry) => entry.code === "OPERATIONS_CLOSED_SHARE" && entry.value?.kind === "ratio",
  );
  if (!finding || finding.value?.kind !== "ratio") return null;

  return (
    <section aria-label="Availability heatmap" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Operating availability
          </p>
          <p className="font-mono text-sm font-semibold tabular-nums">
            {formatPercent(finding.value.numerator, finding.value.denominator)} closed
          </p>
        </div>
        <div
          role="img"
          aria-label={`Scheduled minutes reported closed: ${finding.value.numerator} of ${finding.value.denominator}.`}
          className="h-2.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            aria-hidden="true"
            className="h-full rounded-full bg-chart-2"
            style={{
              width: `${Math.min(
                Math.max((finding.value.numerator / finding.value.denominator) * 100, 0),
                100,
              )}%`,
            }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span>Less time closed</span>
          <span>More time closed</span>
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2 rounded-sm border border-dashed border-border"
            />
            Not cited by this finding
          </span>
        </div>
      </div>

      {run ? <AvailabilityCalendar run={run} finding={finding} /> : null}
      <AvailabilityReasons chapter={chapter} />
    </section>
  );
}

function CancellationImpact({
  chapter,
  allFindings,
}: {
  chapter: WorkspaceChapterView;
  allFindings: readonly WorkspaceFindingView[];
}) {
  const cancellation = chapter.findings.find(
    (finding) => finding.code === "ORDER_CANCELLATION_LOSS" && finding.value?.kind === "count",
  );
  if (!cancellation || cancellation.value?.kind !== "count") return null;

  const customerMix = allFindings.find(
    (finding) => finding.code === "CUSTOMER_REPEAT_SHARE" && finding.value?.kind === "ratio",
  );
  const totalOrders = customerMix?.value?.kind === "ratio" ? customerMix.value.denominator : null;
  const cancellations = cancellation.value.value;
  const usableTotal = totalOrders !== null && totalOrders >= cancellations ? totalOrders : null;
  const cancellationPercent = usableTotal ? Math.round((cancellations / usableTotal) * 100) : 100;

  return (
    <section aria-label="Cancellation financial impact" className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/20 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Avoidable cancellations
          </p>
          <p className="font-mono text-3xl font-semibold tabular-nums text-destructive">
            {formatCount(cancellations)}
          </p>
        </div>
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/20 p-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Provider-reported rejection loss
          </p>
          <p className="font-mono text-3xl font-semibold tabular-nums text-destructive">
            {cancellation.monetaryImpact
              ? formatMoney(
                  cancellation.monetaryImpact.minorUnits,
                  cancellation.monetaryImpact.currency,
                )
              : "—"}
          </p>
        </div>
      </div>

      {usableTotal ? (
        <div
          role="img"
          aria-label={`${cancellations} avoidable cancellations out of ${usableTotal} recorded orders.`}
          className="flex flex-col gap-2"
        >
          <div className="flex items-baseline justify-between gap-3 text-[11px]">
            <span className="font-semibold">Recorded order outcome mix</span>
            <span className="font-mono tabular-nums text-muted-foreground">
              {formatCount(cancellations)} of {formatCount(usableTotal)}
            </span>
          </div>
          <div className="flex h-9 overflow-hidden rounded-lg bg-muted">
            <div
              aria-hidden="true"
              className="flex h-full items-center bg-muted-foreground/20 px-3"
              style={{ width: `${100 - cancellationPercent}%` }}
            >
              <span className="text-[10px] font-bold tabular-nums text-foreground">
                {formatCount(usableTotal - cancellations)} other
              </span>
            </div>
            <div
              aria-hidden="true"
              className="flex h-full items-center justify-end bg-destructive px-3"
              style={{ width: `${cancellationPercent}%` }}
            >
              <span className="text-[10px] font-bold tabular-nums text-destructive-foreground">
                {formatCount(cancellations)} avoidable
              </span>
            </div>
          </div>
        </div>
      ) : null}

      <Alert>
        <AlertTitle>Cancellation root cause</AlertTitle>
        <AlertDescription>
          The root-cause breakdown is unavailable because this approved contract did not bind a
          cancellation-reason field. The page will not label those cancellations from an uncited
          source.
        </AlertDescription>
      </Alert>
    </section>
  );
}

export function OperationsVisual({
  chapter,
  allFindings,
  run,
}: {
  chapter: WorkspaceChapterView;
  allFindings: readonly WorkspaceFindingView[];
  run: WorkspaceRunView | null;
}) {
  return (
    <div className="flex flex-col gap-8">
      <CancellationImpact chapter={chapter} allFindings={allFindings} />
      <AvailabilityVisual chapter={chapter} run={run} />
    </div>
  );
}
