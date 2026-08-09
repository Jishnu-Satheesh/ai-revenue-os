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
import type { TimelineCursor } from "@/modules/memory/application/api-schemas";

export const MAX_RETRIEVAL_LIMIT = 50;
export const MAX_TIMELINE_LIMIT = 100;
export const MAX_DETAIL_CHAIN_HOPS = 32;

export type MemoryItemDetailRow = {
  item: MemoryItemRow;
  chain: readonly MemoryItemRow[];
  links: readonly {
    id: string;
    relation: "derived_from" | "supports" | "contradicts" | "explains";
    direction: "from" | "to";
    relatedItemId: string;
  }[];
};

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
    sourceSystems?: readonly string[];
    limit: number;
    cursor?: TimelineCursor;
  }): Promise<MemoryItemRow[]>;
  getItemDetail(input: {
    organizationId: string;
    itemId: string;
    sensitivities: readonly Sensitivity[];
  }): Promise<MemoryItemDetailRow | null>;
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

    async getItemDetail(input) {
      requireOrganizationId(input.organizationId);
      if (input.sensitivities.length === 0) return null;

      const item = await persistence.getItem({
        organizationId: input.organizationId,
        itemId: input.itemId,
      });
      if (!item || !input.sensitivities.includes(item.sensitivity)) return null;

      const chain: MemoryItemRow[] = [];
      const seen = new Set([item.id]);

      let successorId = item.superseded_by_id;
      while (successorId && chain.length < MAX_DETAIL_CHAIN_HOPS && !seen.has(successorId)) {
        const successor = await persistence.getItem({
          organizationId: input.organizationId,
          itemId: successorId,
        });
        if (!successor || !input.sensitivities.includes(successor.sensitivity)) break;
        chain.push(successor);
        seen.add(successor.id);
        successorId = successor.superseded_by_id;
      }

      let predecessorId = item.id;
      while (chain.length < MAX_DETAIL_CHAIN_HOPS) {
        const predecessors = await persistence.listSupersessionPredecessors({
          organizationId: input.organizationId,
          itemId: predecessorId,
          limit: 1,
        });
        const predecessor = predecessors.find(
          (candidate) =>
            !seen.has(candidate.id) && input.sensitivities.includes(candidate.sensitivity),
        );
        if (!predecessor) break;
        chain.unshift(predecessor);
        seen.add(predecessor.id);
        predecessorId = predecessor.id;
      }

      const rawLinks = await persistence.listItemLinks({
        organizationId: input.organizationId,
        itemId: item.id,
      });
      const targetIds = rawLinks.map((link) =>
        link.from_item_id === item.id ? link.to_item_id : link.from_item_id,
      );
      const targetRows = await Promise.all(
        [...new Set(targetIds)].map(async (targetId) =>
          persistence.getItem({ organizationId: input.organizationId, itemId: targetId }),
        ),
      );
      const visibleTargetIds = new Set(
        targetRows
          .filter(
            (target): target is MemoryItemRow =>
              target !== null && input.sensitivities.includes(target.sensitivity),
          )
          .map((target) => target.id),
      );
      const links = rawLinks.flatMap((link) => {
        const direction: "from" | "to" = link.from_item_id === item.id ? "to" : "from";
        const relatedItemId = direction === "to" ? link.to_item_id : link.from_item_id;
        return visibleTargetIds.has(relatedItemId)
          ? [{ id: link.id, relation: link.relation, direction, relatedItemId }]
          : [];
      });

      return { item, chain, links };
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
