import { z } from "zod";

import { briefRevisionSchema, type BriefRevision } from "@/domain/growth-intelligence/brief";
import { DomainError } from "@/lib/errors";
import { fingerprintMonitoringScope } from "@/modules/growth-intelligence/application/market-monitoring-update";

import { executeWatchInputSchema, type WatchKeyedCreateInput, type WatchProjectSeams } from "./executors";

type SourceProjectInput = Pick<WatchKeyedCreateInput,
  "organizationId" | "actorId" | "branchId" | "title" | "question" | "mode" |
  "schedule" | "idempotencyKey" | "scopeFingerprint"
>;

export type WatchProjectAdapterDependencies = {
  projects: {
    createProject(input: SourceProjectInput): Promise<{ projectId: string; replayed: boolean }>;
    saveBriefRevision(input: {
      organizationId: string;
      projectId: string;
      revisionNumber: number;
      document: BriefRevision;
      pinnedToUpdateId: null;
      actorId: string;
    }): Promise<{ revisionId: string; revisionNumber: number; replayed: boolean }>;
  };
  /** Null means genuine absence; failed reads must throw, and documents stay raw for validation. */
  readLatestBrief(input: { organizationId: string; projectId: string }): Promise<unknown | null>;
  /** Existing RLS-protected source key, pinned to this exact organization and key. */
  readCreationKey(input: { organizationId: string; idempotencyKey: string }): Promise<{
    projectId: string;
    scopeFingerprint: string | null;
  } | null>;
  now?: () => Date;
  newRevisionId?: () => string;
};

function scopeForBrief(brief: BriefRevision, input: WatchKeyedCreateInput): string {
  return fingerprintMonitoringScope({
    organizationId: brief.organizationId,
    branchId: brief.locationId,
    title: brief.title ?? input.title,
    question: brief.question,
    mode: input.mode,
    ...(input.schedule ? { schedule: input.schedule } : {}),
    researchArea: brief.researchArea,
    competitors: brief.competitors,
    investigationAreas: brief.investigationAreas,
    businessContextSnapshotId: brief.businessContextSnapshotId,
    frequency: brief.frequency,
  });
}

function assertSavedBrief(document: unknown, projectId: string, input: WatchKeyedCreateInput): void {
  const parsed = briefRevisionSchema.safeParse(document);
  if (!parsed.success) {
    throw new DomainError("VALIDATION_ERROR", "The saved watch brief could not be understood. Reload the research project.");
  }
  if (parsed.data.organizationId !== input.organizationId || parsed.data.projectId !== projectId) {
    throw new DomainError("TENANT_SCOPE_ERROR", "The saved watch does not belong to this research scope.");
  }
  if (scopeForBrief(parsed.data, input) !== input.scopeFingerprint) {
    throw new DomainError("DOMAIN_ERROR", "This watch now has different research details. Open the research project to review them.");
  }
}

/**
 * A watch is ready for the existing source scheduler only after its brief is
 * persisted. The keyed project RPC and revision RPC remain the write fences.
 * This adapter never dispatches paid work or rewrites an existing source brief.
 */
export function createWatchProjectAdapter(
  dependencies: WatchProjectAdapterDependencies,
): Required<Pick<WatchProjectSeams, "createKeyed" | "findCreatedByKey">> {
  async function findCreatedByKey(input: WatchKeyedCreateInput): Promise<string | null> {
    const parsed = z.object({ organizationId: z.string().uuid(),
      idempotencyKey: z.string().trim().min(16).max(200) }).strict().parse({
      organizationId: input.organizationId, idempotencyKey: input.idempotencyKey,
    });
    const record = await dependencies.readCreationKey(parsed);
    if (record === null) return null;
    const valid = z.object({ projectId: z.string().uuid(),
      scopeFingerprint: z.string().regex(/^[0-9a-f]{64}$/).nullable() }).strict().safeParse(record);
    if (!valid.success) {
      throw new DomainError("INTEGRATION_ERROR", "The saved watch could not be resumed safely.");
    }
    if (valid.data.scopeFingerprint === input.scopeFingerprint) return valid.data.projectId;
    if (valid.data.scopeFingerprint !== null) {
      throw new DomainError("DOMAIN_ERROR", "This watch now has different research details. Open the research project to review them.");
    }
    // Terminal/archived scopes can be released. Their matching immutable
    // brief remains a valid completion receipt; a partial create cannot.
    const document = await dependencies.readLatestBrief({ organizationId: input.organizationId,
      projectId: valid.data.projectId });
    if (document === null) {
      throw new DomainError("DOMAIN_ERROR", "The saved watch has no active research scope or brief. Open the research project to review it.");
    }
    assertSavedBrief(document, valid.data.projectId, input);
    return valid.data.projectId;
  }

  return {
    findCreatedByKey,

    async createKeyed(input) {
      const { scopeFingerprint, ...watch } = input;
      const parsed = executeWatchInputSchema.parse(watch);
      const actorId = z.string().uuid().parse(parsed.actorId);
      const title = z.string().trim().min(1).max(200).parse(parsed.title);
      const requested: WatchKeyedCreateInput = { ...parsed, actorId, title,
        businessContextSnapshotId: parsed.businessContextSnapshotId ?? "00000000-0000-0000-0000-000000000000",
        scopeFingerprint: z.string().regex(/^[0-9a-f]{64}$/).parse(scopeFingerprint) };
      // Validate the full source document before creating even the project.
      const initial = briefRevisionSchema.parse({
        revisionId: (dependencies.newRevisionId ?? (() => crypto.randomUUID()))(),
        projectId: "00000000-0000-0000-0000-000000000000",
        organizationId: requested.organizationId,
        revisionNumber: 1,
        question: requested.question,
        title: requested.title,
        locationId: requested.branchId,
        researchArea: requested.researchArea,
        competitors: requested.competitors,
        investigationAreas: [...requested.investigationAreas].sort(),
        evidencePeriods: [],
        businessContextSnapshotId: requested.businessContextSnapshotId,
        frequency: requested.mode === "one-time" ? "once" : requested.schedule?.cadence,
        pinnedToUpdateId: null,
        createdAtUtc: (dependencies.now ?? (() => new Date()))().toISOString(),
      });
      if (scopeForBrief(initial, requested) !== requested.scopeFingerprint) {
        throw new DomainError("VALIDATION_ERROR", "The watch details do not match the confirmed research scope.");
      }
      const created = await dependencies.projects.createProject({
        organizationId: requested.organizationId,
        actorId: requested.actorId,
        branchId: requested.branchId,
        title: requested.title,
        question: requested.question,
        mode: requested.mode,
        ...(requested.schedule ? { schedule: requested.schedule } : {}),
        idempotencyKey: requested.idempotencyKey,
        scopeFingerprint: requested.scopeFingerprint,
      });
      const projectId = z.string().uuid().parse(created.projectId);
      // The source body digest omits research-only fields. Validate the
      // current source scope after create too, including a lost race on a key.
      const recordedProjectId = await findCreatedByKey(requested);
      if (recordedProjectId !== projectId) {
        throw new DomainError("INTEGRATION_ERROR", "The saved watch could not be resumed safely.");
      }
      const existing = await dependencies.readLatestBrief({ organizationId: requested.organizationId, projectId });
      if (existing !== null) {
        assertSavedBrief(existing, projectId, requested);
        return created;
      }
      const document = briefRevisionSchema.parse({ ...initial, projectId });
      try {
        await dependencies.projects.saveBriefRevision({ organizationId: requested.organizationId,
          projectId, revisionNumber: 1, document, pinnedToUpdateId: null, actorId });
      } catch (error) {
        // A concurrent save or lost response can leave a valid winning row.
        // Authorization failures remain failures, even if a row now exists.
        if (!(error instanceof DomainError) || error.code !== "DOMAIN_ERROR") throw error;
        const kept = await dependencies.readLatestBrief({ organizationId: requested.organizationId, projectId });
        if (kept === null) throw error;
        assertSavedBrief(kept, projectId, requested);
      }
      return created;
    },
  };
}
