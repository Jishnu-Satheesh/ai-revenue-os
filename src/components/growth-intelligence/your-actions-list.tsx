"use client";

import {
  CalendarCheck2,
  Check,
  CheckCheck,
  Clock3,
  FilePlus2,
  Megaphone,
  ThumbsUp,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { TimelineEvent } from "@/modules/growth-intelligence/application/read-model";

const DECISION_META = {
  planned: { label: "Marked planned", Icon: CalendarCheck2, emphasized: true },
  acknowledged: { label: "Acknowledged", Icon: CheckCheck, emphasized: false },
  snoozed: { label: "Snoozed", Icon: Clock3, emphasized: false },
  dismissed: { label: "Dismissed", Icon: X, emphasized: false },
  resolved: { label: "Resolved", Icon: Check, emphasized: false },
  /**
   * A proposal decision is a decision, so it reads as one here. The label
   * never shortens to "Approved": what was agreed to is preparing creative,
   * and publishing still needs its own approval of each finished output.
   */
  "proposal-approved": {
    label: "Approved to prepare creative",
    Icon: ThumbsUp,
    emphasized: true,
  },
  "changes-requested": { label: "Changes requested", Icon: Clock3, emphasized: false },
} as const;

type DecisionType = keyof typeof DECISION_META;

function isDecisionType(type: TimelineEvent["type"]): type is DecisionType {
  return type in DECISION_META;
}

function formatDay(value: string, timeZone: string): string {
  return new Date(value).toLocaleDateString("en-AE", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function scopeLabel(
  event: TimelineEvent,
  channelNames?: ReadonlyMap<string, string>,
  branchNames?: ReadonlyMap<string, string>,
): string | null {
  // Research and draft lifecycle rows already name their subject in the
  // title; inventing a channel scope for them would mislead.
  if (
    event.source.kind === "research_pipeline" ||
    event.source.kind === "opportunity" ||
    // A proposal names its own campaign in the title and spans whatever
    // channels it proposes. Inventing one channel's scope for it would
    // describe a narrower thing than the proposal is.
    event.source.kind === "campaign_proposal"
  ) {
    return null;
  }
  const channelId = event.channelId ?? null;
  const branchId = event.branchId ?? null;
  if (!channelId) return "All channels · all locations";
  const channel = channelNames?.get(channelId) ?? "Channel";
  if (!branchId) return channel;
  const branch = branchNames?.get(branchId);
  return branch ? `${channel} · ${branch}` : channel;
}

/**
 * Named action rows for the Your actions tab. Title first so the list scans
 * like a to-do history; the second line keeps its own activity date apart
 * from any evidence period on the source card.
 */
export function YourActionsList({
  events,
  timeZone,
  channelNames,
  branchNames,
}: {
  events: readonly TimelineEvent[];
  timeZone: string;
  channelNames?: ReadonlyMap<string, string>;
  branchNames?: ReadonlyMap<string, string>;
}) {
  if (events.length === 0) {
    return (
      <Card className="p-6">
        <p role="status" className="text-sm text-muted-foreground">
          No actions with this status yet.
        </p>
      </Card>
    );
  }
  return (
    <Card className="divide-y overflow-hidden p-0">
      {events.map((event, index) => {
        const scope = scopeLabel(event, channelNames, branchNames);
        const activityDate = formatDay(event.occurredAt, timeZone);
        const snoozedUntil = event.snoozedUntil ?? null;
        const returnsDate =
          event.type === "snoozed" && snoozedUntil ? formatDay(snoozedUntil, timeZone) : null;
        if (isDecisionType(event.type)) {
          const { label, Icon, emphasized } = DECISION_META[event.type];
          return (
            <div
              key={`${event.source.kind}-${event.source.id}-${event.occurredAt}-${index}`}
              className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 px-4 py-4 sm:px-5"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span aria-hidden="true" className="mt-0.5 text-muted-foreground">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{event.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {scope ? `${scope} · ` : ""}
                    {activityDate}
                    {returnsDate ? ` · returns ${returnsDate}` : ""}
                  </p>
                </div>
              </div>
              {emphasized ? (
                <span className="text-xs font-medium text-primary">{label}</span>
              ) : (
                <Badge variant="secondary">{label}</Badge>
              )}
            </div>
          );
        }
        const Icon =
          event.type === "research-started" || event.type === "draft-requested"
            ? FilePlus2
            : event.type === "research-finished" || event.type === "draft-created"
              ? Check
              : event.type === "proposal-ready"
                ? Megaphone
                : event.type === "research-retried" || event.type === "retry"
                  ? Clock3
                  : X;
        const fallbackLabel =
          event.type === "research-started"
            ? "Research started"
            : event.type === "research-finished"
              ? "Research finished"
              : event.type === "research-retried"
                ? "Analysis retried"
                : event.type === "draft-requested"
                  ? "Draft requested"
                  : event.type === "draft-created"
                    ? "Draft created"
                    : event.type === "retry"
                      ? "Retried"
                      : event.type === "proposal-ready"
                        ? "Proposal ready to review"
                        : "Draft failed";
        return (
          <div
            key={`${event.source.kind}-${event.source.id}-${event.occurredAt}-${index}`}
            className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 px-4 py-4 sm:px-5"
          >
            <div className="flex min-w-0 items-start gap-3">
              <span aria-hidden="true" className="mt-0.5 text-muted-foreground">
                <Icon className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{event.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{activityDate}</p>
              </div>
            </div>
            <Badge variant="secondary">{fallbackLabel}</Badge>
          </div>
        );
      })}
    </Card>
  );
}
