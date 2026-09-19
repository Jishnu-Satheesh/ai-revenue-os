import type { CampaignProposalCardView } from "@/modules/campaigns/application/proposal-read-model";
import type { RecommendationCard } from "@/modules/growth-intelligence/application/read-model";

export type MergedGridItem =
  | { kind: "recommendation"; card: RecommendationCard }
  | { kind: "proposal"; card: CampaignProposalCardView };

const DAY_MS = 86_400_000;
const MAX_ITEMS = 6;

function daysSince(value: string, now: number): number | null {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((now - time) / DAY_MS));
}

function recencyBonus(generatedAt: string, now: number): number {
  const age = daysSince(generatedAt, now);
  if (age === null) return 0;
  if (age <= 14) return 5;
  if (age <= 28) return 4;
  if (age <= 45) return 3;
  if (age <= 60) return 2;
  if (age <= 90) return 1;
  return 0;
}

function recommendationScore(card: RecommendationCard, now: number): number {
  let score = 10;
  if (card.decision === null) score += 5;
  else score -= 4;
  if (card.pinned) score += 3;
  if ((card.citationFindingIds?.length ?? 0) > 0) score += 2;
  if (card.carriedOver) score -= 1;
  score += recencyBonus(card.generatedAt, now);
  return score;
}

function proposalScore(card: CampaignProposalCardView, now: number): number {
  switch (card.state) {
    case "ready_for_review":
      return (card.decidable ? 20 : 14) + recencyBonus(card.updatedAt, now);
    case "changes_requested":
      return 12 + recencyBonus(card.updatedAt, now);
    case "needs_input":
      return 8;
    case "researching":
      return 6;
    case "approved_for_preparation":
      return 4;
    case "snoozed":
      return 2;
    case "dismissed":
    case "cancelled":
    case "superseded":
      return 0;
  }
}

function itemTime(item: MergedGridItem): number {
  const raw = item.kind === "recommendation" ? item.card.generatedAt : item.card.updatedAt;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? time : 0;
}

/**
 * One scored grid for the overview: advice and campaign drafts ranked
 * together, newest winning ties, capped at six. Dismissed, cancelled and
 * superseded proposals never surface here; history keeps them.
 */
export function scoreMergedItems(
  recommendations: readonly RecommendationCard[],
  proposals: readonly CampaignProposalCardView[],
  now: Date = new Date(),
): MergedGridItem[] {
  const nowMs = now.getTime();
  const scored: { item: MergedGridItem; score: number }[] = [
    ...recommendations.map((card) => ({
      item: { kind: "recommendation", card } as MergedGridItem,
      score: recommendationScore(card, nowMs),
    })),
    ...proposals
      .filter(
        (card) =>
          card.state !== "dismissed" && card.state !== "cancelled" && card.state !== "superseded",
      )
      .map((card) => ({
        item: { kind: "proposal", card } as MergedGridItem,
        score: proposalScore(card, nowMs),
      })),
  ];
  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return itemTime(right.item) - itemTime(left.item);
  });
  return scored.slice(0, MAX_ITEMS).map((entry) => entry.item);
}
