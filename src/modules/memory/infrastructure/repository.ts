import { memoryError } from "@/domain/memory/errors";
import type { PersistableMemoryType, Sensitivity } from "@/domain/memory/types";
import type {
  MemoryItemInsert,
  MemoryItemRow,
  MemoryItemStateUpdate,
  MemoryLinkRow,
  MemoryPersistencePort,
  GoogleBusinessProfileProjectionWrite,
  MemoryRetrievalLogInsert,
  MemorySearchParameters,
  MemorySearchRow,
  MemorySnapshotCounts,
} from "@/modules/memory/application/ports";

export const MAX_RETRIEVAL_LIMIT = 50;
export const MAX_TIMELINE_LIMIT = 100;

function requireOrganizationId(organizationId: string): string {
  if (!organizationId || organizationId.trim() === "") {
    throw memoryError("TENANT_SCOPE_ERROR");
  }
  return organizationId;
}

function cap(limit: number, maximum: number): number {
  if (!Number.isFinite(limit) || limit < 1) return 1;
  return Math.min(Math.trunc(limit), maximum);
}

export type MemoryRepository = {
  search(parameters: MemorySearchParameters): Promise<MemorySearchRow[]>;
  searchFacts(input: {
    organizationId: string;
    query: string;
    branchId?: string;
    limit: number;
  }): Promise<Awaited<ReturnType<MemoryPersistencePort["searchFacts"]>>>;
  projectGoogleBusinessProfileRecord(input: GoogleBusinessProfileProjectionWrite): Promise<void>;
  hydrateByIds(input: {
    organizationId: string;
    ids: readonly string[];
    sensitivities: readonly Sensitivity[];
    includeSuperseded: boolean;
    includeExpired: boolean;
  }): Promise<MemoryItemRow[]>;
  getItem(input: { organizationId: string; itemId: string }): Promise<MemoryItemRow | null>;
  listTimeline(input: {
    organizationId: string;
    sensitivities: readonly Sensitivity[];
    branchId?: string;
    limit: number;
    before?: string;
  }): Promise<MemoryItemRow[]>;
  listByTypes(input: {
    organizationId: string;
    sensitivities: readonly Sensitivity[];
    memoryTypes: readonly PersistableMemoryType[];
    verificationStates?: readonly ("proposed" | "unverified" | "verified" | "rejected")[];
    limit: number;
  }): Promise<MemoryItemRow[]>;
  listLinks(input: {
    organizationId: string;
    itemIds: readonly string[];
  }): Promise<MemoryLinkRow[]>;
  insertItem(input: MemoryItemInsert): Promise<MemoryItemRow>;
  updateItem(input: {
    organizationId: string;
    itemId: string;
    patch: MemoryItemStateUpdate;
  }): Promise<MemoryItemRow>;
  insertLinks(input: {
    organizationId: string;
    links: readonly Omit<MemoryLinkRow, "id" | "created_at">[];
  }): Promise<void>;
  insertRetrievalLog(input: MemoryRetrievalLogInsert): Promise<void>;
  countsFor(input: { organizationId: string }): Promise<MemorySnapshotCounts>;
};

/**
 * A thin guard over persistence. It exists so every caller inherits the same
 * organization requirement and the same hard limit ceilings, rather than each
 * service remembering to apply them.
 */
export function createMemoryRepository(persistence: MemoryPersistencePort): MemoryRepository {
  return {
    async search(parameters) {
      requireOrganizationId(parameters.organizationId);
      if (parameters.sensitivities.length === 0) {
        // An empty allowance means "nothing is permitted", never "no filter".
        return [];
      }
      return persistence.search({
        ...parameters,
        limit: cap(parameters.limit, MAX_RETRIEVAL_LIMIT),
      });
    },

    async searchFacts(input) {
      requireOrganizationId(input.organizationId);
      return persistence.searchFacts({ ...input, limit: cap(input.limit, MAX_RETRIEVAL_LIMIT) });
    },

    async projectGoogleBusinessProfileRecord(input) {
      requireOrganizationId(input.organizationId);
      return persistence.projectGoogleBusinessProfileRecord(input);
    },

    async hydrateByIds(input) {
      requireOrganizationId(input.organizationId);
      if (input.sensitivities.length === 0) return [];
      return persistence.hydrateByIds({
        ...input,
        ids: input.ids.slice(0, MAX_RETRIEVAL_LIMIT),
      });
    },

    async getItem(input) {
      requireOrganizationId(input.organizationId);
      return persistence.getItem(input);
    },

    async listTimeline(input) {
      requireOrganizationId(input.organizationId);
      if (input.sensitivities.length === 0) return [];
      return persistence.listTimeline({ ...input, limit: cap(input.limit, MAX_TIMELINE_LIMIT) });
    },

    async listByTypes(input) {
      requireOrganizationId(input.organizationId);
      if (input.sensitivities.length === 0) return [];
      return persistence.listByTypes({ ...input, limit: cap(input.limit, MAX_TIMELINE_LIMIT) });
    },

    async listLinks(input) {
      requireOrganizationId(input.organizationId);
      return persistence.listLinks(input);
    },

    async insertItem(input) {
      requireOrganizationId(input.organization_id);
      return persistence.insertItem(input);
    },

    async updateItem(input) {
      requireOrganizationId(input.organizationId);
      return persistence.updateItem(input);
    },

    async insertLinks(input) {
      requireOrganizationId(input.organizationId);
      if (input.links.some((link) => link.organization_id !== input.organizationId)) {
        throw memoryError("TENANT_SCOPE_ERROR");
      }
      return persistence.insertLinks(input);
    },

    async insertRetrievalLog(input) {
      requireOrganizationId(input.organization_id);
      return persistence.insertRetrievalLog({
        ...input,
        query_text: input.query_text ? input.query_text.slice(0, 500) : null,
        result_item_ids: (input.result_item_ids ?? []).slice(0, MAX_RETRIEVAL_LIMIT),
      });
    },

    async countsFor(input) {
      requireOrganizationId(input.organizationId);
      return persistence.countsFor(input);
    },
  };
}
