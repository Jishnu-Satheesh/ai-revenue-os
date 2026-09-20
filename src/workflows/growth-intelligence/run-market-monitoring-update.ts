import { z } from "zod";

import type { EventPublisher } from "@/domain/events/types";
import {
  assertBriefRevisionContext,
  briefRevisionSchema,
} from "@/domain/growth-intelligence/brief";
import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import {
  isTerminalPipelineStage,
  researchCoverageEntrySchema,
} from "@/domain/growth-intelligence/research-pipeline";
import { DomainError } from "@/lib/errors";
import {
  buildMonitoringQueryPlan,
} from "@/modules/growth-intelligence/application/market-monitoring-context";
import {
  buildMonitoringCoverageChecklist,
  composeMonitoringReport,
  MONITORING_UPDATE_LEASE_SECONDS,
  MONITORING_UPDATE_RESEARCH_DEADLINE_MS,
  summarizeMonitoringCost,
  type MonitoringCoverageEntry,
  type MonitoringReportPersister,
  type MonitoringResearcher,
  type MonitoringUpdateRecord,
  type MonitoringUpdateStore,
  type MonitoringUpdateTerminalStage,
} from "@/modules/growth-intelligence/application/market-monitoring-update";

/**
 * The Market Monitoring update worker.
 *
 * One Trigger run drives one update from queued to terminal: research the
 * pinned brief, settle research completion together with the synthesis child
 * in one fenced store call, compose the version-pinned report
 * deterministically, and persist it through the Slice 2 fenced RPC. Root
 * research success alone never marks the update ready; every failure path
 * retains the prior successful report by never writing on it.
 *
 * The run is replay-safe: terminal records replay without new writes, the
 * synthesis report version is minted once per update, and report persistence
 * replays on its version idempotency key. Transient throws propagate so
 * Trigger redelivers under the same update.
 */

export const marketMonitoringUpdatePayloadSchema = z
  .object({
    organizationId: z.string().uuid(),
    projectId: z.string().uuid(),
    updateId: z.string().uuid(),
    briefRevisionId: z.string().uuid(),
    brief: briefRevisionSchema,
    actorId: z.string().uuid(),
    correlationId: z.string().uuid(),
  })
  .strict();

export type MarketMonitoringUpdatePayload = z.infer<
  typeof marketMonitoringUpdatePayloadSchema
>;

export type RunMonitoringUpdateDependencies = {
  updates: MonitoringUpdateStore;
  research: MonitoringResearcher;
  reports: MonitoringReportPersister;
  events: EventPublisher;
  /**
   * Durable lifecycle hooks (Slice 7). Absent in unit tests and in
   * pre-lifecycle production: the run-local store still marks terminals,
   * but nothing crosses the run boundary. Present in the Trigger wiring,
   * where open/settle call the fenced lifecycle RPCs with the G45 lease.
   */
  lifecycle?: MonitoringUpdateLifecycleHooks;
  now?: () => Date;
  newReportIds?: () => { reportId: string; reportVersionId: string };
  signal?: AbortSignal;
};

/**
 * Durable update-lifecycle seam. Open reserves (or heartbeats) the
 * lifecycle row before paid work; settle writes the exact terminal stage
 * after the run-local store marks it. Both are short transactions: research
 * and composition always run outside any lock, and the lease token fences
 * rival runs off the same update.
 */
export type MonitoringUpdateLifecycleHooks = {
  open(input: {
    organizationId: string;
    actorId: string;
    projectId: string;
    updateId: string;
    briefRevisionId: string | null;
    leaseToken: string;
    leaseSeconds: number;
  }): Promise<{ stage: string; attempts: number; replayed: boolean }>;
  settle(input: {
    organizationId: string;
    actorId: string;
    updateId: string;
    stage: MonitoringUpdateTerminalStage;
    reasonCode: string | null;
    retryable: boolean;
    coverage: MonitoringCoverageEntry[] | null;
    knownCostMicrosUsd: number;
    unknownCostCount: number;
    leaseToken: string;
  }): Promise<{ replayed: boolean }>;
};

/**
 * Scope-drift snapshot: the comparable subset of a brief. The worker holds
 * the payload brief and the store's bound brief; the sweep holds the
 * candidate scope and the active record's brief. Both compare through here
 * so Slice 4's notice reads one shared verdict.
 */
export type MonitoringScopeSnapshot = {
  question: string;
  researchArea: string;
  competitors: ReadonlyArray<{ name: string }>;
  investigationAreas: ReadonlyArray<string>;
  businessContextSnapshotId: string;
  frequency: string;
};

export type MonitoringScopeDrift = {
  drifted: boolean;
  changedFields: string[];
};

/**
 * Incoming scope versus the active record's scope. Null active means
 * nothing to drift from (a fresh start), never drift. Competitor and area
 * lists compare order-insensitively; names compare exactly.
 */
export function compareMonitoringScope(input: {
  active: MonitoringScopeSnapshot | null;
  incoming: MonitoringScopeSnapshot;
}): MonitoringScopeDrift {
  if (!input.active) return { drifted: false, changedFields: [] };
  const changedFields: string[] = [];
  if (input.active.question !== input.incoming.question) changedFields.push("question");
  if (input.active.researchArea !== input.incoming.researchArea) {
    changedFields.push("researchArea");
  }
  const activeCompetitors = [...input.active.competitors.map((entry) => entry.name)].sort();
  const incomingCompetitors = [...input.incoming.competitors.map((entry) => entry.name)].sort();
  if (activeCompetitors.join("\n") !== incomingCompetitors.join("\n")) {
    changedFields.push("competitors");
  }
  if (
    [...input.active.investigationAreas].sort().join("\n") !==
    [...input.incoming.investigationAreas].sort().join("\n")
  ) {
    changedFields.push("investigationAreas");
  }
  if (input.active.businessContextSnapshotId !== input.incoming.businessContextSnapshotId) {
    changedFields.push("businessContextSnapshotId");
  }
  if (input.active.frequency !== input.incoming.frequency) changedFields.push("frequency");
  return { drifted: changedFields.length > 0, changedFields };
}

export type RunMonitoringUpdateResult =
  | {
      outcome: MonitoringUpdateTerminalStage;
      updateId: string;
      reportVersionId: string | null;
      scopeDrift: boolean;
    }
  | {
      outcome: "replayed";
      updateId: string;
      stage: MonitoringUpdateRecord["status"];
      scopeDrift: boolean;
    };

export type MonitoringUpdatePinReads = {
  listRevisionPins(input: {
    organizationId: string;
    projectId: string;
  }): Promise<
    Array<{ revisionId: string; revisionNumber: number; pinnedToUpdateId: string | null }>
  >;
  listReportRevisions(input: {
    organizationId: string;
    projectId: string;
  }): Promise<Array<{ briefRevisionId: string; reportVersionId: string }>>;
  /**
   * Single-pin lookup for worker get-miss derivation. The production wiring
   * reads the brief-revisions row by pinned update id; fakes may omit it,
   * in which case `get` keeps its historic local-only miss answer.
   */
  findPinByUpdateId?(input: {
    organizationId: string;
    updateId: string;
  }): Promise<{
    projectId: string;
    revisionId: string;
    revisionNumber: number;
  } | null>;
  /**
   * Durably-known terminal updates for pin derivation. The production
   * wiring reads the monitoring lifecycle table, so every settled stage
   * (ready, partial, cancelled, failed) replays exactly; completed work
   * without a lifecycle row is still observed through report rows. Fakes
   * may omit it, in which case only run-local terminals bury pins.
   */
  listTerminalUpdates?(input: {
    organizationId: string;
    projectId: string;
  }): Promise<Array<{ updateId: string; stage: MonitoringUpdateTerminalStage }>>;
};

/**
 * Production update store: run-local transitions over pin-derived reads.
 *
 * Cross-run convergence comes from brief-revision pins. A pinned revision is
 * active only while it is neither completed-with-report (a report row pins
 * its revision) nor terminally settled (run-local terminal record or a
 * durably-listed lifecycle stage): terminal pins stay buried so a refresh
 * after cancel starts fresh instead of rejoining the dead update as
 * queued. Reported pins with a lifecycle row replay their exact settled
 * stage; reported pins without one replay conservatively as ready.
 */
export function createPinReadMonitoringUpdateStore(
  reads: MonitoringUpdatePinReads,
  now: () => Date = () => new Date(),
): MonitoringUpdateStore {
  const local = new Map<string, MonitoringUpdateRecord>();

  function materializeActive(input: {
    organizationId: string;
    projectId: string;
    updateId: string;
    revisionId: string;
    revisionNumber: number;
  }): MonitoringUpdateRecord {
    const timestamp = now().toISOString();
    const record: MonitoringUpdateRecord = {
      updateId: input.updateId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      actorId: "",
      idempotencyKey: "",
      briefRevisionId: input.revisionId,
      revisionNumber: input.revisionNumber,
      scopeFingerprint: "",
      status: "queued",
      reportVersionId: null,
      synthesisReportVersionId: null,
      coverage: null,
      knownCostMicrosUsd: 0,
      unknownCostCount: 0,
      dispatched: false,
      brief: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    local.set(record.updateId, record);
    return { ...record };
  }

  function materializeTerminal(input: {
    organizationId: string;
    projectId: string;
    updateId: string;
    revisionId: string;
    revisionNumber: number;
    stage: MonitoringUpdateTerminalStage;
    reportVersionId?: string;
  }): MonitoringUpdateRecord {
    const timestamp = now().toISOString();
    const record: MonitoringUpdateRecord = {
      updateId: input.updateId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      actorId: "",
      idempotencyKey: "",
      briefRevisionId: input.revisionId,
      revisionNumber: input.revisionNumber,
      scopeFingerprint: "",
      status: input.stage,
      reportVersionId: input.reportVersionId ?? null,
      synthesisReportVersionId: null,
      coverage: null,
      knownCostMicrosUsd: 0,
      unknownCostCount: 0,
      dispatched: false,
      brief: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    local.set(record.updateId, record);
    return { ...record };
  }

  async function derivedActive(input: {
    organizationId: string;
    projectId: string;
  }): Promise<MonitoringUpdateRecord | null> {
    const [pins, reports, terminals] = await Promise.all([
      reads.listRevisionPins(input),
      reads.listReportRevisions(input),
      reads.listTerminalUpdates?.(input) ?? Promise.resolve([]),
    ]);
    const reported = new Set(reports.map((row) => row.briefRevisionId));
    const terminalByUpdate = new Map(terminals.map((row) => [row.updateId, row.stage]));
    const ordered = [...pins].sort((left, right) => right.revisionNumber - left.revisionNumber);
    for (const pin of ordered) {
      if (!pin.pinnedToUpdateId) continue;
      // Completed-with-report pins are terminal success: never active.
      if (reported.has(pin.revisionId)) continue;
      // Durably-cancelled/failed pins are terminal: a refresh starts fresh.
      if (terminalByUpdate.has(pin.pinnedToUpdateId)) continue;
      const owned = local.get(pin.pinnedToUpdateId);
      if (owned) {
        // Never confirm foreign work and never rejoin a dead update: only a
        // live record bound to this organization and project stays active.
        if (
          owned.organizationId !== input.organizationId ||
          owned.projectId !== input.projectId
        ) {
          continue;
        }
        if (isTerminalPipelineStage(owned.status)) continue;
        return { ...owned };
      }
      return materializeActive({
        organizationId: input.organizationId,
        projectId: input.projectId,
        updateId: pin.pinnedToUpdateId,
        revisionId: pin.revisionId,
        revisionNumber: pin.revisionNumber,
      });
    }
    return null;
  }

  async function deriveByUpdateId(input: {
    organizationId: string;
    updateId: string;
  }): Promise<MonitoringUpdateRecord | null> {
    if (!reads.findPinByUpdateId) return null;
    const pin = await reads.findPinByUpdateId(input);
    if (!pin) return null;
    const [reports, terminals] = await Promise.all([
      reads.listReportRevisions({
        organizationId: input.organizationId,
        projectId: pin.projectId,
      }),
      reads.listTerminalUpdates?.({
        organizationId: input.organizationId,
        projectId: pin.projectId,
      }) ?? Promise.resolve([]),
    ]);
    const report = reports.find((row) => row.briefRevisionId === pin.revisionId);
    // Durable lifecycle rows settle every terminal exactly (ready, partial,
    // cancelled, failed): the exact stage wins over the report-row
    // approximation below, so a reported pin replays its true outcome.
    const terminal = terminals.find((row) => row.updateId === input.updateId);
    if (terminal) {
      return materializeTerminal({
        organizationId: input.organizationId,
        projectId: pin.projectId,
        updateId: input.updateId,
        revisionId: pin.revisionId,
        revisionNumber: pin.revisionNumber,
        stage: terminal.stage,
        ...(report ? { reportVersionId: report.reportVersionId } : {}),
      });
    }
    if (report) {
      // Pre-lifecycle reports carry no settled stage: replay conservatively
      // as ready while preserving the persisted report. Any lifecycle row
      // above replaces this approximation with the exact stage.
      return materializeTerminal({
        organizationId: input.organizationId,
        projectId: pin.projectId,
        updateId: input.updateId,
        revisionId: pin.revisionId,
        revisionNumber: pin.revisionNumber,
        stage: "ready",
        reportVersionId: report.reportVersionId,
      });
    }
    return materializeActive({
      organizationId: input.organizationId,
      projectId: pin.projectId,
      updateId: input.updateId,
      revisionId: pin.revisionId,
      revisionNumber: pin.revisionNumber,
    });
  }

  async function findActive(input: {
    organizationId: string;
    projectId: string;
  }): Promise<MonitoringUpdateRecord | null> {
    // Durable bury signals are checked before run-local actives: a derived
    // reservation materialized as queued must stop being active once its
    // revision completes with a report or its update settles terminally.
    const [earlyReports, earlyTerminals] = await Promise.all([
      reads.listReportRevisions(input),
      reads.listTerminalUpdates?.(input) ?? Promise.resolve([]),
    ]);
    const buriedRevisions = new Set(earlyReports.map((row) => row.briefRevisionId));
    const buriedUpdates = new Set(earlyTerminals.map((row) => row.updateId));
    for (const record of local.values()) {
      if (
        record.organizationId !== input.organizationId ||
        record.projectId !== input.projectId ||
        isTerminalPipelineStage(record.status)
      ) {
        continue;
      }
      if (record.briefRevisionId && buriedRevisions.has(record.briefRevisionId)) continue;
      if (buriedUpdates.has(record.updateId)) continue;
      return { ...record };
    }
    return derivedActive(input);
  }

  function write(record: MonitoringUpdateRecord): MonitoringUpdateRecord {
    record.updatedAt = now().toISOString();
    local.set(record.updateId, record);
    return { ...record };
  }

  function scoped(updateId: string, organizationId: string): MonitoringUpdateRecord {
    const record = local.get(updateId);
    if (!record || record.organizationId !== organizationId) {
      throw new DomainError("DOMAIN_ERROR", "This research update could not be found.");
    }
    return record;
  }

  return {
    findActive,
    async open(input) {
      const keyHit = [...local.values()].find(
        (record) =>
          record.organizationId === input.organizationId &&
          record.idempotencyKey === input.idempotencyKey &&
          input.idempotencyKey.length > 0,
      );
      if (keyHit) {
        if (keyHit.scopeFingerprint !== input.scopeFingerprint) {
          throw new GrowthIntelligenceError(
            "RESEARCH_IDEMPOTENCY_CONFLICT",
            "This retry key was already used for different research settings.",
          );
        }
        return { record: { ...keyHit }, created: false };
      }
      const active = await findActive({
        organizationId: input.organizationId,
        projectId: input.projectId,
      });
      if (active) return { record: active, created: false };
      return {
        record: write({
          updateId: input.updateId,
          organizationId: input.organizationId,
          projectId: input.projectId,
          actorId: input.actorId,
          idempotencyKey: input.idempotencyKey,
          briefRevisionId: "",
          revisionNumber: input.revisionNumber,
          scopeFingerprint: input.scopeFingerprint,
          status: "queued",
          reportVersionId: null,
          synthesisReportVersionId: null,
          coverage: null,
          knownCostMicrosUsd: 0,
          unknownCostCount: 0,
          dispatched: false,
          brief: null,
          createdAt: now().toISOString(),
          updatedAt: now().toISOString(),
        }),
        created: true,
      };
    },
    async bindRevision(input) {
      const record = scoped(input.updateId, input.organizationId);
      record.briefRevisionId = input.briefRevisionId;
      record.revisionNumber = input.revisionNumber;
      record.brief = input.brief;
      return write(record);
    },
    async get(input) {
      const record = local.get(input.updateId);
      if (record && record.organizationId === input.organizationId) return { ...record };
      // Production get-miss: a fresh run holds an empty map, so derive and
      // materialize the reservation from the persisted revision pin. A true
      // miss (no pin) still answers null and the worker keeps its not-found
      // throw; project match is verified by the worker against the derived
      // project id, never trusted here.
      const derived = await deriveByUpdateId(input);
      if (!derived || derived.organizationId !== input.organizationId) return null;
      return derived;
    },
    async listUndispatched(input) {
      return [...local.values()]
        .filter((record) => !record.dispatched && !isTerminalPipelineStage(record.status))
        .slice(0, input.limit)
        .map((record) => ({ ...record }));
    },
    async markDispatched(input) {
      const record = scoped(input.updateId, input.organizationId);
      record.dispatched = true;
      return write(record);
    },
    async completeResearchAndAttachSynthesis(input) {
      const record = scoped(input.updateId, input.organizationId);
      if (isTerminalPipelineStage(record.status)) {
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
      return write(record);
    },
    async markTerminal(input) {
      const record = scoped(input.updateId, input.organizationId);
      if (isTerminalPipelineStage(record.status)) {
        throw new GrowthIntelligenceError(
          "RESEARCH_UPDATE_CANCEL_CONFLICT",
          "A finished research update cannot be finished again.",
        );
      }
      record.status = input.stage;
      if (input.reportVersionId) record.reportVersionId = input.reportVersionId;
      return write(record);
    },
  };
}

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

export async function runMarketMonitoringUpdate(
  input: unknown,
  dependencies: RunMonitoringUpdateDependencies,
): Promise<RunMonitoringUpdateResult> {
  const payload = marketMonitoringUpdatePayloadSchema.parse(input);
  const now = dependencies.now ?? (() => new Date());
  const newReportIds =
    dependencies.newReportIds ??
    (() => ({ reportId: crypto.randomUUID(), reportVersionId: crypto.randomUUID() }));

  assertBriefRevisionContext(payload.brief, {
    organizationId: payload.organizationId,
    projectId: payload.projectId,
  });
  // The payload revision id is the brief-revisions row id; the document
  // revision id is informational (Slice 2 replay repair) and intentionally
  // not compared. The pin below binds document to update.
  if (payload.brief.pinnedToUpdateId !== payload.updateId) {
    throw new GrowthIntelligenceError(
      "RESEARCH_CONTEXT_MISMATCH",
      "This brief revision is pinned to another update.",
    );
  }

  let record = await dependencies.updates.get({
    organizationId: payload.organizationId,
    updateId: payload.updateId,
  });
  if (!record || record.projectId !== payload.projectId || !record.briefRevisionId) {
    // Production get-miss fallback: stores without single-pin reads still
    // converge through the pin-derived active scan, verified to this payload
    // update and project. Terminal pins stay buried here (a refresh starts
    // fresh through `open`); their replay path is the `get` derivation above.
    const derived = await dependencies.updates.findActive({
      organizationId: payload.organizationId,
      projectId: payload.projectId,
    });
    if (
      derived &&
      derived.updateId === payload.updateId &&
      derived.projectId === payload.projectId &&
      derived.briefRevisionId
    ) {
      record = derived;
    } else {
      // Same answer for missing, foreign and unbound rows: never confirm
      // foreign work, and never run a reservation no revision backs.
      throw new DomainError("DOMAIN_ERROR", "This research update could not be found.");
    }
  }

  if (isTerminalPipelineStage(record.status)) {
    return {
      outcome: "replayed",
      updateId: payload.updateId,
      stage: record.status,
      scopeDrift:
        record.brief != null
          ? compareMonitoringScope({ active: record.brief, incoming: payload.brief }).drifted
          : false,
    };
  }

  // Incoming scope versus the bound record: a refresh that changed its
  // settings joins the running update (Slice 4 opens progress), and this
  // flag tells Slice 4's notice the saved settings were not applied.
  const scopeDrift =
    record.brief != null
      ? compareMonitoringScope({ active: record.brief, incoming: payload.brief }).drifted
      : false;

  // Durable reservation before paid work: the G45 lease (600s, longest in
  // the deadline nest) fences rival runs off this update. Hooks are absent
  // in unit tests; the Trigger wiring supplies the fenced RPCs.
  const leaseToken = crypto.randomUUID();
  if (dependencies.lifecycle) {
    await dependencies.lifecycle.open({
      organizationId: payload.organizationId,
      actorId: payload.actorId,
      projectId: payload.projectId,
      updateId: payload.updateId,
      briefRevisionId: record.briefRevisionId || null,
      leaseToken,
      leaseSeconds: MONITORING_UPDATE_LEASE_SECONDS,
    });
  }

  const settleLifecycle = (input: {
    stage: MonitoringUpdateTerminalStage;
    reasonCode: string | null;
    retryable: boolean;
    coverage: MonitoringCoverageEntry[] | null;
    knownCostMicrosUsd: number;
    unknownCostCount: number;
  }): Promise<void> => {
    if (!dependencies.lifecycle) return Promise.resolve();
    return dependencies.lifecycle
      .settle({
        organizationId: payload.organizationId,
        actorId: payload.actorId,
        updateId: payload.updateId,
        stage: input.stage,
        reasonCode: input.reasonCode,
        retryable: input.retryable,
        coverage: input.coverage,
        knownCostMicrosUsd: input.knownCostMicrosUsd,
        unknownCostCount: input.unknownCostCount,
        leaseToken,
      })
      .then(() => undefined);
  };

  const markTerminal = (
    stage: MonitoringUpdateTerminalStage,
    reportVersionId?: string,
  ): Promise<MonitoringUpdateRecord> =>
    dependencies.updates.markTerminal({
      organizationId: payload.organizationId,
      updateId: payload.updateId,
      stage,
      ...(reportVersionId ? { reportVersionId } : {}),
      nowIso: now().toISOString(),
    });

  if (dependencies.signal?.aborted) {
    await markTerminal("cancelled");
    await settleLifecycle({
      stage: "cancelled",
      reasonCode: "WORKER_CANCELLED",
      retryable: false,
      coverage: null,
      knownCostMicrosUsd: 0,
      unknownCostCount: 0,
    });
    return { outcome: "cancelled", updateId: payload.updateId, reportVersionId: null, scopeDrift };
  }

  const failResearch = async (
    code: string,
    usages: Parameters<typeof summarizeMonitoringCost>[0],
    retrievalCoverage: ReadonlyArray<z.input<typeof researchCoverageEntrySchema>>,
  ): Promise<RunMonitoringUpdateResult> => {
    const cost = summarizeMonitoringCost(usages);
    // Honest failure coverage: prefer the researcher's own per-slot coverage
    // when it accounts for every planned slot (a mixed outage keeps its
    // precise supported/searched/failed split instead of collapsing to
    // all-unavailable). Otherwise backfill every requested dimension as
    // unavailable from the same deterministic plan research would have run.
    // The entry kind is structural; the checklist resolves support by slot
    // key, so every dimension reads unavailable or not-found, never supported.
    const planKeys = queryPlan.map((query) => query.slotKey);
    const precise = researchCoverageEntrySchema.array().safeParse([...retrievalCoverage]);
    const coversPlan =
      precise.success &&
      precise.data.length === planKeys.length &&
      new Set(precise.data.map((entry) => entry.slotKey)).size === planKeys.length &&
      precise.data.every((entry) => planKeys.includes(entry.slotKey));
    const effectiveRetrievalCoverage = coversPlan && precise.success
      ? precise.data.map((entry) => ({
          slotKey: entry.slotKey,
          kind: entry.kind,
          outcome: entry.outcome,
        }))
      : queryPlan.map((query) => ({
          slotKey: query.slotKey,
          kind: (query.kind === "competitor" ? "competitor" : "local_market") as
            | "competitor"
            | "local_market",
          outcome: "failed" as const,
        }));
    const backfilled = buildMonitoringCoverageChecklist({
      brief: payload.brief,
      retrievalCoverage: effectiveRetrievalCoverage,
      supportedSlotKeys: new Set<string>(),
    });
    await dependencies.updates.completeResearchAndAttachSynthesis({
      organizationId: payload.organizationId,
      updateId: payload.updateId,
      coverage: backfilled,
      knownCostMicrosUsd: cost.knownMicrosUsd,
      unknownCostCount: cost.unknownCount,
      synthesis: { failedCode: code },
      nowIso: now().toISOString(),
    });
    await markTerminal("research_failed");
    await settleLifecycle({
      stage: "research_failed",
      reasonCode: code,
      retryable: true,
      coverage: backfilled,
      knownCostMicrosUsd: cost.knownMicrosUsd,
      unknownCostCount: cost.unknownCount,
    });
    await publishEvent(dependencies.events, {
      organizationId: payload.organizationId,
      eventName: "market_research.failed",
      correlationId: payload.correlationId,
      occurredAt: now().toISOString(),
      payload: {
        projectId: payload.projectId,
        updateId: payload.updateId,
        briefRevisionId: payload.briefRevisionId,
        phase: "research",
        code,
        reportVersionId: null,
      },
    });
    return { outcome: "research_failed", updateId: payload.updateId, reportVersionId: null, scopeDrift };
  };

  // briefIdentity stays null until snapshot infrastructure lands (G23):
  // the queries below already carry approved public brief fields only.
  // The plan is built once: research runs it, and the failure path
  // backfills unavailable coverage from this same deterministic plan.
  const queryPlan = buildMonitoringQueryPlan(payload.brief);
  const research = await dependencies.research({
    organizationId: payload.organizationId,
    projectId: payload.projectId,
    updateId: payload.updateId,
    briefRevisionId: payload.briefRevisionId,
    queries: queryPlan,
    briefIdentity: null,
    deadlineMs: MONITORING_UPDATE_RESEARCH_DEADLINE_MS,
    signal: dependencies.signal,
  });

  if (research.status === "cancelled" || dependencies.signal?.aborted) {
    await markTerminal("cancelled");
    await settleLifecycle({
      stage: "cancelled",
      reasonCode: "WORKER_CANCELLED",
      retryable: false,
      coverage: null,
      knownCostMicrosUsd: 0,
      unknownCostCount: 0,
    });
    return { outcome: "cancelled", updateId: payload.updateId, reportVersionId: null, scopeDrift };
  }
  if (research.status === "failed") {
    return failResearch(research.code, research.usages, research.retrievalCoverage);
  }

  // Single fenced settle: coverage, cost and the synthesis child commit
  // together. The report version is minted once per update and reused on
  // redelivery, so a retried persist never forks report identity.
  const cost = summarizeMonitoringCost(research.usages);
  const coverage = buildMonitoringCoverageChecklist({
    brief: payload.brief,
    retrievalCoverage: research.retrievalCoverage,
    supportedSlotKeys: new Set(
      research.findings.map((finding) => finding.slotKey),
    ),
  });
  const minted = newReportIds();
  const synthesisReportVersionId = record.synthesisReportVersionId ?? minted.reportVersionId;
  const settled = await dependencies.updates.completeResearchAndAttachSynthesis({
    organizationId: payload.organizationId,
    updateId: payload.updateId,
    coverage,
    knownCostMicrosUsd: cost.knownMicrosUsd,
    unknownCostCount: cost.unknownCount,
    synthesis: {
      reportVersionId: record.synthesisReportVersionId ?? synthesisReportVersionId,
      findingCount: research.findings.length,
      sourceCount: research.sources.length,
    },
    nowIso: now().toISOString(),
  });
  const reportVersionId = settled.synthesisReportVersionId ?? synthesisReportVersionId;

  if (research.findings.length === 0) {
    // Healthy but empty: no report satisfies the Slice 1 minimum, so the
    // prior successful report stands and the update lands in no_findings.
    await markTerminal("no_findings");
    await settleLifecycle({
      stage: "no_findings",
      reasonCode: null,
      retryable: false,
      coverage,
      knownCostMicrosUsd: cost.knownMicrosUsd,
      unknownCostCount: cost.unknownCount,
    });
    await publishEvent(dependencies.events, {
      organizationId: payload.organizationId,
      eventName: "market_research.completed",
      correlationId: payload.correlationId,
      occurredAt: now().toISOString(),
      payload: {
        projectId: payload.projectId,
        updateId: payload.updateId,
        briefRevisionId: payload.briefRevisionId,
        reportVersionId: null,
        findingCount: 0,
        sourceCount: research.sources.length,
      },
    });
    return { outcome: "no_findings", updateId: payload.updateId, reportVersionId: null, scopeDrift };
  }

  let composed: ReturnType<typeof composeMonitoringReport>;
  try {
    composed = composeMonitoringReport({
      brief: payload.brief,
      briefRevisionRowId: payload.briefRevisionId,
      findings: research.findings,
      sources: research.sources,
      draftAdvice: research.draftAdvice,
      ...(research.speculativeEstimate
        ? { speculativeEstimate: research.speculativeEstimate }
        : {}),
      coverage,
      reportIds: { reportId: minted.reportId, reportVersionId },
    });
  } catch {
    // The fenced settle above already holds coverage, cost and the child;
    // composition failure lands the update terminal without touching reports.
    await markTerminal("synthesis_failed");
    await settleLifecycle({
      stage: "synthesis_failed",
      reasonCode: "REPORT_COMPOSITION_INVALID",
      retryable: true,
      coverage,
      knownCostMicrosUsd: cost.knownMicrosUsd,
      unknownCostCount: cost.unknownCount,
    });
    await publishEvent(dependencies.events, {
      organizationId: payload.organizationId,
      eventName: "market_research.failed",
      correlationId: payload.correlationId,
      occurredAt: now().toISOString(),
      payload: {
        projectId: payload.projectId,
        updateId: payload.updateId,
        briefRevisionId: payload.briefRevisionId,
        phase: "synthesis",
        code: "REPORT_COMPOSITION_INVALID",
        reportVersionId: null,
      },
    });
    return { outcome: "synthesis_failed", updateId: payload.updateId, reportVersionId: null, scopeDrift };
  }

  // Transient persist throws propagate for Trigger redelivery; the update
  // stays non-terminal and no partial report content is left behind.
  const persisted = await dependencies.reports.persist({
    organizationId: payload.organizationId,
    projectId: payload.projectId,
    branchId: payload.brief.locationId,
    briefRevisionId: payload.briefRevisionId,
    reportVersionId,
    evidenceDigest: composed.evidenceDigest,
    content: composed.content,
    actorId: payload.actorId,
  });

  const stage: MonitoringUpdateTerminalStage = coverage.every(
    (entry) => entry.status === "supported",
  )
    ? "ready"
    : "partial";
  await markTerminal(stage, persisted.reportVersionId);
  await settleLifecycle({
    stage,
    reasonCode: null,
    retryable: false,
    coverage,
    knownCostMicrosUsd: cost.knownMicrosUsd,
    unknownCostCount: cost.unknownCount,
  });
  const eventName =
    stage === "ready" ? "market_research.completed" : "market_research.partially_completed";
  await publishEvent(dependencies.events, {
    organizationId: payload.organizationId,
    eventName,
    correlationId: payload.correlationId,
    occurredAt: now().toISOString(),
    payload: {
      projectId: payload.projectId,
      updateId: payload.updateId,
      briefRevisionId: payload.briefRevisionId,
      reportVersionId: persisted.reportVersionId,
      findingCount: research.findings.length,
      sourceCount: research.sources.length,
    },
  });
  await publishEvent(dependencies.events, {
    organizationId: payload.organizationId,
    eventName: "growth_intelligence.synthesized",
    correlationId: payload.correlationId,
    occurredAt: now().toISOString(),
    payload: {
      projectId: payload.projectId,
      updateId: payload.updateId,
      briefRevisionId: payload.briefRevisionId,
      reportVersionId: persisted.reportVersionId,
    },
  });
  return { outcome: stage, updateId: payload.updateId, reportVersionId: persisted.reportVersionId, scopeDrift };
}
