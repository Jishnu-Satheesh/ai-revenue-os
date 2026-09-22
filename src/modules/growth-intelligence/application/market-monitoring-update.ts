import { createHash } from "node:crypto";

import { z } from "zod";

import type { EventPublisher } from "@/domain/events/types";
import {
  assertBriefRevisionContext,
  BRIEF_INVESTIGATION_AREAS,
  briefCompetitorSchema,
  briefRevisionSchema,
  type BriefInvestigationArea,
  type BriefRevision,
} from "@/domain/growth-intelligence/brief";
import {
  assertReportContext,
  marketMonitoringReportSchema,
  speculativeEstimateSchema,
  type MarketMonitoringReport,
} from "@/domain/growth-intelligence/report";
import {
  researchAttemptUsageSchema,
  researchCoverageEntrySchema,
  sumKnownAttemptCost,
  type ResearchAttemptUsage,
  type ResearchPipelineStage,
} from "@/domain/growth-intelligence/research-pipeline";
import {
  RESEARCH_PROJECT_LIFECYCLES,
  researchProjectScheduleSchema,
} from "@/domain/growth-intelligence/project";
import { DomainError } from "@/lib/errors";
import {
  buildBusinessContextEvidencePeriod,
  resolveBusinessContextWindow,
} from "@/domain/growth-intelligence/business-context-window";
import {
  monitoringCompetitorSlotKey,
  monitoringAreaSlotKey,
  type MonitoringResearchQuery,
} from "@/modules/growth-intelligence/application/market-monitoring-context";

/**
 * Market Monitoring project/update orchestration (Slice 3).
 *
 * A research update is one background attempt against a pinned brief
 * revision. Starting follows the atomic reviewed-start pattern: the project
 * row, the pinned brief revision and the update converge through fenced
 * writes, so retries and duplicate deliveries never duplicate paid work. A
 * manual refresh while an update is active opens progress instead of starting
 * new work. Terminal success is a persisted version-pinned report; a failed
 * refresh retains the prior successful report by never writing on failure
 * paths.
 *
 * Durable update-status rows await the Slice 7 lifecycle migration, so the
 * `MonitoringUpdateStore` seam owns the lifecycle contract and tests run it
 * against fakes. Production (see the Trigger wiring) converges starts on the
 * `save_brief_revision` conflict path and observes terminal success through
 * report rows; in-flight and terminal-failure states travel in the task
 * result and identifier-only events.
 */

// G45: one coherent deadline proposal. Paid research (adapter calls plus
// model extraction) fits inside the Trigger task duration with headroom left
// for the fenced settle and report persist; the database lease stays longest
// so a legitimate run is never fenced off mid-write. Nothing here extends
// paid-work time: the envelope (240s) sits well under the branch-path Brave
// deadline (8 minutes) it replaces for updates.
export const MONITORING_UPDATE_TASK_MAX_DURATION_S = 300;
export const MONITORING_UPDATE_TASK_MAX_DURATION_MS =
  MONITORING_UPDATE_TASK_MAX_DURATION_S * 1_000;
export const MONITORING_UPDATE_RESEARCH_DEADLINE_MS = 240_000;
export const MONITORING_UPDATE_SETTLE_HEADROOM_MS = 60_000;
export const MONITORING_UPDATE_ADAPTER_TIMEOUT_MS = 20_000;
export const MONITORING_UPDATE_LEASE_SECONDS = 600;

export const MONITORING_UPDATE_TERMINAL_STAGES = [
  "ready",
  "partial",
  "no_findings",
  "research_failed",
  "synthesis_failed",
  "cancelled",
] as const satisfies readonly ResearchPipelineStage[];

export type MonitoringUpdateTerminalStage =
  (typeof MONITORING_UPDATE_TERMINAL_STAGES)[number];

/**
 * The update lifecycle reuses the pipeline stages. `no_findings` is the
 * stored form of the spec's "empty": research finished healthy with nothing
 * usable to persist.
 */
export type MonitoringUpdateStatus = ResearchPipelineStage;

export const startMonitoringUpdateInputSchema = z
  .object({
    organizationId: z.string().uuid(),
    branchId: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    question: z.string().trim().min(1).max(2_000),
    mode: z.enum(["one-time", "recurring"]),
    schedule: researchProjectScheduleSchema.optional(),
    researchArea: z.string().trim().min(1).max(160),
    competitors: z.array(briefCompetitorSchema).max(20),
    investigationAreas: z.array(z.enum(BRIEF_INVESTIGATION_AREAS)).min(1).max(5),
    businessContextSnapshotId: z.string().uuid(),
    actorId: z.string().uuid(),
    idempotencyKey: z.string().trim().min(1).max(200),
    correlationId: z.string().uuid(),
    refresh: z.boolean().optional().default(false),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.mode === "recurring" && !input.schedule) {
      context.addIssue({
        code: "custom",
        path: ["schedule"],
        message: "A recurring project needs a schedule.",
      });
    }
    if (input.mode === "one-time" && input.schedule) {
      context.addIssue({
        code: "custom",
        path: ["schedule"],
        message: "A one-time project runs on explicit starts and carries no schedule.",
      });
    }
  });

export type StartMonitoringUpdateInput = z.infer<typeof startMonitoringUpdateInputSchema>;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Convergence fingerprint for an update request: identical active scope
 * fingerprints the same way, so retries and duplicate deliveries join the
 * running update instead of starting new paid work. Identity fields
 * (project, revision and update ids) stay out: scope equality is about the
 * ask, not the row.
 */
export function fingerprintMonitoringScope(input: {
  organizationId: string;
  branchId: string;
  title: string;
  question: string;
  mode: "one-time" | "recurring";
  schedule?: z.infer<typeof researchProjectScheduleSchema>;
  researchArea: string;
  competitors: unknown;
  investigationAreas: readonly string[];
  businessContextSnapshotId: string;
  frequency: string;
}): string {
  const normalized = {
    organizationId: z.string().uuid().parse(input.organizationId),
    branchId: z.string().uuid().parse(input.branchId),
    title: z.string().trim().min(1).max(200).parse(input.title),
    question: z.string().trim().min(1).max(2_000).parse(input.question),
    mode: z.enum(["one-time", "recurring"]).parse(input.mode),
    schedule: input.schedule ?? null,
    researchArea: z.string().trim().min(1).max(160).parse(input.researchArea),
    competitors: z.array(briefCompetitorSchema).max(20).parse(input.competitors),
    investigationAreas: z
      .array(z.enum(BRIEF_INVESTIGATION_AREAS))
      .min(1)
      .max(5)
      .parse([...input.investigationAreas].sort()),
    businessContextSnapshotId: z
      .string()
      .uuid()
      .parse(input.businessContextSnapshotId),
    frequency: z.string().trim().min(1).max(40).parse(input.frequency),
  };
  return sha256(canonicalize(normalized));
}

export const MONITORING_COVERAGE_STATUSES = [
  "supported",
  "unavailable",
  "not-found",
  "not-researched",
] as const;

export type MonitoringCoverageStatus = (typeof MONITORING_COVERAGE_STATUSES)[number];

export const monitoringCoverageEntrySchema = z
  .object({
    dimensionKind: z.enum(["investigation_area", "competitor"]),
    dimensionKey: z.string().trim().min(1).max(160),
    label: z.string().trim().min(1).max(240),
    status: z.enum(MONITORING_COVERAGE_STATUSES),
  })
  .strict();

export type MonitoringCoverageEntry = z.infer<typeof monitoringCoverageEntrySchema>;

/**
 * Coverage checklist over every requested dimension: each investigation area
 * and each named competitor reports supported / unavailable / not-found /
 * not-researched. Retrieval success alone is not support: a searched slot
 * with no cited finding is not-found, never silently omitted.
 */
export function buildMonitoringCoverageChecklist(input: {
  brief: BriefRevision;
  retrievalCoverage: ReadonlyArray<z.input<typeof researchCoverageEntrySchema>>;
  supportedSlotKeys: ReadonlySet<string>;
}): MonitoringCoverageEntry[] {
  const brief = briefRevisionSchema.parse(input.brief);
  const retrieval = z.array(researchCoverageEntrySchema).parse([...input.retrievalCoverage]);
  const bySlot = new Map(retrieval.map((entry) => [entry.slotKey, entry.outcome] as const));

  const dimensions: Array<{
    dimensionKind: "investigation_area" | "competitor";
    dimensionKey: string;
    label: string;
  }> = [
    ...brief.investigationAreas.map((area: BriefInvestigationArea) => ({
      dimensionKind: "investigation_area" as const,
      dimensionKey: monitoringAreaSlotKey(area),
      label: area,
    })),
    ...brief.competitors.map((competitor) => ({
      dimensionKind: "competitor" as const,
      dimensionKey: monitoringCompetitorSlotKey(competitor.name),
      label: competitor.name,
    })),
  ];

  return dimensions.map((dimension) => {
    const outcome = bySlot.get(dimension.dimensionKey);
    let status: MonitoringCoverageStatus;
    if (outcome === "supported" && input.supportedSlotKeys.has(dimension.dimensionKey)) {
      status = "supported";
    } else if (
      outcome === "supported" ||
      outcome === "searched_no_usable_evidence"
    ) {
      status = "not-found";
    } else if (outcome === "failed" || outcome === "skipped_policy") {
      status = "unavailable";
    } else {
      status = "not-researched";
    }
    return monitoringCoverageEntrySchema.parse({ ...dimension, status });
  });
}

const monitoringCitationSchema = z
  .object({
    claimId: z.string().uuid(),
    sourceRef: z.string().trim().min(1).max(240).optional(),
  })
  .strict();

export const monitoringResearchFindingSchema = z
  .object({
    key: z.string().trim().min(1).max(120),
    statement: z.string().trim().min(1).max(2_000),
    slotKey: z.string().trim().min(1).max(160),
    citations: z.array(monitoringCitationSchema).min(1).max(50),
  })
  .strict();

export type MonitoringResearchFinding = z.infer<typeof monitoringResearchFindingSchema>;

export const monitoringResearchSourceSchema = z
  .object({
    sourceRef: z.string().trim().min(1).max(240),
    url: z.string().trim().min(1).max(2_048).optional(),
    retrievedAtUtc: z.string().datetime().optional(),
  })
  .strict();

export type MonitoringResearchSource = z.infer<typeof monitoringResearchSourceSchema>;

export const monitoringDraftAdviceSchema = z
  .object({
    itemKey: z.string().trim().min(1).max(160),
    kind: z.enum(["action", "finding"]),
    title: z.string().trim().min(1).max(240),
    detail: z.string().trim().min(1).max(2_000),
  })
  .strict();

export type MonitoringDraftAdvice = z.infer<typeof monitoringDraftAdviceSchema>;

export type MonitoringResearchOutcome =
  | {
      status: "succeeded";
      retrievalCoverage: Array<z.input<typeof researchCoverageEntrySchema>>;
      findings: MonitoringResearchFinding[];
      sources: MonitoringResearchSource[];
      draftAdvice: MonitoringDraftAdvice[];
      speculativeEstimate?: z.infer<typeof speculativeEstimateSchema>;
      usages: ResearchAttemptUsage[];
    }
  | {
      status: "failed";
      code: string;
      retrievalCoverage: Array<z.input<typeof researchCoverageEntrySchema>>;
      usages: ResearchAttemptUsage[];
    }
  | { status: "cancelled" };

export type MonitoringBriefIdentity = {
  manifestId: string | null;
  contextDigest: string | null;
  briefFingerprint: string;
};

export type MonitoringResearcher = (input: {
  organizationId: string;
  projectId: string;
  updateId: string;
  briefRevisionId: string;
  queries: MonitoringResearchQuery[];
  briefIdentity: MonitoringBriefIdentity | null;
  deadlineMs: number;
  signal?: AbortSignal;
}) => Promise<MonitoringResearchOutcome>;

export type MonitoringUpdateRecord = {
  updateId: string;
  organizationId: string;
  projectId: string;
  actorId: string;
  idempotencyKey: string;
  briefRevisionId: string;
  revisionNumber: number;
  scopeFingerprint: string;
  status: MonitoringUpdateStatus;
  reportVersionId: string | null;
  synthesisReportVersionId: string | null;
  coverage: MonitoringCoverageEntry[] | null;
  knownCostMicrosUsd: number;
  unknownCostCount: number;
  dispatched: boolean;
  brief: BriefRevision | null;
  createdAt: string;
  updatedAt: string;
};

export type MonitoringUpdateStore = {
  findActive(input: { organizationId: string; projectId: string }): Promise<MonitoringUpdateRecord | null>;
  /**
   * Reservation lifecycle: `open` reserves under the caller retry key with
   * an unbound revision (`briefRevisionId: ""`, `brief: null`); `bindRevision`
   * attaches the pinned save before any event or nudge. Same key reopens the
   * reservation (crash resume); a rival reservation converges
   * (`created: false`) so concurrent starts join instead of duplicating paid
   * work. Same key with a different scope fingerprint is a retry-key reuse
   * conflict (`RESEARCH_IDEMPOTENCY_CONFLICT`).
   */
  open(input: {
    organizationId: string;
    projectId: string;
    actorId: string;
    revisionNumber: number;
    scopeFingerprint: string;
    updateId: string;
    idempotencyKey: string;
    nowIso: string;
  }): Promise<{ record: MonitoringUpdateRecord; created: boolean }>;
  bindRevision(input: {
    organizationId: string;
    updateId: string;
    briefRevisionId: string;
    revisionNumber: number;
    brief: BriefRevision;
  }): Promise<MonitoringUpdateRecord>;
  get(input: { organizationId: string; updateId: string }): Promise<MonitoringUpdateRecord | null>;
  listUndispatched(input: { limit: number }): Promise<MonitoringUpdateRecord[]>;
  markDispatched(input: { organizationId: string; updateId: string }): Promise<MonitoringUpdateRecord>;
  /**
   * The fenced settle: research completion and the synthesis child commit as
   * one unit. Implementations must apply both or neither; the worker calls
   * this exactly once per research outcome, so root-research success alone
   * never marks the update ready.
   */
  completeResearchAndAttachSynthesis(input: {
    organizationId: string;
    updateId: string;
    coverage: MonitoringCoverageEntry[];
    knownCostMicrosUsd: number;
    unknownCostCount: number;
    synthesis: { reportVersionId: string; findingCount: number; sourceCount: number } | { failedCode: string };
    nowIso: string;
  }): Promise<MonitoringUpdateRecord>;
  markTerminal(input: {
    organizationId: string;
    updateId: string;
    stage: MonitoringUpdateTerminalStage;
    reportVersionId?: string;
    nowIso: string;
  }): Promise<MonitoringUpdateRecord>;
};

export type MonitoringReportPersister = {
  persist(input: {
    organizationId: string;
    projectId: string;
    branchId: string;
    briefRevisionId: string;
    reportVersionId: string;
    evidenceDigest: string;
    content: unknown;
    actorId: string;
  }): Promise<{
    reportId: string;
    reportVersionId: string;
    reviewState: string;
    replayed: boolean;
  }>;
};

export type MonitoringDispatcher = {
  nudge(input: {
    organizationId: string;
    projectId: string;
    updateId: string;
    briefRevisionId: string;
    brief: BriefRevision;
    actorId: string;
    correlationId: string;
  }): Promise<void>;
};

export type MonitoringProjectWriter = {
  createProject(input: {
    organizationId: string;
    branchId: string;
    title: string;
    question: string;
    mode: "one-time" | "recurring";
    schedule?: z.infer<typeof researchProjectScheduleSchema>;
    actorId: string;
    /**
     * I-04 route adoption: when present, creation goes through the keyed
     * RPC, so redelivered starts replay the kept project, same key with
     * another body conflicts, and identical scopes converge instead of
     * forking paid work. Absent preserves the unkeyed operation exactly.
     */
    idempotencyKey?: string;
    scopeFingerprint?: string;
  }): Promise<{ projectId: string; lifecycle: string; replayed: boolean }>;
  saveBriefRevision(input: {
    organizationId: string;
    projectId: string;
    revisionNumber: number;
    document: unknown;
    pinnedToUpdateId: string | null;
    actorId: string;
  }): Promise<{ revisionId: string; revisionNumber: number; replayed: boolean }>;
  listBriefRevisions(input: {
    organizationId: string;
    projectId: string;
    limit?: number;
  }): Promise<Array<{ revisionId: string; revisionNumber: number }>>;
  listActiveProjects(input: {
    organizationId: string;
    branchId?: string;
    limit?: number;
  }): Promise<
    Array<{
      projectId: string;
      title: string;
      question: string;
      mode: "one-time" | "recurring";
      lifecycle: (typeof RESEARCH_PROJECT_LIFECYCLES)[number];
    }>
  >;
};

function publishEvent(
  events: EventPublisher,
  input: {
    organizationId: string;
    eventName: string;
    correlationId: string;
    occurredAt: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  return events.publish({
    organizationId: input.organizationId,
    eventId: crypto.randomUUID(),
    eventName: input.eventName,
    occurredAt: input.occurredAt,
    actorType: "system",
    correlationId: input.correlationId,
    schemaVersion: 1,
    payload: input.payload,
  });
}

function briefFrequencyForMode(mode: "one-time" | "recurring", schedule?: { cadence: string }): string {
  if (mode === "one-time") return "once";
  return schedule?.cadence ?? "weekly";
}

function isRevisionConflict(error: unknown): boolean {
  const message =
    typeof (error as { message?: unknown } | null)?.message === "string"
      ? (error as { message: string }).message
      : "";
  return message.includes("pinned") || message.includes("conflict");
}

export type StartMonitoringUpdateResult =
  | {
      outcome: "started";
      projectId: string;
      updateId: string;
      briefRevisionId: string;
      revisionNumber: number;
      nudge: "sent" | "lost";
      correlationId: string;
    }
  | {
      outcome: "opened_progress";
      projectId: string;
      updateId: string;
      correlationId: string;
    };

/**
 * Project start with reviewed-start convergence.
 *
 * Identical active scope converges: an active update for the project (or a
 * lost save race) returns `opened_progress` without touching paid work. Only
 * a fresh update publishes `market_research.requested` and nudges dispatch,
 * and a lost nudge never fails the start: the update stays undispatched for
 * the cadence sweep.
 */
export async function startMonitoringUpdate(
  input: unknown,
  dependencies: {
    projects: MonitoringProjectWriter;
    updates: MonitoringUpdateStore;
    dispatch: MonitoringDispatcher;
    events: EventPublisher;
    now?: () => Date;
    newUpdateId?: () => string;
    newRevisionId?: () => string;
  },
): Promise<StartMonitoringUpdateResult> {
  const parsed = startMonitoringUpdateInputSchema.parse(input);
  const now = dependencies.now ?? (() => new Date());
  const newUpdateId = dependencies.newUpdateId ?? (() => crypto.randomUUID());
  const newRevisionId = dependencies.newRevisionId ?? (() => crypto.randomUUID());
  const frequency = briefFrequencyForMode(parsed.mode, parsed.schedule);

  const scopeFingerprint = fingerprintMonitoringScope({
    organizationId: parsed.organizationId,
    branchId: parsed.branchId,
    title: parsed.title,
    question: parsed.question,
    mode: parsed.mode,
    schedule: parsed.schedule,
    researchArea: parsed.researchArea,
    competitors: parsed.competitors,
    investigationAreas: parsed.investigationAreas,
    businessContextSnapshotId: parsed.businessContextSnapshotId,
    frequency,
  });

  // Keyed creation closes the duplicate-project race the read-then-create
  // below can only narrow: the same key with the same body replays the kept
  // project, the same key with another body conflicts honestly, and an
  // identical scope under another key converges instead of forking paid work.
  // Twin reuse still runs first so a joined live project never mints a key
  // row for work that already exists.
  const siblings = await dependencies.projects.listActiveProjects({
    organizationId: parsed.organizationId,
    branchId: parsed.branchId,
    limit: 50,
  });
  const twin = siblings.find(
    (project) =>
      project.title === parsed.title &&
      project.question === parsed.question &&
      project.mode === parsed.mode,
  );
  const created = twin
    ? { projectId: twin.projectId, lifecycle: twin.lifecycle, replayed: true }
    : await dependencies.projects.createProject({
        organizationId: parsed.organizationId,
        branchId: parsed.branchId,
        title: parsed.title,
        question: parsed.question,
        mode: parsed.mode,
        ...(parsed.schedule ? { schedule: parsed.schedule } : {}),
        actorId: parsed.actorId,
        idempotencyKey: parsed.idempotencyKey,
        scopeFingerprint,
      });
  const projectId = created.projectId;

  // Best-effort delivery on the join path: a joined update that never got
  // its nudge is nudged now when the store still holds its brief. Joining
  // never starts new work; it only assures delivery of existing work.
  const ensureNudged = async (record: {
    updateId: string;
    briefRevisionId: string;
    dispatched: boolean;
    brief: BriefRevision | null;
  }): Promise<void> => {
    if (record.dispatched || !record.brief) return;
    try {
      await dependencies.dispatch.nudge({
        organizationId: parsed.organizationId,
        projectId,
        updateId: record.updateId,
        briefRevisionId: record.briefRevisionId,
        brief: record.brief,
        actorId: parsed.actorId,
        correlationId: parsed.correlationId,
      });
      await dependencies.updates.markDispatched({
        organizationId: parsed.organizationId,
        updateId: record.updateId,
      });
    } catch {
      return;
    }
  };

  const joinActive = async (): Promise<StartMonitoringUpdateResult | null> => {
    const active = await dependencies.updates.findActive({
      organizationId: parsed.organizationId,
      projectId,
    });
    if (!active) return null;
    // Unbound reservations hold nothing durable yet: fall through so `open`
    // adopts (same key) or steals (rival key) them instead of blocking.
    if (!active.briefRevisionId) return null;
    // Same retry key on a bound update: fall through and rejoin it below.
    if (active.idempotencyKey === parsed.idempotencyKey) return null;
    await ensureNudged(active);
    return {
      outcome: "opened_progress",
      projectId,
      updateId: active.updateId,
      correlationId: parsed.correlationId,
    };
  };

  const alreadyRunning = await joinActive();
  if (alreadyRunning) return alreadyRunning;

  const revisions = await dependencies.projects.listBriefRevisions({
    organizationId: parsed.organizationId,
    projectId,
    limit: 50,
  });
  const revisionNumber = revisions.reduce((max, revision) => Math.max(max, revision.revisionNumber), 0) + 1;
  // Reserve the update before the pinned save: the store is idempotent on
  // the retry key, so a crash between reserve and save resumes with the same
  // update id instead of orphaning a revision.
  const reserved = await dependencies.updates.open({
    organizationId: parsed.organizationId,
    projectId,
    actorId: parsed.actorId,
    revisionNumber,
    scopeFingerprint,
    updateId: newUpdateId(),
    idempotencyKey: parsed.idempotencyKey,
    nowIso: now().toISOString(),
  });
  // A reservation that is neither fresh nor an adopted unbound self is a
  // join: a bound rival (any key) or a bound same-key retry rejoins instead
  // of duplicating paid work.
  if (
    !reserved.created &&
    (reserved.record.idempotencyKey !== parsed.idempotencyKey ||
      reserved.record.briefRevisionId)
  ) {
    await ensureNudged(reserved.record);
    return {
      outcome: "opened_progress",
      projectId,
      updateId: reserved.record.updateId,
      correlationId: parsed.correlationId,
    };
  }
  const updateId = reserved.record.updateId;
  const brief = briefRevisionSchema.parse({
    revisionId: newRevisionId(),
    projectId,
    organizationId: parsed.organizationId,
    revisionNumber,
    question: parsed.question,
    title: parsed.title,
    locationId: parsed.branchId,
    researchArea: parsed.researchArea,
    competitors: parsed.competitors,
    investigationAreas: [...parsed.investigationAreas].sort(),
    evidencePeriods: [],
    businessContextSnapshotId: parsed.businessContextSnapshotId,
    frequency,
    pinnedToUpdateId: updateId,
    createdAtUtc: now().toISOString(),
  });
  assertBriefRevisionContext(brief, {
    organizationId: parsed.organizationId,
    projectId,
  });

  let revisionId: string;
  try {
    const saved = await dependencies.projects.saveBriefRevision({
      organizationId: parsed.organizationId,
      projectId,
      revisionNumber,
      document: brief,
      pinnedToUpdateId: updateId,
      actorId: parsed.actorId,
    });
    revisionId = saved.revisionId;
  } catch (error) {
    // Lost save race: another start pinned this scope first. Join it. A
    // same-key resume after a crash between save and bind reclaims its own
    // winning row instead: the retry key guarantees the scope is identical,
    // so the conflicting row with our number and pin is ours.
    if (!isRevisionConflict(error)) throw error;
    const active = await dependencies.updates.findActive({
      organizationId: parsed.organizationId,
      projectId,
    });
    if (active?.briefRevisionId && active.updateId !== updateId) {
      await ensureNudged(active);
      return {
        outcome: "opened_progress",
        projectId,
        updateId: active.updateId,
        correlationId: parsed.correlationId,
      };
    }
    if (
      active &&
      !active.briefRevisionId &&
      active.idempotencyKey === parsed.idempotencyKey &&
      active.updateId === updateId
    ) {
      const fresh = await dependencies.projects.listBriefRevisions({
        organizationId: parsed.organizationId,
        projectId,
        limit: 50,
      });
      const winner = fresh.find((revision) => revision.revisionNumber === revisionNumber);
      if (!winner) throw error;
      revisionId = winner.revisionId;
    } else if (active && active.updateId === updateId) {
      await ensureNudged(active);
      return {
        outcome: "opened_progress",
        projectId,
        updateId: active.updateId,
        correlationId: parsed.correlationId,
      };
    } else {
      throw error;
    }
  }

  await dependencies.updates.bindRevision({
    organizationId: parsed.organizationId,
    updateId,
    briefRevisionId: revisionId,
    revisionNumber,
    brief,
  });

  await publishEvent(dependencies.events, {
    organizationId: parsed.organizationId,
    eventName: "market_research.requested",
    correlationId: parsed.correlationId,
    occurredAt: now().toISOString(),
    payload: {
      projectId,
      updateId,
      briefRevisionId: revisionId,
      revisionNumber,
      mode: parsed.mode,
    },
  });

  let nudge: "sent" | "lost" = "sent";
  try {
    await dependencies.dispatch.nudge({
      organizationId: parsed.organizationId,
      projectId,
      updateId,
      briefRevisionId: revisionId,
      brief,
      actorId: parsed.actorId,
      correlationId: parsed.correlationId,
    });
    await dependencies.updates.markDispatched({
      organizationId: parsed.organizationId,
      updateId,
    });
  } catch {
    // A lost nudge only delays the wake-up: the update stays undispatched
    // for the cadence sweep, and the start still succeeds.
    nudge = "lost";
  }

  return {
    outcome: "started",
    projectId,
    updateId,
    briefRevisionId: revisionId,
    revisionNumber,
    nudge,
    correlationId: parsed.correlationId,
  };
}

/**
 * Deterministic report composition from the pinned brief and cited research
 * output. No model runs here: every sentence traces to the brief or to a
 * cited finding, speculative ranges arrive only inside a fully-labelled
 * fixture block, and Slice 1 schemas refuse anything else before the RPC.
 */
export function composeMonitoringReport(input: {
  brief: BriefRevision;
  /**
   * The brief-revisions row id. The document revision id is informational
   * (Slice 2 replay repair); the row id is the durable pin the report and
   * the persist RPC must agree on.
   */
  briefRevisionRowId: string;
  findings: MonitoringResearchFinding[];
  sources: MonitoringResearchSource[];
  draftAdvice: MonitoringDraftAdvice[];
  speculativeEstimate?: z.infer<typeof speculativeEstimateSchema>;
  coverage: MonitoringCoverageEntry[];
  reportIds: { reportId: string; reportVersionId: string };
}): { content: MarketMonitoringReport; evidenceDigest: string } {
  const brief = briefRevisionSchema.parse(input.brief);
  const briefRevisionRowId = z.string().uuid().parse(input.briefRevisionRowId);
  const findings = z.array(monitoringResearchFindingSchema).min(1).parse(input.findings);
  const sources = z.array(monitoringResearchSourceSchema).min(1).parse(input.sources);
  const draftAdvice = z.array(monitoringDraftAdviceSchema).max(100).parse(input.draftAdvice);
  const coverage = z.array(monitoringCoverageEntrySchema).parse(input.coverage);
  if (brief.competitors.length === 0) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "A monitoring report needs at least one named competitor.",
    );
  }

  const evidenceDigest = sha256(
    canonicalize({
      projectId: brief.projectId,
      briefRevisionId: brief.revisionId,
      findingKeys: findings.map((finding) => finding.key).sort(),
      sourceRefs: sources.map((source) => source.sourceRef).sort(),
    }),
  );

  const cap = (value: string, maximum: number): string =>
    value.length > maximum ? `${value.slice(0, maximum - 1)}…` : value;

  const summary = cap(
    `Simple-English answer to "${brief.question}" (${brief.researchArea}):\n` +
      findings.map((finding) => `- ${finding.statement}`).join("\n"),
    5_000,
  );
  const localMeaning = cap(
    `What this means locally in ${brief.researchArea}: ` +
      `the findings below rest on cited public evidence pinned to brief revision ${brief.revisionNumber}. ` +
      `Gaps are listed honestly instead of filled in.`,
    5_000,
  );

  const findingsBySlot = new Map<string, MonitoringResearchFinding[]>();
  for (const finding of findings) {
    const list = findingsBySlot.get(finding.slotKey) ?? [];
    list.push(finding);
    findingsBySlot.set(finding.slotKey, list);
  }

  const competitorComparison = brief.competitors.map((competitor) => {
    const slotFindings = findingsBySlot.get(monitoringCompetitorSlotKey(competitor.name)) ?? [];
    const summaryText =
      slotFindings.length > 0
        ? slotFindings.map((finding) => finding.statement).join(" ")
        : `No supported findings for ${competitor.name} in this update; see the gaps list.`;
    return {
      competitorName: competitor.name,
      summary: cap(summaryText, 2_000),
      citationSlots: slotFindings.flatMap((finding) =>
        finding.citations.map((citation) => ({
          claimId: citation.claimId,
          ...(citation.sourceRef ? { sourceRef: citation.sourceRef } : {}),
        })),
      ).slice(0, 50),
    };
  });

  const gaps = coverage
    .filter((entry) => entry.status !== "supported")
    .map((entry, index) => ({
      key: `gap-${String(index + 1).padStart(3, "0")}`,
      description: cap(`${entry.label} (${entry.dimensionKey}): ${entry.status}.`, 1_000),
    }));

  const content = marketMonitoringReportSchema.parse({
    reportId: input.reportIds.reportId,
    reportVersionId: input.reportIds.reportVersionId,
    organizationId: brief.organizationId,
    projectId: brief.projectId,
    locationId: brief.locationId,
    briefRevisionId: briefRevisionRowId,
    evidenceDigest,
    summary,
    localMeaning,
    findings: findings.map((finding) => ({
      key: finding.key,
      statement: finding.statement,
      citationSlots: finding.citations.map((citation) => ({
        claimId: citation.claimId,
        ...(citation.sourceRef ? { sourceRef: citation.sourceRef } : {}),
      })),
    })),
    competitorComparison,
    ...(input.speculativeEstimate ? { speculativeEstimate: input.speculativeEstimate } : {}),
    gaps,
    draftAdvice: draftAdvice.map((advice) => ({
      itemKey: advice.itemKey,
      kind: advice.kind,
      title: advice.title,
      detail: advice.detail,
    })),
    sources: sources.map((source) => ({
      sourceRef: source.sourceRef,
      ...(source.url ? { url: source.url } : {}),
      ...(source.retrievedAtUtc ? { retrievedAtUtc: source.retrievedAtUtc } : {}),
    })),
    plainLanguageRequired: true,
  });
  assertReportContext(content, {
    organizationId: brief.organizationId,
    projectId: brief.projectId,
    locationId: brief.locationId,
    briefRevisionId: briefRevisionRowId,
  });
  return { content, evidenceDigest };
}

/**
 * Spend ledger for one update attempt. Known usage accumulates at face value;
 * unknown usage stays counted and reserved, never converted to zero.
 */
export function summarizeMonitoringCost(usages: readonly ResearchAttemptUsage[]): {
  knownMicrosUsd: number;
  unknownCount: number;
} {
  const parsed = z.array(researchAttemptUsageSchema).parse([...usages]);
  return sumKnownAttemptCost(parsed);
}
