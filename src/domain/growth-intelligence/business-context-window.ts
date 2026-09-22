import { z } from "zod";

import { addLocalDays, localDaysBetween } from "@/domain/analysis/calendar";

/**
 * Dynamic business-context window for Market Watch research.
 *
 * The New research dialog summarizes the channel evidence the research will
 * use as "Channel reports · …". That summary must always read the last 30–60
 * days of AVAILABLE channel evidence counted back from the day research is
 * initiated — never a hardcoded range. Reports arriving later move the window
 * forward; a short history shrinks it instead of inventing days.
 *
 * Pure calendar arithmetic on YYYY-MM-DD dates (UTC). Coverage arrives as the
 * declared channel-evidence stretches; the window never reaches outside them.
 */

export const BUSINESS_CONTEXT_WINDOW_MAX_DAYS = 60;
export const BUSINESS_CONTEXT_WINDOW_MIN_DAYS = 30;

const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Date must be a real calendar date (YYYY-MM-DD).");

export const businessContextCoverageSchema = z
  .object({
    start: calendarDateSchema,
    end: calendarDateSchema,
  })
  .strict()
  .refine((segment) => segment.start <= segment.end, {
    message: "Coverage must not end before it starts.",
  });

export const resolveBusinessContextWindowInputSchema = z
  .object({
    initiationDay: calendarDateSchema,
    coverage: z.array(businessContextCoverageSchema).max(200),
  })
  .strict();

export type BusinessContextWindow = {
  from: string;
  to: string;
};

function mergeSegments(segments: readonly { start: string; end: string }[]): {
  start: string;
  end: string;
}[] {
  const sorted = [...segments]
    .filter((segment) => segment.start <= segment.end)
    .sort((left, right) => left.start.localeCompare(right.start));
  const merged: { start: string; end: string }[] = [];
  for (const segment of sorted) {
    const last = merged[merged.length - 1];
    if (last && segment.start <= addLocalDays(last.end, 1)) {
      if (segment.end > last.end) last.end = segment.end;
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
}

/**
 * Resolve the business-context window ending at initiation.
 *
 * - `to` is the initiation day when evidence covers it, otherwise the last
 *   available evidence day at or before initiation (never a future invention).
 * - `from` reaches back up to 60 days where evidence exists. When the
 *   containing stretch holds fewer than 60 days, the window shrinks to what
 *   exists (at least 30 days when 30 exist, otherwise whatever exists).
 * - Null when no evidence exists at or before initiation.
 */
export function resolveBusinessContextWindow(input: {
  initiationDay: string;
  coverage: readonly { start: string; end: string }[];
}): BusinessContextWindow | null {
  const parsed = resolveBusinessContextWindowInputSchema.parse(input);
  const merged = mergeSegments(parsed.coverage);
  if (merged.length === 0) return null;
  if (parsed.initiationDay < (merged[0]?.start ?? parsed.initiationDay)) return null;

  const containing = merged.find(
    (segment) => segment.start <= parsed.initiationDay && parsed.initiationDay <= segment.end,
  );
  let anchor: { start: string; end: string } | null = containing ?? null;
  let to: string;
  if (anchor) {
    to = parsed.initiationDay;
  } else {
    const prior = [...merged]
      .filter((segment) => segment.end <= parsed.initiationDay)
      .sort((left, right) => (left.end < right.end ? 1 : -1))[0];
    if (!prior) return null;
    anchor = prior;
    to = prior.end;
  }

  const availableDays = localDaysBetween(anchor.start, to) + 1;
  if (availableDays >= BUSINESS_CONTEXT_WINDOW_MAX_DAYS) {
    return { from: addLocalDays(to, -(BUSINESS_CONTEXT_WINDOW_MAX_DAYS - 1)), to };
  }
  return { from: anchor.start, to };
}

/**
 * One brief evidence period for the resolved window. The label keeps the
 * dialog's "Channel reports · …" prefix so the business-context summary reads
 * the same range the research actually uses; start/end dates travel alongside
 * for exactness.
 */
export function buildBusinessContextEvidencePeriod(window: BusinessContextWindow): {
  label: string;
  startDate: string;
  endDate: string;
} {
  const parsed = z
    .object({ from: calendarDateSchema, to: calendarDateSchema })
    .strict()
    .refine((value) => value.from <= value.to, {
      message: "Evidence window must not end before it starts.",
    })
    .parse(window);
  return {
    label: `Channel reports · ${parsed.from}–${parsed.to}`,
    startDate: parsed.from,
    endDate: parsed.to,
  };
}
