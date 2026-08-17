import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { memoryError } from "@/domain/memory/errors";
import type { Database } from "@/lib/supabase/database.types";
import type {
  BusinessFactRow,
  MemoryBranchOption,
  MemoryItemRow,
  MemoryLinkRow,
  MemoryPersistencePort,
  MemorySearchRow,
  MemorySnapshotCounts,
} from "@/modules/memory/application/ports";
import type {
  MemoryProposalConfirmation,
  MemoryProposalRejection,
  MemoryTransactionPort,
} from "@/modules/memory/application/service";

/**
 * `embedding` and `search_vector` are deliberately absent from every column
 * list. They carry no grant, they are useless to a caller, and selecting a
 * 1536-dimension vector per row would dominate every response.
 */
const itemColumns = [
  "id",
  "organization_id",
  "branch_id",
  "memory_type",
  "title",
  "body",
  "structured_value",
  "origin",
  "source_tier",
  "source_system",
  "source_reference",
  "source_run_id",
  "source_record_id",
  "verification_state",
  "confidence",
  "sensitivity",
  "observed_at",
  "effective_from",
  "effective_to",
  "review_due_at",
  "expires_at",
  "superseded_by_id",
  "superseded_at",
  "supersession_reason",
  "rejection_reason",
  "proposed_fact_key",
  "proposed_fact_value",
  "proposed_branch_id",
  "embedding_model",
  "embedding_status",
  "embedding_updated_at",
  "created_by",
  "verified_by",
  "verified_at",
  "created_at",
  "updated_at",
].join(", ");

const factColumns = [
  "id",
  "organization_id",
  "branch_id",
  "fact_key",
  "value",
  "source",
  "source_reference",
  "status",
  "confidence",
  "effective_from",
  "effective_to",
  "last_verified_at",
  "updated_at",
].join(", ");

const linkColumns = [
  "id",
  "organization_id",
  "from_item_id",
  "to_item_id",
  "relation",
  "created_by",
  "created_at",
].join(", ");

function databaseError(message: string, cause: unknown): never {
  throw memoryError("CONFLICT", {}, { message, cause });
}

type MemoryTable =
  | "memory_items"
  | "memory_links"
  | "memory_retrieval_log"
  | "business_facts"
  | "branches";

type FluentQuery = {
  eq(column: string, match: string): FluentQuery;
  in(column: string, values: readonly string[]): FluentQuery;
  is(column: string, value: null): FluentQuery;
  or(filter: string): FluentQuery;
  lt(column: string, value: string): FluentQuery;
  gte(column: string, value: string): FluentQuery;
  ilike(column: string, pattern: string): FluentQuery;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): FluentQuery;
  limit(count: number): FluentQuery;
  select(columns: string): FluentQuery;
  single(): PromiseLike<{ data: unknown; error: unknown }>;
  maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * A browser-authenticated client invokes the security-definer RPC only through
 * this narrow port. The RPC independently binds the auth user, membership,
 * role, and organization before it mutates either store.
 */
export function createSupabaseMemoryPromotionTransactionPort(
  authenticatedSupabase: SupabaseClient<Database>,
): MemoryTransactionPort {
  const client = authenticatedSupabase as unknown as {
    rpc(
      name: string,
      args: Record<string, unknown>,
    ): PromiseLike<{ data: unknown; error: unknown }>;
  };

  return {
    async createItem(input) {
      const result = await client.rpc("create_authenticated_memory_item", {
        p_organization_id: input.organizationId,
        p_actor_id: input.actorId,
        p_memory_type: input.memoryType,
        p_title: input.title,
        p_body: input.body ?? null,
        p_branch_id: input.branchId ?? null,
        p_sensitivity: input.sensitivity,
        p_mark_verified: input.markVerified,
        p_review_due_at: input.reviewDueAt ?? null,
        p_expires_at: input.expiresAt ?? null,
        p_idempotency_key: input.idempotencyKey,
        p_correlation_id: input.correlationId,
      });
      if (result.error || result.data === null) {
        databaseError("The memory item could not be created.", result.error);
      }
      return result.data as { item: MemoryItemRow; replayed: boolean };
    },
    async updateItem(input) {
      const result = await client.rpc("update_authenticated_memory_item", {
        p_organization_id: input.organizationId,
        p_actor_id: input.actorId,
        p_item_id: input.itemId,
        p_action: input.action,
        p_reason: input.reason ?? null,
        p_sensitivity: input.sensitivity ?? null,
        p_review_due_at: input.reviewDueAt ?? null,
        p_set_review_due_at: input.setReviewDueAt,
        p_idempotency_key: input.idempotencyKey,
        p_correlation_id: input.correlationId,
      });
      if (result.error || result.data === null) {
        databaseError("The memory item could not be updated.", result.error);
      }
      return result.data as { item: MemoryItemRow; replayed: boolean };
    },
    async confirmProposal(input) {
      const result = await client.rpc("confirm_memory_fact_proposal", {
        p_organization_id: input.organizationId,
        p_actor_id: input.actorId,
        p_item_id: input.itemId,
        p_override_verified: input.overrideVerified,
        p_idempotency_key: input.idempotencyKey,
        p_correlation_id: input.correlationId,
      });
      if (result.error || result.data === null) {
        databaseError("The fact proposal could not be confirmed.", result.error);
      }
      return result.data as MemoryProposalConfirmation;
    },
    async rejectProposal(input) {
      const result = await client.rpc("reject_memory_proposal", {
        p_organization_id: input.organizationId,
        p_actor_id: input.actorId,
        p_item_id: input.itemId,
        p_reason: input.reason,
        p_idempotency_key: input.idempotencyKey,
        p_correlation_id: input.correlationId,
      });
      if (result.error || result.data === null) {
        databaseError("The memory proposal could not be rejected.", result.error);
      }
      return result.data as MemoryProposalRejection;
    },
    async supersede(input) {
      const result = await client.rpc("supersede_memory_item", {
        p_organization_id: input.organizationId,
        p_actor_id: input.actorId,
        p_item_id: input.itemId,
        p_title: input.title,
        p_body: input.body ?? null,
        p_sensitivity: input.sensitivity,
        p_supersession_reason: input.reason,
        p_idempotency_key: input.idempotencyKey,
        p_correlation_id: input.correlationId,
      });
      if (result.error || result.data === null) {
        databaseError("The memory item could not be superseded.", result.error);
      }
      const response = result.data as {
        replacementId: string;
        supersededId: string;
        replayed?: boolean;
      };
      return {
        replacementId: response.replacementId,
        supersededId: response.supersededId,
        replayed: response.replayed === true,
      };
    },
  };
}

/**
 * The generated `Database` type predates the memory migration, so the dynamic
 * table strings and column lists stay confined to this adapter. See
 * `src/modules/memory/application/ports.ts`.
 */
export function createSupabaseMemoryPersistence(
  authenticatedSupabase: SupabaseClient<Database>,
): MemoryPersistencePort {
  const client = authenticatedSupabase as unknown as {
    from(table: MemoryTable): {
      select(columns: string, options?: { count?: "exact"; head?: boolean }): FluentQuery;
      insert(values: unknown): FluentQuery;
      update(values: unknown): FluentQuery;
    };
    rpc(
      name: string,
      args: Record<string, unknown>,
    ): PromiseLike<{ data: unknown; error: unknown }>;
  };

  const fluent = (value: unknown): FluentQuery => value as FluentQuery;

  const rows = async <T>(operation: unknown, message: string): Promise<T[]> => {
    const result = (await operation) as { data: T[] | null; error: unknown };
    if (result.error) databaseError(message, result.error);
    return result.data ?? [];
  };

  const scoped = (table: MemoryTable, columns: string, organizationId: string): FluentQuery =>
    client.from(table).select(columns).eq("organization_id", organizationId);

  /**
   * Sensitivity is filtered here as well as in RLS. RLS is the enforcement; this
   * keeps a caller's declared ceiling honest even when their role would allow
   * more, which is what makes a cache key by ceiling meaningful.
   */
  const withSensitivity = (query: FluentQuery, sensitivities: readonly string[]): FluentQuery =>
    query.in("sensitivity", sensitivities);

  const withExclusions = (
    query: FluentQuery,
    includeSuperseded: boolean,
    includeExpired: boolean,
    now: string,
  ): FluentQuery => {
    let next = query.in("verification_state", ["unverified", "verified"]);
    if (!includeSuperseded) next = next.is("superseded_by_id", null);
    if (!includeExpired) {
      next = next.or(`expires_at.is.null,expires_at.gte.${now}`);
      next = next.or(`effective_to.is.null,effective_to.gte.${now}`);
    }
    return next;
  };

  return {
    async search(parameters) {
      const result = await client.rpc("search_memory_items", {
        p_organization_id: parameters.organizationId,
        p_query: parameters.query,
        p_query_embedding: parameters.queryEmbedding
          ? `[${parameters.queryEmbedding.join(",")}]`
          : null,
        p_branch_id: parameters.branchId ?? null,
        p_memory_types: parameters.memoryTypes ? [...parameters.memoryTypes] : null,
        p_sensitivities: [...parameters.sensitivities],
        p_max_age_days: parameters.maxAgeDays ?? null,
        p_include_superseded: parameters.includeSuperseded,
        p_include_expired: parameters.includeExpired,
        p_lexical_weight: parameters.lexicalWeight,
        p_semantic_weight: parameters.semanticWeight,
        p_limit: parameters.limit,
      });
      if (result.error) databaseError("Memory search failed.", result.error);
      return (result.data ?? []) as MemorySearchRow[];
    },

    async searchFacts({ organizationId, query, branchId, limit }) {
      let request = scoped("business_facts", factColumns, organizationId);
      if (branchId) request = request.eq("branch_id", branchId);
      const terms = query
        .split(/\s+/)
        .map((term) => term.replace(/[%,()]/g, "").trim())
        .filter((term) => term.length > 2)
        .slice(0, 5);
      if (terms.length > 0) {
        request = request.or(
          terms.map((term) => `fact_key.ilike.%${term}%,value::text.ilike.%${term}%`).join(","),
        );
      }
      return rows<BusinessFactRow>(
        request.order("updated_at", { ascending: false }).limit(limit),
        "Business facts could not be loaded for retrieval.",
      );
    },

    async projectGoogleBusinessProfileRecord(input) {
      const result = await client.rpc("project_google_business_profile_record", {
        p_organization_id: input.organizationId,
        p_ingestion_run_id: input.ingestionRunId,
        p_source_connection_id: input.sourceConnectionId,
        p_source_system: input.sourceSystem,
        p_source_record_id: input.sourceRecordId,
        p_branch_id: input.branchId ?? null,
        p_title: input.title,
        p_body: input.body,
        p_structured_value: input.structuredValue,
        p_sensitivity: input.sensitivity,
        p_observed_at: input.observedAt,
        p_location_fact_values: input.locationFactValues,
      });
      if (result.error) databaseError("The provider record could not be projected.", result.error);
    },

    async hydrateByIds({ organizationId, ids, sensitivities, includeSuperseded, includeExpired }) {
      if (ids.length === 0) return [];
      const now = new Date().toISOString();
      const request = withExclusions(
        withSensitivity(scoped("memory_items", itemColumns, organizationId), sensitivities).in(
          "id",
          ids,
        ),
        includeSuperseded,
        includeExpired,
        now,
      );
      return rows<MemoryItemRow>(request, "Memory items could not be hydrated.");
    },

    async getItem({ organizationId, itemId }) {
      const result = (await scoped("memory_items", itemColumns, organizationId)
        .eq("id", itemId)
        .maybeSingle()) as { data: unknown; error: unknown };
      if (result.error) databaseError("The memory item could not be loaded.", result.error);
      return (result.data as MemoryItemRow | null) ?? null;
    },

    async getCurrentFact({ organizationId, factKey, branchId }) {
      // Null-equality, not `eq`, so an organization-wide fact is never matched
      // by a branch-scoped proposal or the other way round.
      const base = scoped("business_facts", factColumns, organizationId).eq("fact_key", factKey);
      const request =
        branchId === null ? base.is("branch_id", null) : base.eq("branch_id", branchId);
      const result = (await request.maybeSingle()) as { data: unknown; error: unknown };
      if (result.error) databaseError("The current fact could not be loaded.", result.error);
      return (result.data as BusinessFactRow | null) ?? null;
    },

    async listBranchOptions({ organizationId }) {
      return rows<MemoryBranchOption>(
        scoped("branches", "id, name", organizationId).order("name", { ascending: true }),
        "The organization's branches could not be loaded.",
      );
    },

    async listTimeline({ organizationId, sensitivities, branchId, sourceSystems, limit, cursor }) {
      let request = withSensitivity(
        scoped("memory_items", itemColumns, organizationId),
        sensitivities,
      )
        .in("memory_type", ["episode", "decision", "outcome"])
        .in("verification_state", ["unverified", "verified"]);
      if (branchId) request = request.eq("branch_id", branchId);
      if (sourceSystems && sourceSystems.length > 0)
        request = request.in("source_system", sourceSystems);
      if (cursor) {
        request =
          cursor.observedAt === null
            ? request.or(
                `and(observed_at.is.null,created_at.lt.${cursor.createdAt}),and(observed_at.is.null,created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
              )
            : request.or(
                `observed_at.is.null,observed_at.lt.${cursor.observedAt},and(observed_at.eq.${cursor.observedAt},created_at.lt.${cursor.createdAt}),and(observed_at.eq.${cursor.observedAt},created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
              );
      }
      return rows<MemoryItemRow>(
        request
          .order("observed_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(limit),
        "The memory timeline could not be loaded.",
      );
    },

    async listSupersessionPredecessors({ organizationId, itemId, limit }) {
      return rows<MemoryItemRow>(
        scoped("memory_items", itemColumns, organizationId)
          .eq("superseded_by_id", itemId)
          .order("created_at", { ascending: false })
          .limit(limit),
        "The memory supersession chain could not be loaded.",
      );
    },

    async listItemLinks({ organizationId, itemId }) {
      return rows<MemoryLinkRow>(
        scoped("memory_links", linkColumns, organizationId).or(
          `from_item_id.eq.${itemId},to_item_id.eq.${itemId}`,
        ),
        "The memory evidence links could not be loaded.",
      );
    },

    async listByTypes({ organizationId, sensitivities, memoryTypes, verificationStates, limit }) {
      let request = withSensitivity(
        scoped("memory_items", itemColumns, organizationId),
        sensitivities,
      ).in("memory_type", memoryTypes);
      if (verificationStates) request = request.in("verification_state", verificationStates);
      return rows<MemoryItemRow>(
        request.order("created_at", { ascending: false }).limit(limit),
        "Memory items could not be listed.",
      );
    },

    async listLinks({ organizationId, itemIds }) {
      if (itemIds.length === 0) return [];
      return rows<MemoryLinkRow>(
        scoped("memory_links", linkColumns, organizationId).in("from_item_id", itemIds),
        "Memory links could not be loaded.",
      );
    },

    async insertItem(input) {
      const result = (await fluent(client.from("memory_items").insert(input))
        .select(itemColumns)
        .single()) as { data: unknown; error: unknown };
      if (result.error) databaseError("The memory item could not be created.", result.error);
      return result.data as MemoryItemRow;
    },

    async updateItem({ organizationId, itemId, patch }) {
      const result = (await fluent(client.from("memory_items").update(patch))
        .eq("organization_id", organizationId)
        .eq("id", itemId)
        .select(itemColumns)
        .single()) as { data: unknown; error: unknown };
      if (result.error) databaseError("The memory item could not be updated.", result.error);
      return result.data as MemoryItemRow;
    },

    async insertLinks({ links }) {
      if (links.length === 0) return;
      const result = (await client.from("memory_links").insert(links)) as unknown as {
        error: unknown;
      };
      if (result.error) databaseError("Memory links could not be created.", result.error);
    },

    async insertRetrievalLog(input) {
      const result = (await client.from("memory_retrieval_log").insert(input)) as unknown as {
        error: unknown;
      };
      // A retrieval log failure must never fail the retrieval it describes, but
      // it must not be silent either: the caller logs and continues.
      if (result.error) databaseError("The retrieval could not be logged.", result.error);
    },

    async countsFor({ organizationId }) {
      const items = await rows<
        Pick<
          MemoryItemRow,
          "memory_type" | "verification_state" | "sensitivity" | "embedding_status"
        >
      >(
        scoped(
          "memory_items",
          "memory_type, verification_state, sensitivity, embedding_status",
          organizationId,
        ).limit(5000),
        "Memory counts could not be loaded.",
      );

      const tally = (values: readonly string[]): Record<string, number> =>
        values.reduce<Record<string, number>>((accumulator, value) => {
          accumulator[value] = (accumulator[value] ?? 0) + 1;
          return accumulator;
        }, {});

      const counts: MemorySnapshotCounts = {
        byType: tally(items.map((item) => item.memory_type)),
        byVerificationState: tally(items.map((item) => item.verification_state)),
        bySensitivity: tally(items.map((item) => item.sensitivity)),
        reviewQueueDepth: items.filter((item) => item.verification_state === "proposed").length,
        embeddingBacklog: items.filter((item) => item.embedding_status === "pending").length,
        total: items.length,
      };
      return counts;
    },
  };
}
