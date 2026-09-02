import {
  allocationReasonCopy,
  allocationRuleCopy,
  MARGIN_GRADE_LABELS,
} from "@/components/campaigns/allocation-copy";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

/**
 * The fast loop's reasoning, laid out for an operator to interrogate.
 *
 * Every card is one decision the loop made, including the decisions not to act.
 * The rule and the reason are shown in plain words — the raw keys stay in the
 * database and in the audit record, because "spend went above the approved
 * ceiling" is what an operator can act on, while `diagnostic.spend_ceiling` is
 * a filename. A pause shows the value observed, the threshold it was compared
 * against, and — where a margin was used — how trustworthy that margin was.
 *
 * Money renders in the organization's currency; a click-through rate renders
 * as a percentage. Times render in the organization's timezone, never as a raw
 * UTC string.
 */

export type AllocationLedgerEvent = {
  id: string;
  variantId: string;
  ruleKey: string;
  ruleVersion: string;
  observedValue: number | null;
  threshold: number | null;
  resolvedMarginMinor: number | null;
  resolvedMarginGrade: "measured" | "derived" | "estimated" | "assumed" | null;
  action: "pause" | "no_action";
  reasonCode: string;
  actor: string;
  occurredAt: string;
};

export function AllocationLedger({
  events,
  timeZone = "UTC",
  currency = null,
}: Readonly<{
  events: readonly AllocationLedgerEvent[];
  /** The organization's timezone; timestamps render in it, never in UTC. */
  timeZone?: string;
  /** The organization's currency; money values render in it. */
  currency?: string | null;
}>) {
  if (events.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No allocation decisions yet</EmptyTitle>
          <EmptyDescription>
            The loop records a decision every cycle, including when it chooses not to act. Nothing
            has been decided for this campaign so far.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {events.map((event) => (
        <li key={event.id} className="flex">
          <AllocationDecisionCard event={event} timeZone={timeZone} currency={currency} />
        </li>
      ))}
    </ul>
  );
}

function AllocationDecisionCard({
  event,
  timeZone,
  currency,
}: Readonly<{
  event: AllocationLedgerEvent;
  timeZone: string;
  currency: string | null;
}>) {
  const rule = allocationRuleCopy(event.ruleKey);
  const paused = event.action === "pause";

  return (
    <Card className="w-full">
      <CardHeader>
        <CardAction>
          <Badge variant={paused ? "destructive" : "secondary"}>
            {paused ? "Paused" : "No action"}
          </Badge>
        </CardAction>
        <CardTitle>
          {rule.title}
          <span className="ml-1.5 font-mono text-xs font-normal text-muted-foreground">
            {event.ruleVersion}
          </span>
        </CardTitle>
        <CardDescription>{rule.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md bg-border ring-1 ring-border">
          <div className="flex flex-col gap-0.5 bg-card p-3">
            <dt className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
              Observed
            </dt>
            <dd className="font-mono text-sm">
              {formatValue(event.observedValue, rule.unit, currency)}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5 bg-card p-3">
            <dt className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
              Threshold
            </dt>
            <dd className="font-mono text-sm">
              {formatValue(event.threshold, rule.unit, currency)}
            </dd>
          </div>
          {event.resolvedMarginGrade !== null ? (
            <div className="col-span-2 flex items-center justify-between gap-4 bg-card p-3">
              <dt className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
                Margin quality
              </dt>
              <dd className="text-sm font-medium">
                {MARGIN_GRADE_LABELS[event.resolvedMarginGrade]}
              </dd>
            </div>
          ) : null}
        </dl>
      </CardContent>
      <CardFooter className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">{allocationReasonCopy(event.reasonCode)}</p>
        <span className="text-xs text-muted-foreground">
          {event.actor === "agent" ? "Decided automatically" : "Decided by an operator"}
          {" · "}
          <time dateTime={event.occurredAt}>{formatMoment(event.occurredAt, timeZone)}</time>
        </span>
      </CardFooter>
    </Card>
  );
}

function formatValue(
  value: number | null,
  unit: "money" | "percent" | "number",
  currency: string | null,
): string {
  if (value === null) return "—";
  if (unit === "percent") {
    return new Intl.NumberFormat("en-GB", {
      style: "percent",
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value);
  }
  if (unit === "money" && currency) {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(value / 100);
  }
  return value.toLocaleString("en-GB");
}

/** An instant, rendered in the organization's timezone rather than raw UTC. */
function formatMoment(iso: string, timeZone: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
    }).format(parsed);
  } catch {
    return iso;
  }
}
