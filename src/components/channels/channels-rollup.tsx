"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { formatMoney } from "@/components/analysis/format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ChannelsOverviewView } from "@/modules/analysis/application/channels-overview";

/**
 * Channel names as a person would say them: "Noon, Deliveroo and Keeta".
 *
 * A bare comma-join reads as a machine listing rows, and this sentence is the
 * one that tells an operator what to go and do next.
 */
function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The small uppercase section label the channel workspace uses for every band and card. */
function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * The organization's money band, over one declared evidence window.
 *
 * Every figure here is a sum of per-channel bands the channel pages show
 * individually. The coverage line is not decoration: a sum over one of four
 * channels is not a total, and stating which channels are missing turns the
 * gap into the next thing to do.
 */
export function ChannelsRollup({
  view,
  organizationId,
}: {
  view: ChannelsOverviewView;
  organizationId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const onWindowChange = (value: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("window", value);
    router.push(`/organizations/${organizationId}/channels?${params.toString()}`);
  };

  const { earned } = view.total;

  return (
    <section aria-label="Channel roll-up" className="flex flex-col gap-4">
      <Kicker>Channel roll-up</Kicker>

      <div className="flex flex-wrap items-baseline justify-between gap-3">
        {/* The window's own label appears once, inside the picker below --
            the Select's trigger already renders the selected item's label
            (Radix matches `value` against each `SelectItem`'s `value` and
            shows its children), so restating it here would print the same
            date range twice on the page. */}
        {earned ? (
          <p className="font-mono text-4xl font-bold tracking-tight">
            {formatMoney(earned.minorUnits, earned.currency)}
          </p>
        ) : (
          <p className="font-mono text-4xl font-bold tracking-tight text-muted-foreground">—</p>
        )}

        {view.windows.length > 0 ? (
          <Select value={view.selectedWindow?.value ?? undefined} onValueChange={onWindowChange}>
            <SelectTrigger aria-label="Window to report on" className="w-auto">
              <SelectValue placeholder="Choose a window" />
            </SelectTrigger>
            <SelectContent>
              {view.windows.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {view.refusalReason ? (
        <p className="text-[15px] leading-relaxed text-muted-foreground">{view.refusalReason}</p>
      ) : (
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          {`Across ${view.coverage.assessedCount} of ${view.coverage.channelCount} channels.`}
          {/* Two different gaps, so two different sentences. A channel that
              reported revenue needs a report that records cancellations; a
              channel with no analysis needs any report at all. */}
          {view.coverage.revenueOnlyNames.length > 0
            ? ` ${listNames(view.coverage.revenueOnlyNames)} reported revenue but no recorded loss, so ${
                view.coverage.revenueOnlyNames.length === 1 ? "it is" : "they are"
              } not in this total.`
            : ""}
          {view.coverage.unassessedNames.length > 0
            ? ` ${listNames(view.coverage.unassessedNames)} ${
                view.coverage.unassessedNames.length === 1 ? "has" : "have"
              } no analysis for this window.`
            : ""}
        </p>
      )}
    </section>
  );
}
