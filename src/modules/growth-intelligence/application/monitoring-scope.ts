import { z } from "zod";

import {
  briefCompetitorSchema,
  type BriefRevision,
} from "@/domain/growth-intelligence/brief";
import { DomainError } from "@/lib/errors";
import type { MonitoringUpdateStore } from "@/modules/growth-intelligence/application/market-monitoring-update";

/**
 * Scope comparison and the start route's request-scoped update store.
 *
 * These live here rather than in `route.ts` because a Next route module may
 * only export its handlers and a fixed set of config values. Exporting
 * anything else from one still type-checks in isolation but fails the
 * generated route check, so it breaks `next build` on a machine where those
 * types have been generated and passes on one where they have not — which is
 * how it stayed invisible. Neither of these is route machinery anyway: one is
 * an equality rule and the other a store, and both are worth testing without
 * standing up a request.
 */

/**
 * Scope equality between a persisted brief document and an incoming start.
 * Same question, title, location, research area, normalized competitors,
 * investigation areas, snapshot and frequency means the same ask: retries
 * and double submits join instead of starting new paid work. A mismatch
 * during active work is scope drift, reported — never silently applied.
 */
export function isSameMonitoringScope(
  document: BriefRevision,
  input: {
    title: string;
    question: string;
    branchId: string;
    researchArea: string;
    competitors: z.infer<typeof briefCompetitorSchema>[];
    investigationAreas: readonly string[];
    businessContextSnapshotId: string;
    frequency: string;
  },
): boolean {
  const normalizedCompetitors = z.array(briefCompetitorSchema).parse(input.competitors);
  return (
    document.question === input.question &&
    (document.title ?? "") === input.title &&
    document.locationId === input.branchId &&
    document.researchArea === input.researchArea &&
    JSON.stringify(document.competitors) === JSON.stringify(normalizedCompetitors) &&
    JSON.stringify([...document.investigationAreas].sort()) ===
      JSON.stringify([...input.investigationAreas].sort()) &&
    document.businessContextSnapshotId === input.businessContextSnapshotId &&
    document.frequency === input.frequency
  );
}

/**
 * Request-scoped update store for the start route. Durable in-flight and
 * terminal-failure rows land with the Slice 7 lifecycle migration; until
 * then the route converges on durable pins it can already read (twin
 * project reuse plus the latest pinned brief revision), and this store only
 * carries the fresh reservation through one orchestration call.
 */
export function createEphemeralMonitoringUpdateStore(): MonitoringUpdateStore {
  type EphemeralRecord = {
    organizationId: string;
    projectId: string;
    actorId: string;
    idempotencyKey: string;
    scopeFingerprint: string;
    updateId: string;
    briefRevisionId: string;
    revisionNumber: number;
    brief: BriefRevision | null;
    status: "queued";
    reportVersionId: null;
    synthesisReportVersionId: null;
    coverage: null;
    knownCostMicrosUsd: number;
    unknownCostCount: number;
    dispatched: boolean;
    createdAt: string;
    updatedAt: string;
  };
  const records = new Map<string, EphemeralRecord>();
  return {
    async findActive() {
      return null;
    },
    async open(input) {
      const record = {
        organizationId: input.organizationId,
        projectId: input.projectId,
        actorId: input.actorId,
        idempotencyKey: input.idempotencyKey,
        scopeFingerprint: input.scopeFingerprint,
        updateId: input.updateId,
        briefRevisionId: "",
        revisionNumber: input.revisionNumber,
        brief: null,
        status: "queued" as const,
        reportVersionId: null,
        synthesisReportVersionId: null,
        coverage: null,
        knownCostMicrosUsd: 0,
        unknownCostCount: 0,
        dispatched: false,
        createdAt: input.nowIso,
        updatedAt: input.nowIso,
      };
      records.set(input.updateId, record);
      return { record, created: true };
    },
    async bindRevision(input) {
      const record = records.get(input.updateId);
      if (!record) throw new DomainError("DOMAIN_ERROR", "This research update is not known.");
      const next = {
        ...record,
        briefRevisionId: input.briefRevisionId,
        revisionNumber: input.revisionNumber,
        brief: input.brief,
      };
      records.set(input.updateId, next);
      return next;
    },
    async get(input) {
      return records.get(input.updateId) ?? null;
    },
    async listUndispatched() {
      return [];
    },
    async markDispatched(input) {
      const record = records.get(input.updateId);
      if (!record) throw new DomainError("DOMAIN_ERROR", "This research update is not known.");
      const next = { ...record, dispatched: true };
      records.set(input.updateId, next);
      return next;
    },
    async completeResearchAndAttachSynthesis() {
      throw new DomainError("DOMAIN_ERROR", "The start route never settles research.");
    },
    async markTerminal() {
      throw new DomainError("DOMAIN_ERROR", "The start route never settles research.");
    },
  };
}
