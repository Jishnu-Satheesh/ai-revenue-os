import type { MemoryRetrievalResult } from "@/domain/memory/schemas";
import { deriveFreshness } from "@/domain/memory/freshness";
import { deriveTrustRank } from "@/domain/memory/trust";
import type { SourceTier, VerificationState } from "@/domain/memory/types";
import type { BusinessFactRow } from "@/modules/memory/application/ports";

/**
 * Read-through projection of the digital twin. `business_facts` stays the
 * single writable source of truth (ADR 0011); this only borrows its rows at
 * read time so one API can answer with both stores ranked together.
 *
 * Projected facts are never embedded, so their semantic score is always zero
 * and their trust rank is what carries them up the ordering.
 */
export function projectBusinessFact(input: {
  fact: BusinessFactRow;
  lexical: number;
  now?: Date;
}): MemoryRetrievalResult {
  const { fact } = input;

  const verificationState: VerificationState =
    fact.status === "verified" ? "verified" : "unverified";
  const sourceTier: SourceTier =
    fact.status === "verified" ? 1 : fact.status === "inferred" ? 5 : 2;
  const trustRank = deriveTrustRank({ verificationState, sourceTier });

  // A `stale` fact status is the digital twin's own freshness signal, and it
  // must win over the date-derived answer rather than be recomputed away.
  const freshness =
    fact.status === "stale"
      ? "stale"
      : deriveFreshness({
          now: input.now,
          effectiveTo: fact.effective_to ?? undefined,
        });

  return {
    itemId: null,
    memoryType: "structured_fact",
    title: fact.fact_key,
    structuredValue: fact.value,
    provenance: {
      origin: fact.status === "verified" ? "user_verified" : "provider_imported",
      sourceTier,
      sourceSystem: fact.source,
      // Points at the business_facts row, because there is no memory item id.
      sourceReference: fact.id,
      verificationState,
      verifiedAt: fact.last_verified_at ?? undefined,
      confidence: fact.confidence ?? undefined,
    },
    trustRank,
    freshness,
    effectiveFrom: fact.effective_from ?? undefined,
    effectiveTo: fact.effective_to ?? undefined,
    sensitivity: "internal",
    scores: { lexical: input.lexical, semantic: 0, blended: input.lexical * 0.5 },
  };
}

/**
 * A deliberately simple lexical score for projected facts. Postgres ranks
 * memory rows with `ts_rank_cd`; facts are matched with an `ilike` filter that
 * returns no score, so overlap of query terms against the key and the rendered
 * value stands in. It is bounded to [0, 1] so it blends on the same scale.
 */
export function scoreFactAgainstQuery(fact: BusinessFactRow, query: string): number {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 2);
  if (terms.length === 0) return 0;

  const haystack = `${fact.fact_key} ${JSON.stringify(fact.value ?? "")}`.toLowerCase();
  const matched = terms.filter((term) => haystack.includes(term)).length;
  return matched / terms.length;
}
