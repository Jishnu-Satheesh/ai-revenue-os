import { z } from "zod";

import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import {
  isTerminalPipelineStage,
  type ResearchPipelineStage,
} from "@/domain/growth-intelligence/research-pipeline";

/**
 * Research project lifecycle contracts.
 *
 * Several independent projects coexist at one location: starting, pausing,
 * or archiving one project never touches another project. Pausing stops
 * future scheduled starts only; a current update keeps running. Archiving
 * removes the project from the active list and stops its schedules while
 * keeping its history readable. Cancelling a current update is a separate
 * explicit action that lands the update in the terminal `cancelled` stage
 * instead of deleting anything.
 */

export const RESEARCH_PROJECT_MODES = ["one-time", "recurring"] as const;

export type ResearchProjectMode = (typeof RESEARCH_PROJECT_MODES)[number];

export const RESEARCH_PROJECT_LIFECYCLES = ["active", "paused", "archived"] as const;

export type ResearchProjectLifecycle = (typeof RESEARCH_PROJECT_LIFECYCLES)[number];

export const RESEARCH_PROJECT_CADENCES = ["daily", "weekly", "monthly"] as const;

export type ResearchProjectCadence = (typeof RESEARCH_PROJECT_CADENCES)[number];

const localTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((timeZone) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone }).format();
      return true;
    } catch {
      return false;
    }
  }, "Timezone must be a valid IANA timezone.");

const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "End date must be a real calendar date (YYYY-MM-DD).");

export const researchProjectScheduleSchema = z
  .object({
    cadence: z.enum(RESEARCH_PROJECT_CADENCES),
    localTime: localTimeSchema,
    timeZone: timeZoneSchema,
    endDate: calendarDateSchema.optional(),
  })
  .strict();

export type ResearchProjectSchedule = z.infer<typeof researchProjectScheduleSchema>;

const researchProjectBaseSchema = z.object({
  projectId: z.string().uuid(),
  organizationId: z.string().uuid(),
  locationId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  question: z.string().trim().min(1).max(2_000),
  lifecycle: z.enum(RESEARCH_PROJECT_LIFECYCLES),
});

/**
 * One-time projects run on explicit starts only and carry no schedule.
 * Recurring projects require a schedule with cadence, local time/timezone,
 * and an optional end date.
 */
export const researchProjectSchema = z.discriminatedUnion("mode", [
  researchProjectBaseSchema
    .extend({ mode: z.literal("one-time"), schedule: z.never().optional() })
    .strict(),
  researchProjectBaseSchema
    .extend({ mode: z.literal("recurring"), schedule: researchProjectScheduleSchema })
    .strict(),
]);

export type ResearchProject = z.infer<typeof researchProjectSchema>;

/**
 * Replay-safe transitions: staying in the current lifecycle is a no-op so
 * retried writes do not fail. Archived projects accept no further movement.
 */
const PROJECT_LIFECYCLE_TRANSITIONS: Record<
  ResearchProjectLifecycle,
  readonly ResearchProjectLifecycle[]
> = {
  active: ["active", "paused", "archived"],
  paused: ["paused", "active", "archived"],
  archived: ["archived"],
};

export function canTransitionProjectLifecycle(
  from: ResearchProjectLifecycle,
  to: ResearchProjectLifecycle,
): boolean {
  return PROJECT_LIFECYCLE_TRANSITIONS[from].includes(to);
}

export function applyProjectLifecycle(
  project: ResearchProject,
  next: ResearchProjectLifecycle,
): ResearchProject {
  const parsed = researchProjectSchema.parse(project);
  if (!canTransitionProjectLifecycle(parsed.lifecycle, next)) {
    throw new GrowthIntelligenceError(
      "RESEARCH_PROJECT_TRANSITION_INVALID",
      `A research project cannot move from ${parsed.lifecycle} to ${next}.`,
    );
  }
  return { ...parsed, lifecycle: next };
}

/** Pausing stops future scheduled starts; the current update is untouched. */
export function pauseResearchProject(project: ResearchProject): ResearchProject {
  return applyProjectLifecycle(project, "paused");
}

/** Resuming schedules the next run; it never rewrites a finished update. */
export function resumeResearchProject(project: ResearchProject): ResearchProject {
  return applyProjectLifecycle(project, "active");
}

/** Archiving drops the project from the active list; history stays readable. */
export function archiveResearchProject(project: ResearchProject): ResearchProject {
  return applyProjectLifecycle(project, "archived");
}

export function isProjectVisibleInActiveList(project: ResearchProject): boolean {
  return researchProjectSchema.parse(project).lifecycle !== "archived";
}

/** History entries stay readable in every lifecycle, including archived. */
export function canReadProjectHistory(project: ResearchProject): boolean {
  researchProjectSchema.parse(project);
  return true;
}

/**
 * Only active recurring projects with a schedule may start on their own.
 * One-time projects start manually, so they are never schedule-eligible.
 * The optional end date is an inclusive calendar date compared in UTC days;
 * exact local-midnight scheduling semantics belong to the Slice 2 enqueuer.
 */
export function isProjectEligibleForScheduledStart(
  project: ResearchProject,
  nowIso: string,
): boolean {
  const parsed = researchProjectSchema.parse(project);
  if (parsed.lifecycle !== "active") return false;
  if (parsed.mode !== "recurring" || !parsed.schedule) return false;
  const now = new Date(nowIso);
  if (Number.isNaN(now.getTime())) {
    throw new GrowthIntelligenceError(
      "RESEARCH_PROJECT_SCHEDULE_INVALID",
      "Scheduled-start eligibility needs a readable timestamp.",
    );
  }
  if (!parsed.schedule.endDate) return true;
  return now.toISOString().slice(0, 10) <= parsed.schedule.endDate;
}

/**
 * Cancelling the current update is its own explicit action: a non-terminal
 * update stage lands in the terminal `cancelled` stage. Cancelling an
 * already-terminal update is a conflict, never a silent success, and
 * cancelling deletes nothing.
 */
export function cancelResearchUpdate(stage: ResearchPipelineStage): ResearchPipelineStage {
  if (isTerminalPipelineStage(stage)) {
    throw new GrowthIntelligenceError(
      "RESEARCH_UPDATE_CANCEL_CONFLICT",
      "A finished research update cannot be cancelled again.",
    );
  }
  return "cancelled";
}

/** Tenant fence: a project id from another organization is refused. */
export function assertProjectOrganization(
  project: ResearchProject,
  organizationId: string,
): void {
  const parsed = researchProjectSchema.parse(project);
  if (parsed.organizationId !== organizationId) {
    throw new GrowthIntelligenceError(
      "RESEARCH_TENANT_MISMATCH",
      "This research project belongs to another organization.",
    );
  }
}
