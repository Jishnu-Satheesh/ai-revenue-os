"use client";

import { ChevronRight } from "lucide-react";

import { TriangleAlert } from "lucide-react";

import { GradeBadge } from "@/components/economics/grade-badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import type { ChannelRollup } from "@/domain/economics/rollup";
import { fromMinorUnits } from "@/domain/reference/currencies";

/**
 * Which channel actually makes money — the first of the three questions in
 * `specs/012-channel-economics-ledger.md` section 7.
 *
 * Two rules are structural rather than cosmetic. The completeness grade has its
 * own column on every row, because section 7 requires it visible and never
 * hidden behind a tooltip. And an indicative row has no figure to print: the
 * rollup type carries no `contributionMarginMinor` for it, so this component
 * could not show one even by mistake.
 */
export function ChannelMarginTable({
  channels,
  currency,
  selectedChannel,
  onSelectChannel,
}: {
  channels: readonly ChannelRollup[];
  currency: string;
  selectedChannel: string | null;
  onSelectChannel: (channel: string | null) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-3xl border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" className="px-4 py-2 text-left font-medium">
              Channel
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Gross revenue
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Transactions
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Contribution margin
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Margin rate
            </th>
            <th scope="col" className="px-4 py-2 text-left font-medium">
              Grade
            </th>
          </tr>
        </thead>
        <tbody>
          {channels.map((channel) => {
            const name = channel.channel ?? "All channels";
            const selected = channel.channel === selectedChannel;
            const breakdownable = channel.marginSource === "derived";

            return (
              <tr
                key={name}
                aria-selected={selected}
                className={cn(
                  "border-b border-border/60 last:border-b-0",
                  breakdownable && "cursor-pointer hover:bg-muted/60",
                  selected && "bg-primary/5",
                )}
                onClick={breakdownable ? () => onSelectChannel(channel.channel) : undefined}
              >
                <td className="px-4 py-3">
                  <div
                    className={cn(
                      "flex items-center gap-2 border-l-2 pl-3",
                      selected ? "border-primary" : "border-transparent",
                    )}
                  >
                    <span className="font-medium">{name}</span>
                    {/* A reported margin is measured but never decomposed, and
                        saying so on the row stops the missing waterfall from
                        reading as a gap in the data. */}
                    {channel.marginSource !== "derived" ? (
                      <StatusBadge
                        label={channel.marginSource === "mixed" ? "Mixed" : "Reported"}
                      />
                    ) : null}
                    {breakdownable ? (
                      <ChevronRight
                        aria-hidden="true"
                        className={cn(
                          "size-3.5 shrink-0 text-muted-foreground transition-transform",
                          selected && "rotate-90",
                        )}
                      />
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {money(channel.grossRevenueMinor, currency)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {channel.transactionCount.toLocaleString("en-US")}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {channel.grade === "indicative" ? (
                    <span className="text-muted-foreground">
                      At most {money(channel.atMostMinor, currency)}
                    </span>
                  ) : (
                    <span className="flex flex-col items-end gap-0.5">
                      <span className="font-medium">
                        {money(channel.contributionMarginMinor, currency)}
                      </span>
                      {/* The size of the gap, not a binary flag. With no
                          threshold this marker is on wherever the two figures
                          differ at all, so it has to say how much rather than
                          merely that. */}
                      {channel.disagreement ? (
                        <span className="flex items-center gap-1 text-xs font-normal text-warning">
                          <TriangleAlert aria-hidden="true" className="size-3" />
                          <span>
                            Export says {money(channel.disagreement.reportedMinor, currency)}
                          </span>
                        </span>
                      ) : null}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {channel.grade === "indicative" ? (
                    // A ceiling has no rate. An em dash says so without
                    // implying the number is merely absent.
                    <span aria-label="No margin rate for an indicative margin">—</span>
                  ) : (
                    formatRate(channel.marginRate)
                  )}
                </td>
                <td className="px-4 py-3">
                  <GradeBadge grade={channel.grade} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function money(minor: number, currency: string) {
  return `${currency} ${Number(fromMinorUnits(minor, currency)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatRate(rate: number | null) {
  if (rate === null) return <span className="text-muted-foreground">—</span>;
  return `${(rate * 100).toFixed(1)}%`;
}
