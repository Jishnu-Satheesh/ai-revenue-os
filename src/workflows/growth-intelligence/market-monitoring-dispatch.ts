import { z } from "zod";

import type { EventPublisher } from "@/domain/events/types";
import {
  isProjectEligibleForScheduledStart,
  researchProjectSchema,
} from "@/domain/growth-intelligence/project";
import {
  startMonitoringUpdate,
  type MonitoringDispatcher,
  type MonitoringProjectWriter,
  type MonitoringUpdateStore,
  type StartMonitoringUpdateInput,
} from "@/modules/growth-intelligence/application/market-monitoring-update";

/**
 * Market Monitoring dispatch: the start nudge and the cadence enqueuer (G47).
 *
 * Starting an update nudges the update task through the injected dispatcher;
 * a lost nudge never fails the start because the cadence sweep re-collects
 * undispatched actives and nudges them again. Recurring projects whose
 * schedule is due start through the same converging start path, so the sweep
 * can neither duplicate paid work nor invent completion figures: statuses
 * only, no percentages, no time promises.
 */

export const monitoringCadencePayloadSchema = z
  .object({
    correlationId: z.string().uuid(),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict();

export type MonitoringCadencePayload = z.infer<typeof monitoringCadencePayloadSchema>;

export type DueMonitoringProject = {
  organizationId: string;
  projectId: string;
  branchId: string;
  title: string;
  question: string;
  mode: "one-time" | "recurring";
  schedule?: {
    cadence: "daily" | "weekly" | "monthly";
    localTime: string;
    timeZone: string;
    endDate?: string;
  };
  lifecycle: "active" | "paused" | "archived";
  briefInputs: {
    researchArea: string;
    competitors: StartMonitoringUpdateInput["competitors"];
    investigationAreas: StartMonitoringUpdateInput["investigationAreas"];
    businessContextSnapshotId: string;
  } | null;
  actorId: string;
};

export type EnqueueDueMonitoringUpdatesDependencies = {
  listDue: (input: { limit: number }) => Promise<readonly DueMonitoringProject[]>;
  projects: MonitoringProjectWriter;
  updates: MonitoringUpdateStore;
  dispatch: MonitoringDispatcher;
  events: EventPublisher;
  now?: () => Date;
  newCorrelationId?: () => string;
};

export type DueMonitoringProjectOutcome =
  | { projectId: string; outcome: "started" | "opened_progress"; updateId: string }
  | { projectId: string; outcome: "skipped"; reason: string }
  | { projectId: string; outcome: "failed"; reason: string };

export type EnqueueDueMonitoringUpdatesResult = {
  outcome: "swept";
  started: number;
  openedProgress: number;
  renudged: number;
  skipped: number;
  projects: DueMonitoringProjectOutcome[];
};

/**
 * Cadence sweep for recurring monitoring. Due-ness timing belongs to the
 * injected lister; this caller re-verifies lifecycle eligibility (active,
 * recurring, within end date) and starts through the converging path, so a
 * repeat sweep joins rather than duplicates. Full local-time due arithmetic
 * lands with Slice 7 scheduling.
 */
export async function enqueueDueMonitoringUpdates(
  input: unknown,
  dependencies: EnqueueDueMonitoringUpdatesDependencies,
): Promise<EnqueueDueMonitoringUpdatesResult> {
  const payload = monitoringCadencePayloadSchema.parse(input);
  const now = dependencies.now ?? (() => new Date());
  const newCorrelationId =
    dependencies.newCorrelationId ?? (() => crypto.randomUUID());
  const due = await dependencies.listDue({ limit: payload.limit });

  const projects: DueMonitoringProjectOutcome[] = [];
  let started = 0;
  let openedProgress = 0;
  let skipped = 0;

  for (const candidate of due.slice(0, payload.limit)) {
    const parsedProject = researchProjectSchema.safeParse({
      projectId: candidate.projectId,
      organizationId: candidate.organizationId,
      locationId: candidate.branchId,
      title: candidate.title,
      question: candidate.question,
      mode: candidate.mode,
      ...(candidate.mode === "recurring" && candidate.schedule
        ? { schedule: candidate.schedule }
        : {}),
      lifecycle: candidate.lifecycle,
    });
    if (!parsedProject.success) {
      skipped += 1;
      projects.push({ projectId: candidate.projectId, outcome: "skipped", reason: "invalid" });
      continue;
    }
    let eligible = false;
    try {
      eligible = isProjectEligibleForScheduledStart(parsedProject.data, now().toISOString());
    } catch {
      eligible = false;
    }
    if (!eligible) {
      skipped += 1;
      projects.push({ projectId: candidate.projectId, outcome: "skipped", reason: "not_due" });
      continue;
    }
    if (!candidate.briefInputs) {
      // Production listers cannot rebuild brief scope until brief-document
      // reads land: skipping honestly instead of starting scope-blind work.
      skipped += 1;
      projects.push({ projectId: candidate.projectId, outcome: "skipped", reason: "scope_unavailable" });
      continue;
    }
    try {
      const result = await startMonitoringUpdate(
        {
          organizationId: candidate.organizationId,
          branchId: candidate.branchId,
          title: candidate.title,
          question: candidate.question,
          mode: candidate.mode,
          ...(candidate.schedule ? { schedule: candidate.schedule } : {}),
          researchArea: candidate.briefInputs.researchArea,
          competitors: candidate.briefInputs.competitors,
          investigationAreas: candidate.briefInputs.investigationAreas,
          businessContextSnapshotId: candidate.briefInputs.businessContextSnapshotId,
          actorId: candidate.actorId,
          idempotencyKey: `cadence:${candidate.projectId}:${now().toISOString().slice(0, 10)}`,
          correlationId: newCorrelationId(),
        },
        {
          projects: dependencies.projects,
          updates: dependencies.updates,
          dispatch: dependencies.dispatch,
          events: dependencies.events,
          now,
        },
      );
      if (result.outcome === "started") {
        started += 1;
        projects.push({ projectId: candidate.projectId, outcome: "started", updateId: result.updateId });
      } else {
        openedProgress += 1;
        projects.push({
          projectId: candidate.projectId,
          outcome: "opened_progress",
          updateId: result.updateId,
        });
      }
    } catch {
      projects.push({ projectId: candidate.projectId, outcome: "failed", reason: "start_failed" });
    }
  }

  // Lost-dispatch recovery: undispatched actives get nudged again. The update
  // worker replays idempotently, so a duplicate nudge converges instead of
  // duplicating paid work.
  let renudged = 0;
  const stale = await dependencies.updates.listUndispatched({ limit: payload.limit });
  for (const record of stale.slice(0, payload.limit)) {
    if (!record.brief) continue;
    try {
      await dependencies.dispatch.nudge({
        organizationId: record.organizationId,
        projectId: record.projectId,
        updateId: record.updateId,
        briefRevisionId: record.briefRevisionId,
        brief: record.brief,
        actorId: record.actorId,
        correlationId: newCorrelationId(),
      });
      await dependencies.updates.markDispatched({
        organizationId: record.organizationId,
        updateId: record.updateId,
      });
      renudged += 1;
    } catch {
      continue;
    }
  }

  return { outcome: "swept", started, openedProgress, renudged, skipped, projects };
}
