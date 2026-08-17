import { memoryError } from "@/domain/memory/errors";
import { isSensitivityWithinCeiling, sensitivitiesWithinCeiling } from "@/domain/memory/purposes";
import {
  memoryRetrievalQuerySchema,
  type MemoryRetrievalPort,
  type MemoryRetrievalQuery,
  type MemoryRetrievalQueryInput,
  type MemoryRetrievalResponse,
  type MemoryRetrievalResult,
} from "@/domain/memory/schemas";
import type { DegradedReason, PersistableMemoryType, Sensitivity } from "@/domain/memory/types";
import {
  projectBusinessFact,
  scoreFactAgainstQuery,
} from "@/modules/memory/application/fact-projection";
import type { MemorySearchRow } from "@/modules/memory/application/ports";
import { LEXICAL_WEIGHT, rankResults, SEMANTIC_WEIGHT } from "@/modules/memory/application/ranking";
import type { EmbeddingProvider } from "@/modules/memory/infrastructure/embedding-provider";
import type { MemoryRepository } from "@/modules/memory/infrastructure/repository";

export type RetrievalDependencies = {
  repository: MemoryRepository;
  embeddings: EmbeddingProvider | null;
  /** Resolved from the caller's purpose and role before retrieval is invoked. */
  ceilingFor: (query: MemoryRetrievalQuery) => Sensitivity;
  actorFor?: (query: MemoryRetrievalQuery) => {
    actorType: "user" | "system" | "ai";
    actorId?: string;
  };
  logger?: { warn: (message: string, context?: Record<string, unknown>) => void };
  now?: () => Date;
};

function toResult(row: MemorySearchRow): MemoryRetrievalResult {
  return {
    itemId: row.id,
    memoryType: row.memory_type,
    title: row.title,
    body: row.body ?? undefined,
    structuredValue: row.structured_value ?? undefined,
    provenance: {
      origin: row.origin,
      sourceTier: row.source_tier,
      sourceSystem: row.source_system ?? undefined,
      sourceReference: row.source_reference ?? undefined,
      verificationState: row.verification_state,
      verifiedAt: row.verified_at ?? undefined,
      confidence: row.confidence ?? undefined,
    },
    trustRank: row.trust_rank,
    freshness: row.freshness,
    observedAt: row.observed_at ?? undefined,
    effectiveFrom: row.effective_from ?? undefined,
    effectiveTo: row.effective_to ?? undefined,
    sensitivity: row.sensitivity,
    scores: {
      lexical: row.lexical,
      semantic: row.semantic,
      blended: row.blended,
    },
  };
}

export function createMemoryRetrieval(dependencies: RetrievalDependencies): MemoryRetrievalPort {
  const now = dependencies.now ?? (() => new Date());

  return {
    async retrieve(input: MemoryRetrievalQueryInput): Promise<MemoryRetrievalResponse> {
      const query = memoryRetrievalQuerySchema.parse(input);
      const startedAt = Date.now();
      const actor = dependencies.actorFor?.(query) ?? { actorType: "system" as const };
      const ceiling = dependencies.ceilingFor(query);

      const logRetrieval = async (entry: {
        results: readonly MemoryRetrievalResult[];
        retrievalMode: "hybrid" | "lexical";
        degradedReason?: DegradedReason;
        denied: boolean;
        servedFromCache?: boolean;
      }) => {
        try {
          await dependencies.repository.insertRetrievalLog({
            organization_id: query.organizationId,
            purpose: query.purpose,
            actor_type: actor.actorType,
            actor_id: actor.actorId ?? null,
            query_text: query.query,
            retrieval_mode: entry.retrievalMode,
            degraded_reason: entry.degradedReason ?? null,
            requested_types: query.memoryTypes ?? [],
            sensitivity_allowance: query.sensitivityAllowance,
            denied: entry.denied,
            result_item_ids: entry.results
              .map((result) => result.itemId)
              .filter((itemId): itemId is string => itemId !== null),
            result_count: entry.results.length,
            served_from_cache: entry.servedFromCache ?? false,
            latency_ms: Date.now() - startedAt,
            correlation_id: query.correlationId,
          });
        } catch (error) {
          // Logging must never fail the retrieval it describes.
          dependencies.logger?.warn("memory.retrieval_log_failed", {
            organizationId: query.organizationId,
            correlationId: query.correlationId,
            error,
          });
        }
      };

      // The ceiling is checked before anything else runs, and a denial returns
      // no rows rather than a quietly narrowed set.
      if (!isSensitivityWithinCeiling(query.sensitivityAllowance, ceiling)) {
        await logRetrieval({ results: [], retrievalMode: "lexical", denied: true });
        throw memoryError("MEMORY_SENSITIVITY_DENIED", {
          purpose: query.purpose,
          requested: query.sensitivityAllowance,
          ceiling,
        });
      }

      const sensitivities = sensitivitiesWithinCeiling(query.sensitivityAllowance);

      let queryEmbedding: readonly number[] | null = null;
      let retrievalMode: "hybrid" | "lexical" = "lexical";
      let degradedReason: DegradedReason | undefined = "EMBEDDING_NOT_CONFIGURED";

      if (dependencies.embeddings) {
        try {
          const [vector] = await dependencies.embeddings.embed({
            organizationId: query.organizationId,
            correlationId: query.correlationId,
            texts: [query.query],
          });
          if (vector && vector.length > 0) {
            queryEmbedding = vector;
            retrievalMode = "hybrid";
            degradedReason = undefined;
          } else {
            degradedReason = "EMBEDDING_UNAVAILABLE";
          }
        } catch (error) {
          // Never fail a search because an external model is unavailable.
          degradedReason =
            error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
              ? "EMBEDDING_TIMEOUT"
              : "EMBEDDING_UNAVAILABLE";
          dependencies.logger?.warn("memory.embedding_degraded", {
            organizationId: query.organizationId,
            correlationId: query.correlationId,
            degradedReason,
          });
        }
      }

      const wantsFacts = !query.memoryTypes || query.memoryTypes.includes("structured_fact");
      const persistableTypes = query.memoryTypes?.filter(
        (memoryType): memoryType is PersistableMemoryType => memoryType !== "structured_fact",
      );

      const [rows, facts] = await Promise.all([
        persistableTypes && persistableTypes.length === 0
          ? Promise.resolve([])
          : dependencies.repository.search({
              organizationId: query.organizationId,
              query: query.query,
              queryEmbedding,
              branchId: query.branchId,
              memoryTypes: persistableTypes,
              sensitivities,
              maxAgeDays: query.maxAgeDays,
              includeSuperseded: query.includeSuperseded,
              includeExpired: query.includeExpired,
              lexicalWeight: LEXICAL_WEIGHT,
              semanticWeight: SEMANTIC_WEIGHT,
              limit: query.limit,
            }),
        wantsFacts && isSensitivityWithinCeiling("internal", query.sensitivityAllowance)
          ? dependencies.repository.searchFacts({
              organizationId: query.organizationId,
              query: query.query,
              branchId: query.branchId,
              limit: query.limit,
            })
          : Promise.resolve([]),
      ]);

      const projected = facts
        .map((fact) => ({ fact, lexical: scoreFactAgainstQuery(fact, query.query) }))
        .filter((candidate) => candidate.lexical > 0)
        .map((candidate) =>
          projectBusinessFact({ fact: candidate.fact, lexical: candidate.lexical, now: now() }),
        )
        .filter(
          (result) =>
            (query.includeExpired || result.freshness !== "expired") &&
            (query.includeSuperseded || result.freshness !== "superseded"),
        );

      const results = rankResults([...rows.map(toResult), ...projected], query.limit);

      await logRetrieval({ results, retrievalMode, degradedReason, denied: false });

      return {
        results,
        retrievalMode,
        degradedReason,
        servedFromCache: false,
        serverTime: now().toISOString(),
      };
    },
  };
}
