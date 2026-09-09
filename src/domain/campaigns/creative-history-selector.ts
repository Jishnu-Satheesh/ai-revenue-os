import {
  CREATIVE_HISTORY_APPROVED_FINAL_LIMIT,
  CREATIVE_HISTORY_REJECTED_BLUEPRINT_LIMIT,
  CREATIVE_HISTORY_SELECTOR_VERSION,
  type CreativeHistoryMetadata,
} from "@/domain/campaigns/creative-history";
import { assetTagsMatch, type CreativeReviewReasonCode } from "@/domain/campaigns/asset-library";

export type CreativeHistorySelectionCandidate = {
  organizationId: string;
  itemId: string;
  versionId: string;
  verdict: "approved" | "rejected";
  reasonCodes: readonly CreativeReviewReasonCode[];
  metadata: CreativeHistoryMetadata;
  verifiedPerformanceScore: number | null;
  version: number;
};

export type CreativeHistorySelectionRequest = {
  organizationId: string;
  subjectTags: readonly string[];
  occasionTags: readonly string[];
  channel: string | null;
  format: string | null;
  market: string | null;
  language: string | null;
  objective: string | null;
  styleTags: readonly string[];
};

export type CreativeHistorySelection = {
  itemId: string;
  versionId: string;
  verdict: "approved" | "rejected";
  reasonCodes: readonly CreativeReviewReasonCode[];
  relevanceScore: number;
};

export type CreativeHistoryBlueprintReference =
  | (CreativeHistorySelection & { role: "approved_creative" })
  | (CreativeHistorySelection & { role: "rejected_creative" });

export type CreativeHistoryFinalImageReference = CreativeHistorySelection & {
  role: "approved_creative";
};

export type CreativeHistorySelectionReceipt = {
  selectorVersion: typeof CREATIVE_HISTORY_SELECTOR_VERSION;
  approved: readonly CreativeHistorySelection[];
  rejected: readonly CreativeHistorySelection[];
  blueprintReferences: readonly CreativeHistoryBlueprintReference[];
  finalImageReferences: readonly CreativeHistoryFinalImageReference[];
  exclusions: readonly { versionId: string; code: "foreign_organization" | "weak_match" }[];
};

function overlapCount(left: readonly string[], right: readonly string[]): number {
  return left.reduce(
    (count, value) => count + Number(right.some((other) => assetTagsMatch(value, other))),
    0,
  );
}

function matchesOptional(value: string | null, values: readonly string[]): boolean {
  return value === null || values.some((candidate) => assetTagsMatch(value, candidate));
}

function relevance(
  candidate: CreativeHistorySelectionCandidate,
  request: CreativeHistorySelectionRequest,
) {
  const metadata = candidate.metadata;
  const subjectMatches = overlapCount(metadata.subjectTags, request.subjectTags);
  if (subjectMatches === 0) return null;

  return (
    subjectMatches * 100 +
    overlapCount(metadata.occasionTags, request.occasionTags) * 15 +
    Number(matchesOptional(request.channel, metadata.channels)) * 10 +
    Number(matchesOptional(request.format, metadata.formats)) * 10 +
    Number(matchesOptional(request.market, metadata.markets)) * 8 +
    Number(matchesOptional(request.language, metadata.languages)) * 8 +
    Number(matchesOptional(request.objective, metadata.objectives)) * 8 +
    overlapCount(metadata.styleTags, request.styleTags) * 6
  );
}

function compareCandidates(
  left: CreativeHistorySelectionCandidate & { relevanceScore: number },
  right: CreativeHistorySelectionCandidate & { relevanceScore: number },
) {
  return (
    right.relevanceScore - left.relevanceScore ||
    (right.verifiedPerformanceScore ?? Number.NEGATIVE_INFINITY) -
      (left.verifiedPerformanceScore ?? Number.NEGATIVE_INFINITY) ||
    right.version - left.version ||
    left.versionId.localeCompare(right.versionId)
  );
}

function selected(
  candidate: CreativeHistorySelectionCandidate & { relevanceScore: number },
): CreativeHistorySelection {
  return {
    itemId: candidate.itemId,
    versionId: candidate.versionId,
    verdict: candidate.verdict,
    reasonCodes: candidate.reasonCodes,
    relevanceScore: candidate.relevanceScore,
  };
}

function selectRejected(
  candidates: readonly (CreativeHistorySelectionCandidate & { relevanceScore: number })[],
) {
  const selectedCandidates: (CreativeHistorySelectionCandidate & { relevanceScore: number })[] = [];
  const seenReasons = new Set<CreativeReviewReasonCode>();

  for (const candidate of candidates) {
    if (selectedCandidates.length === CREATIVE_HISTORY_REJECTED_BLUEPRINT_LIMIT) break;
    if (candidate.reasonCodes.some((reason) => !seenReasons.has(reason))) {
      selectedCandidates.push(candidate);
      candidate.reasonCodes.forEach((reason) => seenReasons.add(reason));
    }
  }

  for (const candidate of candidates) {
    if (selectedCandidates.length === CREATIVE_HISTORY_REJECTED_BLUEPRINT_LIMIT) break;
    if (!selectedCandidates.includes(candidate)) selectedCandidates.push(candidate);
  }

  return selectedCandidates.map(selected);
}

export function selectCreativeHistory(input: {
  request: CreativeHistorySelectionRequest;
  candidates: readonly CreativeHistorySelectionCandidate[];
}): CreativeHistorySelectionReceipt {
  const exclusions: { versionId: string; code: "foreign_organization" | "weak_match" }[] = [];
  const eligible: (CreativeHistorySelectionCandidate & { relevanceScore: number })[] = [];

  for (const candidate of input.candidates) {
    if (candidate.organizationId !== input.request.organizationId) {
      exclusions.push({ versionId: candidate.versionId, code: "foreign_organization" });
      continue;
    }
    const relevanceScore = relevance(candidate, input.request);
    if (relevanceScore === null) {
      exclusions.push({ versionId: candidate.versionId, code: "weak_match" });
      continue;
    }
    eligible.push({ ...candidate, relevanceScore });
  }

  const approved = eligible
    .filter((candidate) => candidate.verdict === "approved")
    .sort(compareCandidates)
    .slice(0, CREATIVE_HISTORY_APPROVED_FINAL_LIMIT)
    .map(selected);
  const rejected = selectRejected(
    eligible.filter((candidate) => candidate.verdict === "rejected").sort(compareCandidates),
  );

  return {
    selectorVersion: CREATIVE_HISTORY_SELECTOR_VERSION,
    approved,
    rejected,
    blueprintReferences: [
      ...approved.map((entry) => ({ ...entry, role: "approved_creative" as const })),
      ...rejected.map((entry) => ({ ...entry, role: "rejected_creative" as const })),
    ],
    finalImageReferences: approved.map((entry) => ({
      ...entry,
      role: "approved_creative" as const,
    })),
    exclusions,
  };
}
