import { createHash } from "node:crypto";

import { z } from "zod";

/**
 * The governed cadence for campaign research (Slice 4, Task 16).
 *
 * Research already knows how to admit one run (allowances, cooldown, pending
 * cap, idempotent replay). What it did not know is *when* to ask on its own:
 * nothing ever started a scheduled evaluation, so the allowance either sat
 * unused or was spent only by button presses. This module names the schedule
 * an organization configures and the pure rules the scheduler runs under.
 *
 * Three purses stay separate: research allowances here never authorize media
 * spend or creative preparation. The scheduler only ever admits through the
 * same governed writer a manual request uses, so scheduled and manual runs
 * obey identical limits — the cadence decides when to ask, never how much may
 * be spent.
 */

export const RESEARCH_SCHEDULE_SCHEMA_VERSION = 1;

/** What a scheduled evaluation treats as a reason to admit a run. */
export const researchQualifyingChangeKindSchema = z.enum([
  /**
   * The organization's Business Memory manifest digest moved since the last
   * evaluation. A repeated capture of the same root revision changes nothing
   * and warrants nothing; a new digest is a material change.
   */
  "memory_revision",
  /**
   * The window itself qualifies: admit on cadence whether or not anything
   * changed. An organization that wants research on a rhythm rather than on
   * change says so openly instead of getting it by accident.
   */
  "scheduled_cadence",
]);
export type ResearchQualifyingChangeKind = z.infer<typeof researchQualifyingChangeKindSchema>;

/**
 * What someone may set when they configure the research cadence.
 *
 * No schedule row is "not scheduled", never an implied cadence. An enabled
 * schedule names at least one qualifying kind: switching research on without
 * saying what warrants it would admit runs nobody asked for.
 */
export const researchScheduleInputSchema = z
  .strictObject({
    enabled: z.boolean(),
    /** Days between scheduled evaluations. A cadence, not a spending limit. */
    intervalDays: z.number().int().min(1).max(30),
    qualifyingChangeKinds: z.array(researchQualifyingChangeKindSchema).min(1).max(2),
  })
  .superRefine((schedule, context) => {
    if (new Set(schedule.qualifyingChangeKinds).size !== schedule.qualifyingChangeKinds.length) {
      context.addIssue({
        code: "custom",
        message: "Each qualifying change kind may be named only once.",
        path: ["qualifyingChangeKinds"],
      });
    }
  });
export type ResearchScheduleInput = z.infer<typeof researchScheduleInputSchema>;

const uuidSchema = z.string().uuid();

/** The schedule as the database returns it, with the scheduler's watermark. */
export const researchScheduleSchema = researchScheduleInputSchema.extend({
  organizationId: uuidSchema,
  /** When the last scheduled evaluation completed, of any outcome. Null when never. */
  lastEvaluatedAt: z.string().datetime().nullable(),
});
export type ResearchSchedule = z.infer<typeof researchScheduleSchema>;

/**
 * The start of the schedule window `now` falls in, as an ISO timestamp.
 *
 * Windows are calendar-day buckets in the organization's own timezone: the
 * local date's day-number since the epoch, integer-divided by the interval.
 * Calendar days, not 24-hour periods — so a daylight-saving transition
 * neither creates a window nor deletes one, it just moves where midnight
 * falls. The SQL writer computes the same bucket the same way; the pgTAP
 * suite proves the two agree across a DST boundary.
 */
export function scheduleWindowStart(input: {
  now: Date;
  timezone: string;
  intervalDays: number;
}): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: input.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(input.now);
  const get = (type: string): number => {
    const part = parts.find((candidate) => candidate.type === type);
    if (!part) throw new Error(`Cannot resolve the schedule window without a ${type}.`);
    return Number(part.value);
  };
  const dayNumber = Math.floor(
    Date.UTC(get("year"), get("month") - 1, get("day")) / 86_400_000,
  );
  const windowIndex = Math.floor(dayNumber / input.intervalDays);
  return new Date(windowIndex * input.intervalDays * 86_400_000).toISOString();
}

/**
 * Whether the scheduler should evaluate this organization now.
 *
 * Pure and advisory: the database rechecks under lock and is the final word.
 * A disabled schedule, a missing or disabled policy, or a recent evaluation
 * is "not due" rather than a refusal — there is nothing to refuse, only a
 * tick that finds no work.
 */
export function isScheduleDue(input: {
  schedule: ResearchSchedule | null;
  policyEnabled: boolean;
  now: Date;
}): boolean {
  const { schedule, policyEnabled, now } = input;
  if (schedule === null || !schedule.enabled || !policyEnabled) return false;
  if (schedule.lastEvaluatedAt === null) return true;
  const elapsedMs = now.getTime() - Date.parse(schedule.lastEvaluatedAt);
  return elapsedMs >= schedule.intervalDays * 86_400_000;
}

/**
 * The evidence fingerprint a scheduled evaluation is judged by.
 *
 * The manifest digest, when there is one. `no-memory` when the organization
 * has no Business Memory manifest yet — a stable value, so the first
 * evaluation warrants (or cadence-admits) and every later one with still no
 * memory recognizes the signal as seen rather than re-evaluating it.
 */
export function scheduledEvidenceFingerprint(input: {
  manifestDigest: string | null;
}): string {
  return input.manifestDigest === null ? "no-memory" : `memory:${input.manifestDigest}`;
}

/**
 * Whether the observed change warrants asking for research.
 *
 * The truth table the SQL writer mirrors: cadence qualifies on its own when
 * named; otherwise only a moved memory digest does. Memory writes alone never
 * trigger anything — this is consulted only inside a due scheduler tick, and
 * a tick with no warranted candidate stores its outcome and proposes nothing.
 */
export function isQualifyingChange(input: {
  kinds: readonly ResearchQualifyingChangeKind[];
  memoryChanged: boolean;
}): boolean {
  if (input.kinds.includes("scheduled_cadence")) return true;
  return input.kinds.includes("memory_revision") && input.memoryChanged;
}

/**
 * The idempotency key for one scheduled evaluation.
 *
 * Stable per organization, evidence fingerprint and candidate revision — not
 * per window. A retried or repeated delivery of the same evidence replays the
 * run it already admitted instead of opening a second one; genuinely new
 * evidence (a new revision) is a new key and may admit exactly one run. This
 * is what makes "one next-test proposal per material evidence revision" true
 * across retries, lease recoveries and repeated deliveries.
 */
export function scheduledIdempotencyKey(input: {
  organizationId: string;
  evidenceFingerprint: string;
  candidateRevision: string | null;
}): string {
  const parts = [
    input.organizationId,
    input.evidenceFingerprint,
    input.candidateRevision ?? "",
  ];
  return createHash("sha256")
    .update(parts.map((part) => `${part.length}:${part}`).join("|"), "utf8")
    .digest("hex");
}
