import {
  CONTEXT_OBSERVATIONS_AI_CAP,
  CONTEXT_SECTION_BUDGETS,
  CONTEXT_SECTION_CANDIDATE_LIMIT,
  type ContextExclusionCode,
  type ContextSection,
} from "@/domain/memory/context";

/**
 * Deterministic pack selection (Spec 023 §7 step 5). Pure: no I/O, no clock,
 * no randomness. Sorts trust-first, then scope/relevance/time/id; applies
 * per-section quotas with unused-slot transfer to current state and
 * source-backed observations (never raising the AI cap); deduplicates
 * identical roots and exact source revisions while keeping explicitly
 * opposing evidence.
 *
 * Trust ordering mirrors src/domain/memory/trust.ts: a lower trustRank always
 * outranks a higher one, no matter the relevance score. Relevance only orders
 * inside a rank.
 */

export type ContextCandidate = {
  /** Stable identity for tie-breaks and exclusion reporting. */
  id: string;
  section: ContextSection;
  /** Lower outranks higher, unconditionally. */
  trustRank: 0 | 1 | 2 | 3 | 4;
  /** True when the candidate is scoped to the exact requested branch/channel. */
  scopeExact: boolean;
  /** Lexical/vector relevance; orders only inside equal trust and scope. */
  relevance: number;
  /** Original observed time, ISO string; newer wins ties. */
  observedAt: string;
  /** Newer intent for the same target replaces older intent (ack-vs-plan). */
  targetKey: string | null;
  /** Evidence family: candidates whose roots are all already kept are dropped. */
  rootRefs: readonly string[];
  /** Opposing evidence survives root dedup; it is labeled, not merged. */
  contradicts: boolean;
  /** Unverified AI-generated entries count against the observations AI cap. */
  aiGenerated: boolean;
  /** Source-backed (non-AI) entries may receive transferred slots. */
  sourceBacked: boolean;
  /** Mandatory entries are never dropped to fit; overflow turns partial. */
  optional: boolean;
  /** Lower priority drops first when the renderer enforces the byte budget. */
  priority: number;
  /** Exact source revision identity for dedup. */
  sourceKey: string;
};

export type ContextSelection = {
  selected: ContextCandidate[];
  excluded: { id: string; code: ContextExclusionCode }[];
};

function compareCandidates(left: ContextCandidate, right: ContextCandidate): number {
  if (left.trustRank !== right.trustRank) return left.trustRank - right.trustRank;
  if (left.scopeExact !== right.scopeExact) return left.scopeExact ? -1 : 1;
  if (left.relevance !== right.relevance) return right.relevance - left.relevance;
  if (left.observedAt !== right.observedAt) return left.observedAt < right.observedAt ? 1 : -1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function selectContextCandidates(candidates: readonly ContextCandidate[]): ContextSelection {
  const excluded: ContextSelection["excluded"] = [];
  const selected: ContextCandidate[] = [];

  const bySection: Record<ContextSection, ContextCandidate[]> = {
    current: [],
    intent: [],
    observations: [],
    lessons: [],
  };
  for (const candidate of candidates.slice(0, candidates.length)) {
    bySection[candidate.section].push(candidate);
  }

  // A later intent for the same target replaces the earlier one: history
  // retains both, but the pack carries current intent only.
  const intentByTarget = new Map<string, ContextCandidate>();
  const intentRest: ContextCandidate[] = [];
  for (const candidate of bySection.intent) {
    if (!candidate.targetKey) {
      intentRest.push(candidate);
      continue;
    }
    const current = intentByTarget.get(candidate.targetKey);
    if (!current || compareCandidates(candidate, current) < 0) {
      if (current) excluded.push({ id: current.id, code: "SUPERSEDED" });
      intentByTarget.set(candidate.targetKey, candidate);
    } else {
      excluded.push({ id: candidate.id, code: "SUPERSEDED" });
    }
  }
  bySection.intent = [...intentRest, ...intentByTarget.values()];

  const keptRoots = new Set<string>();
  const keptSources = new Set<string>();

  const takeSection = (
    section: ContextSection,
    quota: number,
    aiCap: number,
  ): { taken: ContextCandidate[]; aiUsed: number } => {
    const pool = [...bySection[section]].sort(compareCandidates).slice(0, CONTEXT_SECTION_CANDIDATE_LIMIT);
    if (bySection[section].length > CONTEXT_SECTION_CANDIDATE_LIMIT) {
      for (const dropped of [...bySection[section]]
        .sort(compareCandidates)
        .slice(CONTEXT_SECTION_CANDIDATE_LIMIT)) {
        excluded.push({ id: dropped.id, code: "OVER_BUDGET" });
      }
    }
    const taken: ContextCandidate[] = [];
    let aiUsed = 0;
    for (const candidate of pool) {
      if (taken.length >= quota) {
        excluded.push({ id: candidate.id, code: "OVER_BUDGET" });
        continue;
      }
      if (keptSources.has(candidate.sourceKey)) {
        excluded.push({ id: candidate.id, code: "DUPLICATE_ROOT" });
        continue;
      }
      const uncoveredRoots = candidate.rootRefs.filter((root) => !keptRoots.has(root));
      if (candidate.rootRefs.length > 0 && uncoveredRoots.length === 0 && !candidate.contradicts) {
        excluded.push({ id: candidate.id, code: "DUPLICATE_ROOT" });
        continue;
      }
      if (candidate.aiGenerated && aiUsed >= aiCap) {
        excluded.push({ id: candidate.id, code: "OVER_BUDGET" });
        continue;
      }
      taken.push(candidate);
      keptSources.add(candidate.sourceKey);
      for (const root of candidate.rootRefs) keptRoots.add(root);
      if (candidate.aiGenerated) aiUsed += 1;
    }
    return { taken, aiUsed };
  };

  const currentQuota = CONTEXT_SECTION_BUDGETS.current;
  const intentQuota = CONTEXT_SECTION_BUDGETS.intent;
  const observationsQuota = CONTEXT_SECTION_BUDGETS.observations;
  const lessonsQuota = CONTEXT_SECTION_BUDGETS.lessons;

  const current = takeSection("current", currentQuota, Number.MAX_SAFE_INTEGER);
  const intent = takeSection("intent", intentQuota, Number.MAX_SAFE_INTEGER);
  const observations = takeSection("observations", observationsQuota, CONTEXT_OBSERVATIONS_AI_CAP);
  const lessons = takeSection("lessons", lessonsQuota, Number.MAX_SAFE_INTEGER);

  selected.push(...current.taken, ...intent.taken, ...observations.taken, ...lessons.taken);

  // Empty slots transfer to current state first, then to source-backed
  // observations. Transferred slots never raise the AI cap.
  const unused =
    currentQuota -
    current.taken.length +
    (intentQuota - intent.taken.length) +
    (observationsQuota - observations.taken.length) +
    (lessonsQuota - lessons.taken.length);
  if (unused > 0) {
    const takenIds = new Set(selected.map((candidate) => candidate.id));
    // Only quota overflow is rescuable: superseded intent and duplicate
    // roots stay excluded no matter how many slots are free.
    const rescuableIds = new Set(
      excluded.filter((entry) => entry.code === "OVER_BUDGET").map((entry) => entry.id),
    );
    const overflow: ContextCandidate[] = [];
    for (const section of ["current", "intent", "observations", "lessons"] as const) {
      for (const candidate of [...bySection[section]].sort(compareCandidates)) {
        if (!takenIds.has(candidate.id) && rescuableIds.has(candidate.id)) overflow.push(candidate);
      }
    }
    let remaining = unused;
    for (const candidate of overflow.sort(compareCandidates)) {
      if (remaining <= 0) break;
      const wantsCurrent = candidate.section === "current";
      const wantsObservation = candidate.section === "observations" && candidate.sourceBacked;
      if (!wantsCurrent && !wantsObservation) continue;
      if (candidate.aiGenerated) continue;
      if (keptSources.has(candidate.sourceKey)) continue;
      const uncoveredRoots = candidate.rootRefs.filter((root) => !keptRoots.has(root));
      if (candidate.rootRefs.length > 0 && uncoveredRoots.length === 0 && !candidate.contradicts)
        continue;
      selected.push(candidate);
      keptSources.add(candidate.sourceKey);
      for (const root of candidate.rootRefs) keptRoots.add(root);
      const exclusionIndex = excluded.findIndex((entry) => entry.id === candidate.id);
      if (exclusionIndex >= 0) excluded.splice(exclusionIndex, 1);
      remaining -= 1;
    }
  }

  selected.sort(compareCandidates);
  return { selected, excluded };
}
