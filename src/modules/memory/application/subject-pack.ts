import "server-only";

import { createHash } from "node:crypto";

import {
  buildBusinessFactSummary,
  buildBusinessProfileSummary,
  buildMemoryItemSummary,
  CONTEXT_POLICY_VERSION_DEFAULT,
  type ContextEntry,
} from "@/domain/memory/context";
import { assembleContextPack } from "@/modules/memory/application/context-service";
import type { ContextCandidate } from "@/modules/memory/application/context-selection";
import type { ContextRepository } from "@/modules/memory/infrastructure/context-repository";
import type { MemoryPersistencePort, MemorySearchRow } from "@/modules/memory/application/ports";

/**
 * Governed subject-drafting packs (Spec 023 Task 11). Server-only: pack
 * assembly hashes with node:crypto, and this composer is the first production
 * caller of the candidate pipeline, so it stays out of the browser graph.
 *
 * The composer predicts summaries with the same canonical builders the
 * finalization RPC recomputes; a mismatch is refused server-side (23514),
 * never repaired here. Memory rows keep their stored trust rank; current
 * authoritative state enters as mandatory rank-0/1 entries. Goals and
 * constraints stay out of drafting packs: a subject description needs
 * identity facts, not targets or limits.
 *
 * Legacy rows are excluded by the search boundary (`p_include_legacy`
 * defaults false); this layer additionally maps every memory row to the
 * observation statement kind, the safe direction for rows whose captured
 * knowledge kind is not visible at this layer.
 */

export type SubjectPackEntry = Pick<
  ContextEntry,
  | "contextRef"
  | "sourceKind"
  | "sourceId"
  | "title"
  | "summary"
  | "statementKind"
  | "trustRank"
  | "freshness"
  | "sensitivity"
>;

export type SubjectPackResult = {
  manifestId: string;
  contextDigest: string;
  status: string;
  entries: readonly SubjectPackEntry[];
  excludedCount: number;
  degradedReasons: readonly string[];
};

export type SubjectPackPort = {
  prepare(input: {
    organizationId: string;
    actorId: string;
    query: string;
    correlationId: string;
  }): Promise<SubjectPackResult>;
  consume(input: {
    organizationId: string;
    manifestId: string;
    modelId: string;
    modelCalledAt: string;
  }): Promise<void>;
};

/**
 * Minimal current-state shape the composer needs. The composition root adapts
 * the infrastructure reader to this port; application code never imports the
 * adapter. Goals and constraints are absent by design: drafting packs carry
 * identity facts, never targets or limits.
 */
export type SubjectStateFact = {
  id: string;
  fact_key: string;
  status: string;
  source: string;
  value: unknown;
  branch_id: string | null;
  effective_from: string | null;
  effective_to: string | null;
};

export type SubjectStateProfile = {
  organization_id: string;
  business_model: string | null;
  value_proposition: string | null;
};

export type SubjectCurrentState = {
  profile: SubjectStateProfile | null;
  facts: readonly {
    fact: SubjectStateFact;
    scope: "organization" | "branch";
    conflict: { withIds: string[] } | null;
  }[];
};

export type SubjectPackDependencies = {
  readState: (input: { organizationId: string }) => Promise<SubjectCurrentState>;
  persistence: Pick<MemoryPersistencePort, "search">;
  contexts: Pick<
    ContextRepository,
    "prepareForSubject" | "revalidateForSubject" | "consumeForSubject"
  >;
  nowIso: () => string;
};

const SUBJECT_MEMORY_TYPES = ["document", "note", "episode"] as const;
const SUBJECT_SEARCH_LIMIT = 12;
const CURRENT_STATE_PRIORITY = 0;
const MEMORY_PRIORITY = 10;

function fingerprint(input: {
  organizationId: string;
  actorId: string;
  query: string;
  policyVersion: string;
}): string {
  return createHash("sha256")
    .update(
      ["subject_drafting", input.organizationId, input.actorId, input.query, input.policyVersion].join(
        "|",
      ),
      "utf8",
    )
    .digest("hex");
}

function currentCandidates(
  state: SubjectCurrentState,
  nowIso: string,
): (ContextCandidate & { entry: Omit<ContextEntry, "contextRef"> })[] {
  const candidates: (ContextCandidate & { entry: Omit<ContextEntry, "contextRef"> })[] = [];
  if (state.profile) {
    const summary = buildBusinessProfileSummary({
      businessModel: state.profile.business_model,
      valueProposition: state.profile.value_proposition,
    });
    candidates.push({
      id: `current:business_profile:${state.profile.organization_id}`,
      section: "current",
      trustRank: 0,
      scopeExact: true,
      relevance: 0,
      observedAt: nowIso,
      targetKey: null,
      rootRefs: [],
      contradicts: false,
      aiGenerated: false,
      sourceBacked: true,
      optional: false,
      priority: CURRENT_STATE_PRIORITY,
      sourceKey: `business_profile:${state.profile.organization_id}`,
      entry: {
        sourceKind: "business_profile",
        sourceId: state.profile.organization_id,
        sourceRevision: null,
        sourceDigest: null,
        section: "current",
        statementKind: "observation",
        title: "Business profile",
        summary,
        scopeBranchId: null,
        scopeChannelId: null,
        trustRank: 0,
        freshness: "fresh",
        sensitivity: "internal",
        observedAt: null,
        effectiveFrom: null,
        effectiveTo: null,
        rootRefs: [],
        useRestriction: null,
        priority: CURRENT_STATE_PRIORITY,
        optional: false,
      },
    });
  }
  for (const labeled of state.facts) {
    candidates.push(factCandidate(labeled, nowIso));
  }
  return candidates;
}

function factCandidate(
  labeled: SubjectCurrentState["facts"][number],
  nowIso: string,
): ContextCandidate & { entry: Omit<ContextEntry, "contextRef"> } {
  const summary = buildBusinessFactSummary({
    factKey: labeled.fact.fact_key,
    status: labeled.fact.status,
    source: labeled.fact.source,
    value: labeled.fact.value,
  });
  return {
    id: `current:business_fact:${labeled.fact.id}`,
    section: "current",
    trustRank: 0,
    scopeExact: labeled.scope === "organization",
    relevance: 0,
    observedAt: nowIso,
    targetKey: null,
    rootRefs: [],
    contradicts: labeled.conflict !== null,
    aiGenerated: false,
    sourceBacked: true,
    optional: false,
    priority: CURRENT_STATE_PRIORITY,
    sourceKey: `business_fact:${labeled.fact.id}`,
    entry: {
      sourceKind: "business_fact",
      sourceId: labeled.fact.id,
      sourceRevision: null,
      sourceDigest: null,
      section: "current",
      statementKind: "observation",
      title: labeled.fact.fact_key,
      summary,
      scopeBranchId: labeled.fact.branch_id,
      scopeChannelId: null,
      trustRank: 0,
      freshness: "fresh",
      sensitivity: "internal",
      observedAt: null,
      effectiveFrom: labeled.fact.effective_from,
      effectiveTo: labeled.fact.effective_to,
      rootRefs: [],
      useRestriction: labeled.conflict ? "Equal-authority conflict: present both values." : null,
      priority: CURRENT_STATE_PRIORITY,
      optional: false,
    },
  };
}

function memoryCandidate(
  row: MemorySearchRow,
  nowIso: string,
): ContextCandidate & { entry: Omit<ContextEntry, "contextRef"> } {
  const summary = buildMemoryItemSummary({ title: row.title, body: row.body });
  const aiGenerated = row.origin === "ai_proposed" || row.origin === "outcome_learned";
  return {
    id: `memory_item:${row.id}`,
    section: "observations",
    trustRank: row.trust_rank,
    scopeExact: true,
    relevance: row.blended,
    observedAt: row.observed_at ?? nowIso,
    targetKey: null,
    rootRefs: [],
    contradicts: false,
    aiGenerated,
    sourceBacked: !aiGenerated,
    optional: true,
    priority: MEMORY_PRIORITY,
    sourceKey: `memory_item:${row.id}`,
    entry: {
      sourceKind: "memory_item",
      sourceId: row.id,
      sourceRevision: null,
      sourceDigest: null,
      section: "observations",
      statementKind: "observation",
      title: row.title,
      summary,
      scopeBranchId: null,
      scopeChannelId: null,
      trustRank: row.trust_rank,
      freshness: row.freshness,
      sensitivity: row.sensitivity,
      observedAt: row.observed_at,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      rootRefs: [],
      useRestriction: null,
      priority: MEMORY_PRIORITY,
      optional: true,
    },
  };
}

export function createSubjectPackPort(dependencies: SubjectPackDependencies): SubjectPackPort {
  async function assembleOnce(input: {
    organizationId: string;
    actorId: string;
    query: string;
    correlationId: string;
    attemptKey: string;
  }): Promise<SubjectPackResult> {
    const nowIso = dependencies.nowIso();
    let state: SubjectCurrentState | null = null;
    const degradedReasons: string[] = [];
    try {
      state = await dependencies.readState({ organizationId: input.organizationId });
    } catch {
      // Current authority is desirable, not load-bearing for a draft the
      // human confirms: proceed memory-only and say so on the pack.
      degradedReasons.push("CURRENT_STATE_UNAVAILABLE");
    }

    const rows = await dependencies.persistence.search({
      organizationId: input.organizationId,
      query: input.query.slice(0, 500),
      queryEmbedding: null,
      memoryTypes: [...SUBJECT_MEMORY_TYPES],
      sensitivities: ["public", "internal"],
      includeSuperseded: false,
      includeExpired: false,
      includeLegacy: false,
      lexicalWeight: 1,
      semanticWeight: 0,
      limit: SUBJECT_SEARCH_LIMIT,
    });

    const candidates = [
      ...(state ? currentCandidates(state, nowIso) : []),
      ...rows.map((row) => memoryCandidate(row, nowIso)),
    ];

    const assembled = assembleContextPack({
      request: {
        organizationId: input.organizationId,
        purpose: "subject_drafting",
        consumerKind: "subject_operation",
        consumerId: input.actorId,
        attemptKey: input.attemptKey,
        correlationId: input.correlationId,
        query: input.query.slice(0, 500),
        policyVersion: CONTEXT_POLICY_VERSION_DEFAULT,
      },
      candidates,
      retrievalLatencyMs: null,
    });

    const prepared = await dependencies.contexts.prepareForSubject({
      organizationId: input.organizationId,
      actorId: input.actorId,
      purpose: "subject_drafting",
      correlationId: input.correlationId,
      branchId: null,
      channelId: null,
      requestFingerprint: fingerprint({
        organizationId: input.organizationId,
        actorId: input.actorId,
        query: input.query.slice(0, 500),
        policyVersion: CONTEXT_POLICY_VERSION_DEFAULT,
      }),
      policyVersion: CONTEXT_POLICY_VERSION_DEFAULT,
      entries: assembled.entries.map((entry) => ({
        sourceKind: entry.sourceKind,
        sourceId: entry.sourceId,
        summary: entry.summary,
        priority: entry.priority,
        optional: entry.optional,
        section: entry.section,
        statementKind: entry.statementKind,
        trustRank: entry.trustRank,
        freshness: entry.freshness,
        sensitivity: entry.sensitivity,
        scopeBranchId: entry.scopeBranchId,
        scopeChannelId: entry.scopeChannelId,
        observedAt: entry.observedAt,
        effectiveFrom: entry.effectiveFrom,
        effectiveTo: entry.effectiveTo,
        rootRefs: entry.rootRefs,
        useRestriction: entry.useRestriction,
      })),
      retrievalLatencyMs: null,
    });

    const excludedCount = Object.values(assembled.exclusions).reduce((sum, count) => sum + count, 0);
    return {
      manifestId: prepared.manifestId,
      contextDigest: prepared.contextDigest,
      status: prepared.status,
      entries: assembled.entries.map((entry) => ({
        contextRef: entry.contextRef,
        sourceKind: entry.sourceKind,
        sourceId: entry.sourceId,
        title: entry.title,
        summary: entry.summary,
        statementKind: entry.statementKind,
        trustRank: entry.trustRank,
        freshness: entry.freshness,
        sensitivity: entry.sensitivity,
      })),
      excludedCount,
      degradedReasons: [...assembled.degradedReasons, ...degradedReasons],
    };
  }

  return {
    async prepare(input) {
      const first = await assembleOnce({ ...input, attemptKey: input.correlationId });
      const revalidated = await dependencies.contexts.revalidateForSubject({
        organizationId: input.organizationId,
        manifestId: first.manifestId,
      });
      if (revalidated.status === "valid") return first;
      if (revalidated.status !== "changed") return { ...first, entries: [], status: revalidated.status };
      const second = await assembleOnce({ ...input, attemptKey: `${input.correlationId}:retry-1` });
      const rechecked = await dependencies.contexts.revalidateForSubject({
        organizationId: input.organizationId,
        manifestId: second.manifestId,
      });
      if (rechecked.status === "valid") return second;
      return { ...second, entries: [], status: rechecked.status };
    },

    async consume(input) {
      await dependencies.contexts.consumeForSubject({
        organizationId: input.organizationId,
        manifestId: input.manifestId,
        providerName: "campaign-subject-drafter",
        modelId: input.modelId,
        modelCalledAt: input.modelCalledAt,
      });
    },
  };
}
