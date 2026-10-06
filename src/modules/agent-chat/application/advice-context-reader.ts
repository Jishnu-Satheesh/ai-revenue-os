import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { addLocalDays, localDaysBetween } from "@/domain/analysis/calendar";
import type { OrganizationRole } from "@/domain/organizations/types";
import { operatorCeiling } from "@/modules/memory/application/authorization";
import type { GovernedMetricObservation } from "@/modules/metrics/application/ports";
import type { GrowthAdviceReadResult } from "@/modules/organizations/application/growth-advice";
import type { Database } from "@/lib/supabase/database.types";
import type { AgentAdviceContext } from "@/modules/agent-chat/application/advice-context";

type SessionClient = SupabaseClient<Database>;

export type AgentAdviceContextInput = {
  supabase: SessionClient;
  organizationId: string;
  actorId: string;
  role: OrganizationRole;
  question: string;
  correlationId: string;
  channelId?: string;
  branchId?: string;
  requestedPeriod?: { start: string; end: string };
  grain?: GovernedMetricObservation["grain"];
  currency?: string;
  requiredMetricKeys?: readonly string[];
  /** Attached reports keep their verified scope; only advice can widen time. */
  allowPeriodFallback?: boolean;
  now?: string;
};

type AssemblyInput = Omit<AgentAdviceContextInput, "supabase"> & { timeZone: string };
type MemorySnippet = {
  itemId: string;
  title: string;
  body?: string;
  provenance: string;
  observedAt?: string;
};

export type AgentAdviceContextReads = {
  readCandidates: () => Promise<GrowthAdviceReadResult>;
  readMemory: () => Promise<readonly MemorySnippet[]>;
  readEvidence: (input: {
    windowStart: string;
    windowEnd: string;
    metricKeys: readonly string[];
  }) => Promise<readonly GovernedMetricObservation[]>;
};

function localDay(now: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(now));
}

function monthBefore(monthStart: string): string {
  const [year, month] = monthStart.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
}

function monthEnd(monthStart: string): string {
  const [year, month] = monthStart.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function previousComparableWindow(start: string, end: string): { start: string; end: string } {
  // A complete calendar month is compared with the previous calendar month.
  // An explicitly requested span is compared with an equally long span.
  if (start.endsWith("-01") && end === monthEnd(start)) {
    const previousStart = monthBefore(start);
    return { start: previousStart, end: monthEnd(previousStart) };
  }
  const days = localDaysBetween(start, end);
  if (days < 0 || days > 400) throw new Error("INVALID_ADVICE_PERIOD");
  return { start: addLocalDays(start, -(days + 1)), end: addLocalDays(start, -1) };
}

function safeHref(href: string | null, organizationId: string): string | null {
  return href?.startsWith(`/organizations/${organizationId}/`) ? href : null;
}

function usableRows(
  rows: readonly GovernedMetricObservation[],
  input: Pick<AssemblyInput, "channelId" | "branchId" | "grain" | "currency">,
  requiredMetricKeys: readonly string[],
  window: { start: string; end: string },
): GovernedMetricObservation[] {
  const scoped = rows.filter(
    (row) =>
      (!input.channelId || row.channelId === input.channelId) &&
      (!input.branchId || row.branchId === input.branchId) &&
      (!input.grain || row.grain === input.grain) &&
      (!input.currency || row.currency === input.currency) &&
      row.periodStartDate >= window.start &&
      row.periodEndDate <= window.end &&
      row.qualityTier !== "assumed" &&
      row.qualityTier !== "estimated",
  );
  // A revenue row for one channel cannot supply a missing measure for another.
  // Preserve distinct shapes as separate cited entries; never sum them.
  const groups = new Map<string, GovernedMetricObservation[]>();
  for (const row of scoped) {
    const key = [
      row.channelId,
      row.branchId ?? "",
      row.grain,
      row.currency ?? "",
      row.periodTimezone,
    ].join("|");
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) =>
      requiredMetricKeys.every((key) => group.some((row) => row.metricKey === key)),
    )
    .flat();
}

/** Assemble bounded, citable advice from independent source-owned reads. */
export async function assembleAgentAdviceContext(
  input: AssemblyInput,
  reads: AgentAdviceContextReads,
): Promise<AgentAdviceContext> {
  const entries: AgentAdviceContext["entries"] = [];
  const limitations: string[] = [];
  const requiredMetricKeys = input.requiredMetricKeys?.length
    ? [...input.requiredMetricKeys]
    : ["revenue.gross"];

  const [candidates, memory] = await Promise.allSettled([
    reads.readCandidates(),
    reads.readMemory(),
  ]);
  if (candidates.status === "fulfilled") {
    const scopedCandidates = candidates.value.candidates.filter(
      (candidate) =>
        (!input.channelId ||
          candidate.channelIds.length === 0 ||
          candidate.channelIds.includes(input.channelId)) &&
        (!input.branchId ||
          candidate.branchIds.length === 0 ||
          candidate.branchIds.includes(input.branchId)) &&
        (input.allowPeriodFallback !== false ||
          !input.requestedPeriod ||
          ((!candidate.sourceWindowStart ||
            candidate.sourceWindowStart >= input.requestedPeriod.start) &&
            (!candidate.sourceWindowEnd ||
              candidate.sourceWindowEnd <= input.requestedPeriod.end))),
    );
    for (const candidate of scopedCandidates.slice(0, 15)) {
      entries.push({
        sourceId: candidate.id,
        kind: candidate.kind === "finding" ? "insight" : candidate.kind,
        title: candidate.title,
        detail: candidate.supportingText,
        href: safeHref(candidate.href, input.organizationId),
        sourceWindowStart: candidate.sourceWindowStart,
        sourceWindowEnd: candidate.sourceWindowEnd,
        channelIds: [...candidate.channelIds].slice(0, 20),
        branchIds: [...candidate.branchIds].slice(0, 20),
        evidenceRefs: [...candidate.evidenceRefs],
      });
    }
    for (const [lane, code] of Object.entries(candidates.value.laneErrors)) {
      limitations.push(`${lane}: ${code}`);
    }
  } else limitations.push("Advice sources could not be read.");

  if (memory.status === "fulfilled") {
    for (const item of memory.value.slice(0, 5)) {
      entries.push({
        sourceId: `memory:${item.itemId}`,
        kind: "memory",
        title: item.title.slice(0, 200),
        detail:
          `${(item.body ?? "").slice(0, 800)} Source: ${item.provenance}. ${item.observedAt ? `Observed ${item.observedAt.slice(0, 10)}.` : ""}`.trim(),
        href: `/organizations/${input.organizationId}/memory`,
        sourceWindowStart: null,
        sourceWindowEnd: item.observedAt?.slice(0, 10) ?? null,
        channelIds: [],
        branchIds: [],
        evidenceRefs: [],
      });
    }
  } else limitations.push("Memory could not be read at this member's sensitivity level.");

  const currentMonthStart = `${localDay(input.now ?? new Date().toISOString(), input.timeZone).slice(0, 7)}-01`;
  const requestedStart = input.requestedPeriod?.start ?? monthBefore(currentMonthStart);
  const requestedEnd = input.requestedPeriod?.end ?? monthEnd(requestedStart);
  let selectedRows: GovernedMetricObservation[] = [];
  let selectedStart = requestedStart;
  let selectedEnd = requestedEnd;
  let currentRead: readonly GovernedMetricObservation[];
  try {
    currentRead = await reads.readEvidence({
      windowStart: requestedStart,
      windowEnd: requestedEnd,
      metricKeys: requiredMetricKeys,
    });
  } catch {
    limitations.push("Governed evidence could not be read.");
    return { entries, limitations, periodSwitch: null };
  }
  selectedRows = usableRows(currentRead, input, requiredMetricKeys, {
    start: requestedStart,
    end: requestedEnd,
  });
  let periodSwitch: AgentAdviceContext["periodSwitch"] = null;
  if (selectedRows.length === 0 && input.allowPeriodFallback !== false) {
    // Discover earlier calendar months without assuming a report exists. Each
    // candidate is verified against the governed current-row reader.
    let candidate: { start: string; end: string };
    try {
      candidate = previousComparableWindow(requestedStart, requestedEnd);
    } catch {
      limitations.push("The requested evidence period is invalid.");
      return { entries, limitations, periodSwitch: null };
    }
    for (let attempt = 0; attempt < 24; attempt += 1) {
      try {
        const rows = await reads.readEvidence({
          windowStart: candidate.start,
          windowEnd: candidate.end,
          metricKeys: requiredMetricKeys,
        });
        selectedRows = usableRows(rows, input, requiredMetricKeys, candidate);
      } catch {
        limitations.push("Earlier governed evidence could not be read.");
        break;
      }
      if (selectedRows.length > 0) {
        selectedStart = selectedRows.map((row) => row.periodStartDate).sort()[0];
        selectedEnd = selectedRows
          .map((row) => row.periodEndDate)
          .sort()
          .at(-1)!;
        periodSwitch = {
          requestedStart,
          requestedEnd,
          selectedStart,
          selectedEnd,
          reason: "The requested period has no usable governed report.",
        };
        limitations.push(
          "The requested period remains unknown; older evidence is historical context only.",
        );
        if (selectedStart !== candidate.start || selectedEnd !== candidate.end) {
          limitations.push("The selected older evidence covers only part of its candidate period.");
        }
        break;
      }
      candidate = previousComparableWindow(candidate.start, candidate.end);
    }
  }
  if (selectedRows.length === 0)
    limitations.push("No comparable governed evidence was found for this question.");
  for (const row of selectedRows.slice(0, 20)) {
    entries.push({
      sourceId: row.id,
      kind: "channel",
      title: row.metricKey,
      detail: `${row.numerator} ${row.valueKind === "money" ? `minor units (${row.currency})` : "units"}; ${row.grain} ${row.periodStartDate} to ${row.periodEndDate}; ${row.qualityTier} governed evidence in ${row.periodTimezone}.`,
      href: `/organizations/${input.organizationId}/channels/${row.channelId}`,
      sourceWindowStart: row.periodStartDate,
      sourceWindowEnd: row.periodEndDate,
      channelIds: [row.channelId],
      branchIds: row.branchId ? [row.branchId] : [],
      evidenceRefs: [row.id],
    });
  }
  return { entries, limitations, periodSwitch };
}

/** Resolve source adapters through the module composition root. */
export async function loadAgentAdviceContext(
  input: AgentAdviceContextInput,
): Promise<AgentAdviceContext> {
  const { composeAgentAdviceContext } = await import("./api");
  return composeAgentAdviceContext(input);
}

export function sharedAgentMemoryCeiling(actor: { userId: string; role: OrganizationRole }) {
  return operatorCeiling({ ...actor, role: "viewer" });
}
