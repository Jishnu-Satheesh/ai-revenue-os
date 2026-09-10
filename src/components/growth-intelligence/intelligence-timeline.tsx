import { CalendarCheck2, Check, Clock3, FilePlus2, X } from "lucide-react";

import type { TimelineEvent } from "@/modules/growth-intelligence/application/read-model";

const EVENT_META = {
  generated: { label: "Generated", Icon: FilePlus2 },
  acknowledged: { label: "Acknowledged", Icon: Check },
  planned: { label: "Marked planned", Icon: CalendarCheck2 },
  snoozed: { label: "Snoozed", Icon: Clock3 },
  dismissed: { label: "Dismissed", Icon: X },
  resolved: { label: "Resolved", Icon: Check },
  "draft-requested": { label: "Draft requested", Icon: FilePlus2 },
  retry: { label: "Retried", Icon: Clock3 },
  "draft-created": { label: "Draft created", Icon: Check },
  "draft-failed": { label: "Draft failed", Icon: X },
  // Research lifecycle rows arrive from the read contract; the Task 11
  // progress/outcome surfaces own their presentation.
  "research-started": { label: "Research started", Icon: FilePlus2 },
  "research-finished": { label: "Research finished", Icon: Check },
  "research-retried": { label: "Analysis retried", Icon: Clock3 },
} as const;

function sourceLabel(source: TimelineEvent["source"]): string {
  return source.kind === "opportunity"
    ? "Opportunity"
    : source.kind === "channel_recommendation"
      ? "Recommendation"
      : source.kind === "research_pipeline"
        ? "Market research"
        : "Intelligence item";
}

/**
 * Activity history for the viewed month, newest first as handed over.
 * Month navigation changes this history only; it never relabels evidence.
 */
export function IntelligenceTimeline({
  events: incoming,
  timeZone,
  compact = false,
}: {
  events: readonly TimelineEvent[];
  timeZone: string;
  compact?: boolean;
}) {
  // Your actions names one start and one terminal event per transition, so
  // the view deduplicates identical rows instead of showing the same moment
  // twice when workspace and research reads overlap.
  const seen = new Set<string>();
  const events = incoming.filter((event) => {
    const key = `${event.type}::${event.source.kind}::${event.source.id}::${event.occurredAt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return (
    <section aria-label="Activity timeline" className="flex flex-col gap-4">
      {compact ? null : <h2 className="text-lg font-semibold">Activity</h2>}
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity this month.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {events.map((event, index) => {
            const { label, Icon } = EVENT_META[event.type];
            return (
              <li
                key={`${event.source.id}-${event.occurredAt}-${index}`}
                className="flex gap-3 text-sm"
              >
                <span
                  aria-hidden="true"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-background"
                >
                  <Icon className="size-3.5 text-muted-foreground" />
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">
                    {label} · {sourceLabel(event.source)}
                  </span>
                  <span className="truncate text-sm">{event.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(event.occurredAt).toLocaleDateString("en-AE", {
                      timeZone,
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
