import Link from "next/link";
import { ArrowRight, ArrowUpRight, CircleDashed, ClipboardList, NotebookPen } from "lucide-react";

import type {
  DataGapCard,
  InsightCard,
} from "@/modules/growth-intelligence/application/read-model";

function formatDay(value: string, timeZone: string): string {
  return new Date(value).toLocaleDateString("en-AE", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Row meta line from existing fields only: branch scope, channel name when a
 * channel owns the insight, then the evidence window (or the generated date
 * when no window exists). Segments stay silent rather than invented.
 */
function insightMeta(
  card: InsightCard,
  channelNames: ReadonlyMap<string, string> | undefined,
  branchNames: ReadonlyMap<string, string> | undefined,
  timeZone: string,
): string {
  const parts = [
    card.branchId
      ? (branchNames?.get(card.branchId) ?? "Location details unavailable")
      : "All locations",
  ];
  if (card.channelId) parts.push(channelNames?.get(card.channelId) ?? "Channel details unavailable");
  parts.push(
    card.evidenceWindow
      ? `${formatDay(card.evidenceWindow.start, timeZone)} to ${formatDay(card.evidenceWindow.end, timeZone)}`
      : `Updated ${formatDay(card.generatedAt, timeZone)}`,
  );
  return parts.join(" · ");
}

/** Channel surface for evidence and repair: its page, or the channels index. */
function channelHref(organizationId: string, channelId: string | null): string {
  return channelId
    ? `/organizations/${organizationId}/channels/${channelId}`
    : `/organizations/${organizationId}/channels`;
}

function gapSubline(
  card: DataGapCard,
  channelNames: ReadonlyMap<string, string> | undefined,
): string {
  const scope = card.channelId
    ? (channelNames?.get(card.channelId) ?? "Channel details unavailable")
    : "All locations";
  return `${scope} · ${card.missingInput}`;
}

/**
 * Business insights as evidence rows with an "Improve the next report" rail.
 * Rows name what the evidence says and link to the read-only evidence; the
 * rail lists each data gap with its repair link. Feedback controls do not
 * live here: answering, rating, and dismissing happen on the recommendation
 * surfaces that own those mutations.
 */
export function InsightsList({
  insights,
  dataGaps,
  organizationId,
  timeZone,
  channelNames,
  branchNames,
}: {
  insights: readonly InsightCard[];
  dataGaps: readonly DataGapCard[];
  organizationId: string;
  timeZone: string;
  channelNames?: ReadonlyMap<string, string>;
  branchNames?: ReadonlyMap<string, string>;
}) {
  return (
    <section aria-label="Business insights" className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold">Business insights</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Material observations from your business and market evidence.
          </p>
        </div>
        <span className="shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          Internal evidence
        </span>
      </div>
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {insights.length === 0 ? (
            <p className="text-sm text-muted-foreground">No insights for this month.</p>
          ) : (
            <ul className="flex min-w-0 flex-col">
              {insights.map((card) => (
                <li key={card.id} className="flex min-w-0 gap-3 border-t py-5 last:border-b">
                  <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                  >
                    <ClipboardList className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="min-w-0 text-[15px] font-bold break-words">{card.title}</p>
                    <p className="mt-0.5 min-w-0 text-sm text-muted-foreground break-words">
                      {card.detail}
                    </p>
                    <p className="mt-1 min-w-0 text-xs text-muted-foreground break-words">
                      {insightMeta(card, channelNames, branchNames, timeZone)}
                    </p>
                    <Link
                      href={channelHref(organizationId, card.channelId)}
                      className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-semibold text-primary underline-offset-2 hover:underline"
                    >
                      Inspect evidence
                      <ArrowUpRight aria-hidden="true" className="size-3.5" />
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <aside
          aria-label="Improve the next report"
          className="h-fit min-w-0 rounded-xl border bg-card p-5"
        >
          <span
            aria-hidden="true"
            className="flex size-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
          >
            <NotebookPen className="size-5" />
          </span>
          <h3 className="mt-3 text-base font-bold">Improve the next report</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            A little more business context can make the advice more useful.
          </p>
          {dataGaps.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No missing evidence right now.</p>
          ) : (
            <>
              <ul className="mt-4 flex min-w-0 flex-col gap-3">
                {dataGaps.map((gap) => (
                  <li key={gap.id} className="flex min-w-0 gap-2.5">
                    <CircleDashed
                      aria-hidden="true"
                      className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                    />
                    <div className="min-w-0">
                      <Link
                        href={channelHref(organizationId, gap.channelId)}
                        className="block min-w-0 text-[13px] font-semibold break-words underline-offset-2 hover:underline"
                      >
                        {gap.title}
                      </Link>
                      <p className="min-w-0 text-xs text-muted-foreground break-words">
                        {gapSubline(gap, channelNames)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              <Link
                href={`/organizations/${organizationId}/channels`}
                className="mt-4 inline-flex items-center gap-1 text-[13px] font-semibold text-primary underline-offset-2 hover:underline"
              >
                Review missing context
                <ArrowRight aria-hidden="true" className="size-3.5" />
              </Link>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
