import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The fast loop's reasoning, laid out for an operator to interrogate.
 *
 * Every row is a decision the loop made, including the decisions not to act. A
 * pause shows the rule that fired, the value it saw, the threshold it compared,
 * and — where a margin was used — the resolved figure and its quality grade. A
 * `no_action` row shows the same shape, so "we chose not to act" is a visible
 * choice rather than an absence.
 *
 * The time is rendered as stored (UTC) and left for the caller to convert into
 * the organization's timezone; this component only says what happened.
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

const GRADE_LABEL: Readonly<
  Record<NonNullable<AllocationLedgerEvent["resolvedMarginGrade"]>, string>
> = {
  measured: "measured",
  derived: "derived",
  estimated: "estimated",
  assumed: "assumed",
};

export function AllocationLedger({
  events,
}: Readonly<{ events: readonly AllocationLedgerEvent[] }>) {
  if (events.length === 0) {
    return (
      <section className="rounded-lg border border-dashed p-6 text-center" aria-label="Allocation">
        <p className="text-sm font-medium">No allocation decisions yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The loop records a decision every cycle, including when it chooses not to act. Nothing has
          been decided for this campaign so far.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3" aria-label="Allocation">
      <ul className="flex flex-col gap-2">
        {events.map((event) => (
          <li key={event.id} className="flex">
            <Card className="w-full">
              <CardContent className="flex flex-col gap-2 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={event.action === "pause" ? "destructive" : "outline"}>
                    {event.action === "pause" ? "Paused" : "No action"}
                  </Badge>
                  <span className="font-medium">
                    {event.ruleKey}
                    <span className="text-muted-foreground"> · {event.ruleVersion}</span>
                  </span>
                  <time
                    className="ml-auto text-xs text-muted-foreground"
                    dateTime={event.occurredAt}
                  >
                    {event.occurredAt}
                  </time>
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <div className="flex justify-between gap-2">
                    <dt>Observed</dt>
                    <dd className="font-mono">
                      {event.observedValue === null ? "—" : event.observedValue}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Threshold</dt>
                    <dd className="font-mono">
                      {event.threshold === null ? "—" : event.threshold}
                    </dd>
                  </div>
                  {event.resolvedMarginGrade !== null ? (
                    <div className="col-span-2 flex justify-between gap-2">
                      <dt>Resolved margin</dt>
                      <dd className="font-mono">
                        {event.resolvedMarginMinor === null
                          ? "—"
                          : `${event.resolvedMarginMinor} (${GRADE_LABEL[event.resolvedMarginGrade]})`}
                      </dd>
                    </div>
                  ) : null}
                </dl>

                <p className="text-xs text-muted-foreground">
                  Reason: <span className="font-mono">{event.reasonCode}</span>
                  {event.actor === "agent" ? " · decided automatically" : " · an operator"}
                </p>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
