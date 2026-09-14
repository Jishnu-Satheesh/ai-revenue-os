import { z } from "zod";

import type { EventPublisher } from "@/domain/events/types";
import {
  briefRevisionSchema,
  type BriefRevision,
} from "@/domain/growth-intelligence/brief";
import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import { DomainError } from "@/lib/errors";
import {
  MONITORING_UPDATE_TERMINAL_STAGES,
  startMonitoringUpdateInputSchema,
  type MonitoringDispatcher,
  type MonitoringProjectWriter,
  type MonitoringReportPersister,
  type MonitoringResearcher,
  type MonitoringResearchOutcome,
  type MonitoringUpdateRecord,
  type MonitoringUpdateStore,
  type StartMonitoringUpdateInput,
} from "@/modules/growth-intelligence/application/market-monitoring-update";

/**
 * Test support for Market Monitoring contract tests. The fakes share one
 * in-memory database object the same way production shares Postgres: the
 * project writer and the update store observe each other's pinned revisions,
 * so join/convergence paths behave like the Trigger wiring. Never imported
 * by production code.
 */

export const FIXTURE_IDS = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  otherOrganizationId: "10000000-0000-4000-8000-000000000009",
  branchId: "20000000-0000-4000-8000-000000000002",
  otherBranchId: "20000000-0000-4000-8000-000000000008",
  actorId: "30000000-0000-4000-8000-000000000003",
  snapshotId: "40000000-0000-4000-8000-000000000004",
  correlationId: "50000000-0000-4000-8000-000000000005",
  claimA: "60000000-0000-4000-8000-000000000006",
  claimB: "60000000-0000-4000-8000-000000000007",
} as const;

export type FixtureDb = {
  projects: Map<
    string,
    {
      projectId: string;
      organizationId: string;
      branchId: string;
      title: string;
      question: string;
      mode: "one-time" | "recurring";
      lifecycle: "active" | "paused" | "archived";
    }
  >;
  revisions: Map<
    string,
    Array<{
      revisionId: string;
      revisionNumber: number;
      document: BriefRevision;
      pinnedToUpdateId: string | null;
      actorId: string;
    }>
  >;
  updates: Map<string, MonitoringUpdateRecord>;
  keyIndex: Map<string, string>;
  reports: Map<string, { reportVersionId: string; content: unknown; evidenceDigest: string }>;
  priorReports: Array<{ reportVersionId: string; content: unknown }>;
};

export function createFixtureDb(): FixtureDb {
  return {
    projects: new Map(),
    revisions: new Map(),
    updates: new Map(),
    keyIndex: new Map(),
    reports: new Map(),
    priorReports: [],
  };
}

const TERMINAL = new Set<string>([...MONITORING_UPDATE_TERMINAL_STAGES]);

function isTerminal(status: string): boolean {
  return TERMINAL.has(status);
}

export function startInputFixture(
  overrides: Partial<StartMonitoringUpdateInput> = {},
): z.input<typeof startMonitoringUpdateInputSchema> {
  return {
    organizationId: FIXTURE_IDS.organizationId,
    branchId: FIXTURE_IDS.branchId,
    title: "Ramadan evening demand",
    question: "How does demand for late-night tailoring change during Ramadan?",
    mode: "one-time",
    researchArea: "Deira",
    competitors: [{ name: "Stitch House", source: "suggestion" }],
    investigationAreas: ["demand", "reviews"],
    businessContextSnapshotId: FIXTURE_IDS.snapshotId,
    actorId: FIXTURE_IDS.actorId,
    idempotencyKey: "start-key-1",
    correlationId: FIXTURE_IDS.correlationId,
    ...overrides,
  };
}

export function briefFixture(overrides: Partial<BriefRevision> = {}): BriefRevision {
  return briefRevisionSchema.parse({
    revisionId: "70000000-0000-4000-8000-000000000007",
    projectId: "80000000-0000-4000-8000-000000000008",
    organizationId: FIXTURE_IDS.organizationId,
    revisionNumber: 1,
    question: "How does demand for late-night tailoring change during Ramadan?",
    title: "Ramadan evening demand",
    locationId: FIXTURE_IDS.branchId,
    researchArea: "Deira",
    competitors: [{ name: "Stitch House", source: "suggestion" }],
    investigationAreas: ["demand", "reviews"],
    evidencePeriods: [],
    businessContextSnapshotId: FIXTURE_IDS.snapshotId,
    frequency: "once",
    pinnedToUpdateId: "90000000-0000-4000-8000-000000000009",
    createdAtUtc: "2026-09-14T06:00:00.000Z",
    ...overrides,
  });
}

export function createFakeProjects(db: FixtureDb): MonitoringProjectWriter & {
  saveCalls: number;
} {
  const writer: MonitoringProjectWriter & { saveCalls: number } = {
    saveCalls: 0,
    async createProject(input) {
      const projectId = crypto.randomUUID();
      db.projects.set(projectId, {
        projectId,
        organizationId: input.organizationId,
        branchId: input.branchId,
        title: input.title,
        question: input.question,
        mode: input.mode,
        lifecycle: "active",
      });
      return { projectId, lifecycle: "active", replayed: false };
    },
    async saveBriefRevision(input) {
      writer.saveCalls += 1;
      const project = db.projects.get(input.projectId);
      if (!project || project.organizationId !== input.organizationId) {
        throw new Error("brief_revision_not_found: this brief could not be found in your organization");
      }
      const list = db.revisions.get(input.projectId) ?? [];
      if (list.some((revision) => revision.revisionNumber === input.revisionNumber)) {
        throw new Error(
          `brief_revision_conflict: revision ${input.revisionNumber} was already saved with different details`,
        );
      }
      const revisionId = crypto.randomUUID();
      list.push({
        revisionId,
        revisionNumber: input.revisionNumber,
        document: input.document as BriefRevision,
        pinnedToUpdateId: input.pinnedToUpdateId,
        actorId: input.actorId,
      });
      db.revisions.set(input.projectId, list);
      return { revisionId, revisionNumber: input.revisionNumber, replayed: false };
    },
    async listBriefRevisions(input) {
      return (db.revisions.get(input.projectId) ?? []).map((revision) => ({
        revisionId: revision.revisionId,
        revisionNumber: revision.revisionNumber,
      }));
    },
    async listActiveProjects(input) {
      return [...db.projects.values()]
        .filter(
          (project) =>
            project.organizationId === input.organizationId &&
            (input.branchId === undefined || project.branchId === input.branchId) &&
            project.lifecycle !== "archived",
        )
        .map((project) => ({
          projectId: project.projectId,
          title: project.title,
          question: project.question,
          mode: project.mode,
          lifecycle: project.lifecycle,
        }));
    },
  };
  return writer;
}

function derivedFromPins(db: FixtureDb, organizationId: string, projectId: string): MonitoringUpdateRecord | null {
  const revisions = [...(db.revisions.get(projectId) ?? [])].sort(
    (left, right) => right.revisionNumber - left.revisionNumber,
  );
  for (const revision of revisions) {
    if (!revision.pinnedToUpdateId) continue;
    if (revision.document.organizationId !== organizationId) continue;
    const opened = db.updates.get(revision.pinnedToUpdateId);
    // Store-owned pins resolve through the live scan above (active) or stay
    // buried (terminal). Only record-less pins derive here, and only while
    // no report row proves terminal success.
    if (opened) continue;
    const reported = [...db.reports.values()].some(
      (row) => (row.content as { briefRevisionId?: string }).briefRevisionId === revision.revisionId,
    );
    if (reported) continue;
    return {
      updateId: revision.pinnedToUpdateId,
      organizationId,
      projectId,
      actorId: revision.actorId,
      idempotencyKey: "",
      briefRevisionId: revision.revisionId,
      revisionNumber: revision.revisionNumber,
      scopeFingerprint: "",
      status: "queued",
      reportVersionId: null,
      synthesisReportVersionId: null,
      coverage: null,
      knownCostMicrosUsd: 0,
      unknownCostCount: 0,
      dispatched: false,
      brief: revision.document,
      createdAt: "2026-09-14T06:00:00.000Z",
      updatedAt: "2026-09-14T06:00:00.000Z",
    };
  }
  return null;
}

export function createFakeStore(
  db: FixtureDb,
): MonitoringUpdateStore & { settleCalls: number; terminalCalls: number } {
  const store: MonitoringUpdateStore & { settleCalls: number; terminalCalls: number } = {
    settleCalls: 0,
    terminalCalls: 0,
    async findActive(input) {
      for (const record of db.updates.values()) {
        if (
          record.organizationId === input.organizationId &&
          record.projectId === input.projectId &&
          !isTerminal(record.status)
        ) {
          return { ...record };
        }
      }
      return derivedFromPins(db, input.organizationId, input.projectId);
    },
    async open(input) {
      const parsed = z
        .object({
          organizationId: z.string().uuid(),
          projectId: z.string().uuid(),
          actorId: z.string().uuid(),
          revisionNumber: z.number().int().min(1),
          scopeFingerprint: z.string().min(1),
          updateId: z.string().uuid(),
          idempotencyKey: z.string().trim().min(1).max(200),
          nowIso: z.string().datetime({ offset: true }),
        })
        .strict()
        .parse(input);
      const keyHit = db.keyIndex.get(parsed.idempotencyKey);
      if (keyHit) {
        const existing = db.updates.get(keyHit);
        if (existing && existing.organizationId === parsed.organizationId) {
          if (existing.scopeFingerprint !== parsed.scopeFingerprint) {
            throw new GrowthIntelligenceError(
              "RESEARCH_IDEMPOTENCY_CONFLICT",
              "This retry key was already used for different research settings.",
            );
          }
          return { record: { ...existing }, created: false };
        }
      }
      const active = await store.findActive({
        organizationId: parsed.organizationId,
        projectId: parsed.projectId,
      });
      if (active) return { record: active, created: false };
      const record: MonitoringUpdateRecord = {
        updateId: parsed.updateId,
        organizationId: parsed.organizationId,
        projectId: parsed.projectId,
        actorId: parsed.actorId,
        idempotencyKey: parsed.idempotencyKey,
        briefRevisionId: "",
        revisionNumber: parsed.revisionNumber,
        scopeFingerprint: parsed.scopeFingerprint,
        status: "queued",
        reportVersionId: null,
        synthesisReportVersionId: null,
        coverage: null,
        knownCostMicrosUsd: 0,
        unknownCostCount: 0,
        dispatched: false,
        brief: null,
        createdAt: parsed.nowIso,
        updatedAt: parsed.nowIso,
      };
      db.updates.set(record.updateId, record);
      db.keyIndex.set(parsed.idempotencyKey, record.updateId);
      return { record: { ...record }, created: true };
    },
    async bindRevision(input) {
      const record = db.updates.get(input.updateId);
      if (!record || record.organizationId !== input.organizationId) {
        throw new GrowthIntelligenceError(
          "RESEARCH_TENANT_MISMATCH",
          "This research update belongs to another organization.",
        );
      }
      record.briefRevisionId = input.briefRevisionId;
      record.revisionNumber = input.revisionNumber;
      record.brief = input.brief;
      return { ...record };
    },
    async get(input) {
      const record = db.updates.get(input.updateId);
      if (!record || record.organizationId !== input.organizationId) return null;
      return { ...record };
    },
    async listUndispatched(input) {
      return [...db.updates.values()]
        .filter((record) => !record.dispatched && !isTerminal(record.status))
        .slice(0, input.limit)
        .map((record) => ({ ...record }));
    },
    async markDispatched(input) {
      const record = db.updates.get(input.updateId);
      if (!record || record.organizationId !== input.organizationId) {
        throw new DomainError("DOMAIN_ERROR", "This research update could not be found.");
      }
      record.dispatched = true;
      return { ...record };
    },
    async completeResearchAndAttachSynthesis(input) {
      store.settleCalls += 1;
      const record = db.updates.get(input.updateId);
      if (!record || record.organizationId !== input.organizationId) {
        throw new DomainError("DOMAIN_ERROR", "This research update could not be found.");
      }
      if (isTerminal(record.status)) {
        throw new GrowthIntelligenceError(
          "RESEARCH_UPDATE_CANCEL_CONFLICT",
          "A finished research update cannot be settled again.",
        );
      }
      record.coverage = [...input.coverage];
      record.knownCostMicrosUsd = input.knownCostMicrosUsd;
      record.unknownCostCount = input.unknownCostCount;
      if ("reportVersionId" in input.synthesis) {
        if (!record.synthesisReportVersionId) {
          record.synthesisReportVersionId = input.synthesis.reportVersionId;
        }
        record.status = "preparing_insights";
      }
      return { ...record };
    },
    async markTerminal(input) {
      store.terminalCalls += 1;
      const record = db.updates.get(input.updateId);
      if (!record || record.organizationId !== input.organizationId) {
        throw new DomainError("DOMAIN_ERROR", "This research update could not be found.");
      }
      if (isTerminal(record.status)) {
        throw new GrowthIntelligenceError(
          "RESEARCH_UPDATE_CANCEL_CONFLICT",
          "A finished research update cannot be finished again.",
        );
      }
      if (!TERMINAL.has(input.stage)) {
        throw new DomainError("DOMAIN_ERROR", "This update stage could not be understood.");
      }
      record.status = input.stage;
      if (input.reportVersionId) record.reportVersionId = input.reportVersionId;
      return { ...record };
    },
  };
  return store;
}

export function createFakeEvents(): EventPublisher & { events: Array<{ eventName: string; payload: Record<string, unknown> }> } {
  const published: Array<{ eventName: string; payload: Record<string, unknown> }> = [];
  return {
    events: published,
    async publish(event) {
      published.push({
        eventName: event.eventName,
        payload: (event.payload ?? {}) as Record<string, unknown>,
      });
    },
  };
}

export function createFakeDispatch(options: { failNudges?: boolean } = {}): MonitoringDispatcher & {
  nudges: Array<Parameters<MonitoringDispatcher["nudge"]>[0]>;
} {
  const nudges: Array<Parameters<MonitoringDispatcher["nudge"]>[0]> = [];
  let failNext = options.failNudges === true;
  return {
    nudges,
    async nudge(input) {
      if (failNext) {
        failNext = false;
        throw new Error("dispatch transport down");
      }
      nudges.push(input);
    },
  };
}

export function succeededResearchFixture(): Extract<MonitoringResearchOutcome, { status: "succeeded" }> {
  return {
    status: "succeeded",
    retrievalCoverage: [
      { slotKey: "area:demand", kind: "local_market", outcome: "supported" },
      { slotKey: "area:reviews", kind: "topic", outcome: "supported" },
      { slotKey: "competitor:stitch-house", kind: "competitor", outcome: "supported" },
    ],
    findings: [
      {
        key: "late-night-demand",
        statement: "Three cited listings show tailoring shops in Deira staying open past 10pm during Ramadan.",
        slotKey: "area:demand",
        citations: [{ claimId: FIXTURE_IDS.claimA, sourceRef: "deira-listings" }],
      },
      {
        key: "review-turnaround",
        statement: "Reviewers praise same-day hemming but complain about Eid-week queues.",
        slotKey: "area:reviews",
        citations: [{ claimId: FIXTURE_IDS.claimB, sourceRef: "review-roundup" }],
      },
      {
        key: "stitch-house-hours",
        statement: "Stitch House advertises late Ramadan hours with a price list for express work.",
        slotKey: "competitor:stitch-house",
        citations: [{ claimId: FIXTURE_IDS.claimA, sourceRef: "stitch-house-page" }],
      },
    ],
    sources: [
      { sourceRef: "deira-listings", url: "https://example.com/deira", retrievedAtUtc: "2026-09-14T05:00:00.000Z" },
      { sourceRef: "review-roundup", url: "https://example.com/reviews", retrievedAtUtc: "2026-09-14T05:05:00.000Z" },
      { sourceRef: "stitch-house-page", url: "https://example.com/stitch", retrievedAtUtc: "2026-09-14T05:10:00.000Z" },
    ],
    draftAdvice: [
      { itemKey: "extend-hours", kind: "action", title: "Extend Thursday hours", detail: "Trial late opening on Thursdays through Ramadan." },
      { itemKey: "queue-note", kind: "finding", title: "Eid-week queues recur", detail: "Three reviews mention Eid-week waiting times." },
    ],
    usages: [{ kind: "reported", microsUsd: 1200 }, { kind: "unknown" }],
  };
}

export function createFakeResearcher(
  outcome: MonitoringResearchOutcome,
  options: { throwError?: unknown; capture?: Array<Parameters<MonitoringResearcher>[0]> } = {},
): MonitoringResearcher {
  return async (input) => {
    options.capture?.push(input);
    if (options.throwError !== undefined) throw options.throwError;
    return outcome;
  };
}

export function createFakePersister(
  db: FixtureDb,
  options: { throwError?: unknown } = {},
): MonitoringReportPersister & { persistCalls: number } {
  const persister: MonitoringReportPersister & { persistCalls: number } = {
    persistCalls: 0,
    async persist(input) {
      persister.persistCalls += 1;
      if (options.throwError !== undefined) throw options.throwError;
      const existing = db.reports.get(input.reportVersionId);
      if (existing) {
        return {
          reportId: (existing.content as { reportId: string }).reportId,
          reportVersionId: input.reportVersionId,
          reviewState: "pending_review",
          replayed: true,
        };
      }
      db.reports.set(input.reportVersionId, {
        reportVersionId: input.reportVersionId,
        content: input.content,
        evidenceDigest: input.evidenceDigest,
      });
      return {
        reportId: (input.content as { reportId: string }).reportId,
        reportVersionId: input.reportVersionId,
        reviewState: "pending_review",
        replayed: false,
      };
    },
  };
  return persister;
}
