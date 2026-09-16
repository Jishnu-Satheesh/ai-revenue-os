export type QuestionTier =
  | "business_memory"
  | "gi_interacted"
  | "gi_untouched"
  | "org_details"
  | "goals"
  | "none";

export type RecommendationPick = {
  id: string;
  title: string;
  body: string;
  decision: "planned" | "acknowledged" | "dismissed" | "snoozed" | null;
  helpful: boolean | null;
  updatedAt: string;
};

export type MemoryEntry = {
  id: string;
  title: string | null;
  body: string | null;
};

export type TieredScope = {
  tier: QuestionTier;
  memory: readonly MemoryEntry[];
  picks: readonly RecommendationPick[];
  orgDetailCount: number;
  goalCount: number;
};

const MAX_PICKS = 6;

function rank(pick: RecommendationPick): number | null {
  if (pick.decision === "dismissed" || pick.decision === "snoozed") return null;
  if (pick.decision === "planned") return 0;
  if (pick.decision === "acknowledged") return 1;
  if (pick.helpful === true) return 2;
  if (pick.decision === null) return 3;
  return null;
}

function compareUpdatedAtDesc(a: RecommendationPick, b: RecommendationPick): number {
  const ta = Date.parse(a.updatedAt);
  const tb = Date.parse(b.updatedAt);
  if (Number.isNaN(ta) || Number.isNaN(tb)) {
    if (a.updatedAt === b.updatedAt) return 0;
    return a.updatedAt > b.updatedAt ? -1 : 1;
  }
  return tb - ta;
}

export function orderRecommendationPicks(picks: readonly RecommendationPick[]): RecommendationPick[] {
  const ranked: Array<{ pick: RecommendationPick; r: number }> = [];
  for (const pick of picks) {
    const r = rank(pick);
    if (r !== null) ranked.push({ pick, r });
  }
  ranked.sort((a, b) => {
    if (a.r !== b.r) return a.r - b.r;
    return compareUpdatedAtDesc(a.pick, b.pick);
  });
  return ranked.slice(0, MAX_PICKS).map((entry) => entry.pick);
}

function hasMemoryBody(memory: readonly MemoryEntry[]): boolean {
  return memory.some((entry) => entry.body !== null && entry.body.trim().length > 0);
}

function isInteracted(pick: RecommendationPick): boolean {
  return pick.decision === "planned" || pick.decision === "acknowledged" || pick.helpful === true;
}

function isUntouched(pick: RecommendationPick): boolean {
  return pick.decision === null && pick.helpful !== true;
}

export function selectTier(input: {
  memory: readonly MemoryEntry[];
  orderedPicks: readonly RecommendationPick[];
  orgDetailCount: number;
  goalCount: number;
}): TieredScope {
  const { memory, orderedPicks, orgDetailCount, goalCount } = input;
  let tier: QuestionTier = "none";
  if (hasMemoryBody(memory)) {
    tier = "business_memory";
  } else if (orderedPicks.some(isInteracted)) {
    tier = "gi_interacted";
  } else if (orderedPicks.some(isUntouched)) {
    tier = "gi_untouched";
  } else if (orgDetailCount > 0) {
    tier = "org_details";
  } else if (goalCount > 0) {
    tier = "goals";
  }
  return { tier, memory, picks: orderedPicks, orgDetailCount, goalCount };
}
