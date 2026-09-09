import "server-only";

import { z } from "zod";

import {
  estimateResearchPromptTokens,
  researchModelBudgetSchema,
  researchSupportVerdictSchema,
  type ResearchModelPhase,
  type ResearchSupportVerdict,
} from "@/domain/growth-intelligence/research-budget";
import {
  approvedResearchScopeSchema,
  type ApprovedResearchScope,
} from "@/modules/growth-intelligence/infrastructure/research/ports";
import {
  extractableSourceSchema,
  type ExtractableSource,
  type ExtractedClaimCandidate,
  type ResearchModelSpender,
  type ResearchModelTransport,
  type ResearchModelUsage,
} from "@/modules/growth-intelligence/infrastructure/research/claim-extraction";

/**
 * Bounded support review over extracted claim candidates.
 *
 * Verdict semantics (a judgment, not deterministic proof of truth):
 * - supported: a cited span directly states the claim;
 * - uncertain: ambiguous competitor identity, conflicting dates, a stale or
 *   single-span basis, or an inconclusive review — visible limitations, never
 *   persisted as evidence;
 * - unsupported: contradicted or unrelated spans, invented references, bad
 *   offsets, or citations to ineligible (excluded, erased, unavailable)
 *   sources.
 *
 * Deterministic pre-checks run before any model call; the model judges only
 * what determinism cannot. Deterministic admission downstream persists
 * eligible supported candidates only.
 */

export const CLAIM_SUPPORT_REVIEW_PHASE: ResearchModelPhase = "support_review";

const safeCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,80}$/);

const reviewAnswerSchema = z
  .object({
    candidateKey: z.string(),
    verdict: researchSupportVerdictSchema,
    limitations: z.array(safeCodeSchema).max(20),
  })
  .strict();

export type ReviewedClaimSupport = {
  candidateKey: string;
  verdict: ResearchSupportVerdict;
  limitations: string[];
  reviewerRef: string;
  reviewedAt: string;
};

export type ClaimSupportReviewResult = {
  reviews: ReviewedClaimSupport[];
  supportedCount: number;
  unsupportedCount: number;
  uncertainCount: number;
  callsIssued: number;
  usages: ResearchModelUsage[];
  totalLatencyMs: number;
};

const SUPPORT_REVIEW_INSTRUCTIONS =
  "Judge whether each candidate claim below is directly stated by its cited spans. " +
  "Return a JSON array only, no prose. Each entry has candidateKey, verdict " +
  "(supported|unsupported|uncertain) and limitations (safe codes or []). " +
  "supported means a cited span directly states the claim. unsupported means the " +
  "span contradicts the claim, is unrelated, or the citation is invalid. uncertain " +
  "means the span is ambiguous about identity, dates or scope. Never invent verdicts.";

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function competitorNames(scope: ApprovedResearchScope): Set<string> {
  return new Set(scope.competitors.map((competitor) => normalize(competitor.name)));
}

function spanText(
  source: ExtractableSource,
  citation: { spanStart: number; spanEnd: number },
): string {
  return source.excerptText.slice(citation.spanStart, citation.spanEnd);
}

/**
 * Deterministic pre-checks. Returns a final review when determinism decides,
 * or null when the model must judge. Stale evidence stays reviewable: expiry
 * is a visible limitation, not a support refusal (persistence admits stale
 * claims explicitly, and synthesis decides reuse).
 */
function deterministicReview(input: {
  candidate: ExtractedClaimCandidate;
  sourcesByKey: ReadonlyMap<string, ExtractableSource>;
  eligibleSourceKeys: ReadonlySet<string>;
  scopeCompetitors: ReadonlySet<string>;
  reviewerRef: string;
  reviewedAt: string;
}): ReviewedClaimSupport | null {
  const { candidate } = input;
  for (const citation of candidate.citations) {
    const cited = input.sourcesByKey.get(citation.sourceKey);
    if (!cited) {
      return { ...base(input), verdict: "unsupported", limitations: ["CITATION_INVALID"] };
    }
    if (citation.spanStart >= citation.spanEnd || citation.spanEnd > cited.excerptText.length) {
      return { ...base(input), verdict: "unsupported", limitations: ["SPAN_MISMATCH"] };
    }
    if (citation.quotedText !== null && citation.quotedText !== spanText(cited, citation)) {
      return { ...base(input), verdict: "unsupported", limitations: ["SPAN_MISMATCH"] };
    }
    if (!input.eligibleSourceKeys.has(citation.sourceKey)) {
      return { ...base(input), verdict: "unsupported", limitations: ["SOURCE_INELIGIBLE"] };
    }
  }
  if (
    candidate.subjectKind === "competitor" &&
    !input.scopeCompetitors.has(normalize(candidate.subjectRef))
  ) {
    return { ...base(input), verdict: "uncertain", limitations: ["AMBIGUOUS_COMPETITOR_IDENTITY"] };
  }
  return null;

  function base(review: typeof input): Omit<ReviewedClaimSupport, "verdict" | "limitations"> {
    return {
      candidateKey: review.candidate.candidateKey,
      reviewerRef: review.reviewerRef,
      reviewedAt: review.reviewedAt,
    };
  }
}

function candidateDatesDiffer(
  left: ExtractedClaimCandidate,
  right: ExtractedClaimCandidate,
): boolean {
  return (
    ((left.observedAt !== null || right.observedAt !== null) &&
      left.observedAt !== right.observedAt) ||
    ((left.publishedAt !== null || right.publishedAt !== null) &&
      left.publishedAt !== right.publishedAt)
  );
}

/**
 * Caps conflicting date pairs at uncertain. Two supported candidates that
 * date the same subject differently cannot both persist as stated facts;
 * the conflict stays a visible limitation instead.
 */
function applyDateConflicts(
  candidates: readonly ExtractedClaimCandidate[],
  reviews: ReviewedClaimSupport[],
): void {
  const bySubject = new Map<string, number[]>();
  candidates.forEach((candidate, index) => {
    const key = `${candidate.subjectKind}|${normalize(candidate.subjectRef)}|${candidate.claimKind}`;
    const bucket = bySubject.get(key) ?? [];
    bucket.push(index);
    bySubject.set(key, bucket);
  });
  for (const bucket of bySubject.values()) {
    for (let left = 0; left < bucket.length; left += 1) {
      for (let right = left + 1; right < bucket.length; right += 1) {
        const first = candidates[bucket[left]!]!;
        const second = candidates[bucket[right]!]!;
        if (!candidateDatesDiffer(first, second)) continue;
        for (const index of [bucket[left]!, bucket[right]!]) {
          const review = reviews[index]!;
          if (review.verdict === "supported") {
            review.verdict = "uncertain";
            if (!review.limitations.includes("CONFLICTING_DATES")) {
              review.limitations.push("CONFLICTING_DATES");
            }
          } else if (!review.limitations.includes("CONFLICTING_DATES")) {
            review.limitations.push("CONFLICTING_DATES");
          }
        }
      }
    }
  }
}

function staleLimitation(input: {
  candidate: ExtractedClaimCandidate;
  nowMs: number;
}): string | null {
  // Demand/event staleness mirrors the persistence registry loosely: a claim
  // observed more than thirty days ago is labelled stale but still
  // reviewable. Exact expiry stays with the deterministic freshness window.
  if (input.candidate.observedAt === null) return null;
  const observedMs = new Date(input.candidate.observedAt).getTime();
  if (Number.isNaN(observedMs)) return null;
  return input.nowMs - observedMs > 30 * 86_400_000 ? "STALE_EVIDENCE" : null;
}

function buildReviewPrompt(
  candidates: ExtractedClaimCandidate[],
  sourcesByKey: ReadonlyMap<string, ExtractableSource>,
): string {
  return JSON.stringify({
    phase: CLAIM_SUPPORT_REVIEW_PHASE,
    instructions: SUPPORT_REVIEW_INSTRUCTIONS,
    candidates: candidates.map((candidate) => ({
      candidateKey: candidate.candidateKey,
      subjectKind: candidate.subjectKind,
      subjectRef: candidate.subjectRef,
      claimKind: candidate.claimKind,
      paraphrase: candidate.paraphrase,
      quotation: candidate.quotation,
      claimCategory: candidate.claimCategory,
      spans: candidate.citations.map((citation) => ({
        sourceKey: citation.sourceKey,
        text: spanText(sourcesByKey.get(citation.sourceKey)!, citation),
      })),
    })),
  });
}

export async function reviewResearchClaimSupport(input: {
  candidates: unknown;
  sources: unknown;
  scope: unknown;
  eligibleSourceKeys: unknown;
  budget: unknown;
  transport: ResearchModelTransport;
  spender: ResearchModelSpender;
  modelId: string;
  now?: () => Date;
  signal?: AbortSignal;
}): Promise<ClaimSupportReviewResult> {
  const scope = approvedResearchScopeSchema.parse(input.scope);
  const budget = researchModelBudgetSchema.parse(input.budget);
  if (budget.phase !== CLAIM_SUPPORT_REVIEW_PHASE) {
    throw new Error("Support review requires a support_review budget.");
  }
  const candidates = z.array(z.custom<ExtractedClaimCandidate>()).parse(input.candidates);
  const sources = z.array(extractableSourceSchema).parse(input.sources);
  const eligibleSourceKeys = new Set(z.array(z.string()).parse(input.eligibleSourceKeys));
  const reviewerRef = z.string().trim().min(1).max(160).parse(input.modelId);
  const now = input.now ?? (() => new Date());
  const nowMs = now().getTime();

  const result: ClaimSupportReviewResult = {
    reviews: [],
    supportedCount: 0,
    unsupportedCount: 0,
    uncertainCount: 0,
    callsIssued: 0,
    usages: [],
    totalLatencyMs: 0,
  };
  if (candidates.length === 0) return result;

  const sourcesByKey = new Map(sources.map((item) => [item.sourceKey, item] as const));
  const scopeCompetitors = competitorNames(scope);
  const pending: ExtractedClaimCandidate[] = [];

  for (const candidate of candidates) {
    const reviewedAt = now().toISOString();
    const decided = deterministicReview({
      candidate,
      sourcesByKey,
      eligibleSourceKeys,
      scopeCompetitors,
      reviewerRef,
      reviewedAt,
    });
    if (decided) {
      result.reviews.push(decided);
    } else {
      pending.push(candidate);
    }
  }

  const batchSize = 10;
  for (let offset = 0; offset < pending.length; offset += batchSize) {
    if (input.signal?.aborted) {
      for (const candidate of pending.slice(offset)) {
        result.reviews.push({
          candidateKey: candidate.candidateKey,
          verdict: "uncertain",
          limitations: ["REVIEW_INCONCLUSIVE"],
          reviewerRef,
          reviewedAt: now().toISOString(),
        });
      }
      break;
    }
    if (result.callsIssued >= budget.maxCalls) {
      for (const candidate of pending.slice(offset)) {
        result.reviews.push({
          candidateKey: candidate.candidateKey,
          verdict: "uncertain",
          limitations: ["REVIEW_INCONCLUSIVE"],
          reviewerRef,
          reviewedAt: now().toISOString(),
        });
      }
      break;
    }
    const batch = pending.slice(offset, offset + batchSize);
    const prompt = buildReviewPrompt(batch, sourcesByKey);
    if (estimateResearchPromptTokens(prompt) > budget.maxInputTokens) {
      for (const candidate of batch) {
        result.reviews.push({
          candidateKey: candidate.candidateKey,
          verdict: "uncertain",
          limitations: ["REVIEW_INCONCLUSIVE"],
          reviewerRef,
          reviewedAt: now().toISOString(),
        });
      }
      continue;
    }
    const slotKey = `support-review:batch-${offset / batchSize}`;
    let answers: z.infer<typeof reviewAnswerSchema>[] | null = null;
    let repairs = 0;
    while (answers === null && result.callsIssued < budget.maxCalls) {
      const isRepair = repairs > 0;
      let attemptId: string;
      try {
        attemptId = (
          await input.spender.reserve({
            phase: budget.phase,
            slotKey: isRepair ? `${slotKey}:repair` : slotKey,
            attemptIndex: result.callsIssued,
          })
        ).attemptId;
      } catch {
        break;
      }
      result.callsIssued += 1;
      let text: string;
      let usage: ResearchModelUsage;
      let latencyMs: number;
      try {
        const response = await input.transport.complete({
          phase: budget.phase,
          prompt,
          maxInputTokens: budget.maxInputTokens,
          maxOutputTokens: budget.maxOutputTokens,
          signal: input.signal,
        });
        text = response.text;
        usage = response.usage;
        latencyMs = response.latencyMs;
      } catch {
        try {
          await input.spender.settle({ attemptId, usage: { kind: "unknown" } });
        } catch {
          break;
        }
        result.usages.push({ kind: "unknown" });
        break;
      }
      result.usages.push(usage);
      result.totalLatencyMs += latencyMs;
      try {
        await input.spender.settle({ attemptId, usage });
      } catch {
        break;
      }
      let decoded: unknown = null;
      try {
        const trimmed = text.trim();
        decoded = JSON.parse(
          trimmed.startsWith("```")
            ? trimmed.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```\s*$/, "")
            : trimmed,
        );
      } catch {
        decoded = null;
      }
      const batchKeys = new Set(batch.map((candidate) => candidate.candidateKey));
      if (Array.isArray(decoded)) {
        const parsed: z.infer<typeof reviewAnswerSchema>[] = [];
        let valid = true;
        for (const entry of decoded) {
          const answer = reviewAnswerSchema.safeParse(entry);
          if (!answer.success || !batchKeys.has(answer.data.candidateKey)) {
            valid = false;
            break;
          }
          parsed.push(answer.data);
        }
        if (valid) answers = parsed;
      }
      if (answers === null) {
        repairs += 1;
        if (repairs > 1) break;
      }
    }
    const byKey = new Map((answers ?? []).map((answer) => [answer.candidateKey, answer] as const));
    for (const candidate of batch) {
      const answer = byKey.get(candidate.candidateKey);
      if (!answer) {
        result.reviews.push({
          candidateKey: candidate.candidateKey,
          verdict: "uncertain",
          limitations: ["REVIEW_INCONCLUSIVE"],
          reviewerRef,
          reviewedAt: now().toISOString(),
        });
        continue;
      }
      const limitations = [...new Set(answer.limitations)];
      const stale = staleLimitation({ candidate, nowMs });
      if (stale && !limitations.includes(stale)) limitations.push(stale);
      result.reviews.push({
        candidateKey: candidate.candidateKey,
        verdict: answer.verdict,
        limitations,
        reviewerRef,
        reviewedAt: now().toISOString(),
      });
    }
  }

  applyDateConflicts(candidates, result.reviews);
  for (const review of result.reviews) {
    if (review.verdict === "supported") result.supportedCount += 1;
    else if (review.verdict === "unsupported") result.unsupportedCount += 1;
    else result.uncertainCount += 1;
  }
  return result;
}

/**
 * Deterministic admission: only supported candidates whose every citation
 * still resolves to an eligible source survive. Eligibility is re-checked
 * here because erasure or exclusion can land between review and persistence;
 * the fenced RPCs and the link trigger check again.
 */
export function selectAdmissibleClaims(input: {
  candidates: readonly ExtractedClaimCandidate[];
  reviews: readonly ReviewedClaimSupport[];
  eligibleSourceKeys: readonly string[];
}): { admitted: ExtractedClaimCandidate[]; rejectedCount: number; uncertainCount: number } {
  const eligible = new Set(input.eligibleSourceKeys);
  const reviewsByKey = new Map(
    input.reviews.map((review) => [review.candidateKey, review] as const),
  );
  const admitted: ExtractedClaimCandidate[] = [];
  let rejectedCount = 0;
  let uncertainCount = 0;
  for (const candidate of input.candidates) {
    const review = reviewsByKey.get(candidate.candidateKey);
    if (!review || review.verdict !== "supported") {
      if (review?.verdict === "uncertain") uncertainCount += 1;
      else rejectedCount += 1;
      continue;
    }
    const citable = candidate.citations.every((citation) => eligible.has(citation.sourceKey));
    if (!citable) {
      rejectedCount += 1;
      continue;
    }
    admitted.push(candidate);
  }
  return { admitted, rejectedCount, uncertainCount };
}

/**
 * Corroboration edges between admitted claims: two claims about the same
 * subject from independent publishers corroborate. Same-publisher pairs do
 * not — one snippet repeated is not independent support. Contradictions
 * never persist here; conflicting candidates are capped at uncertain.
 */
export function buildCorroborationLinks(input: {
  admitted: readonly ExtractedClaimCandidate[];
  keyOf: (candidate: ExtractedClaimCandidate) => string;
  publishersOf: (candidate: ExtractedClaimCandidate) => readonly string[];
}): Array<{ fromClaimKey: string; toClaimKey: string; relation: "corroborates" }> {
  const links: Array<{ fromClaimKey: string; toClaimKey: string; relation: "corroborates" }> = [];
  const seen = new Set<string>();
  for (let left = 0; left < input.admitted.length; left += 1) {
    for (let right = left + 1; right < input.admitted.length; right += 1) {
      const first = input.admitted[left]!;
      const second = input.admitted[right]!;
      if (
        first.subjectKind !== second.subjectKind ||
        normalize(first.subjectRef) !== normalize(second.subjectRef) ||
        first.claimKind !== second.claimKind
      ) {
        continue;
      }
      const publishers = new Set(
        [...input.publishersOf(first), ...input.publishersOf(second)].map(normalize),
      );
      if (publishers.size < 2) continue;
      const fromClaimKey = input.keyOf(first);
      const toClaimKey = input.keyOf(second);
      const [from, to] =
        fromClaimKey < toClaimKey ? [fromClaimKey, toClaimKey] : [toClaimKey, fromClaimKey];
      const edge = `${from}|${to}`;
      if (seen.has(edge)) continue;
      seen.add(edge);
      links.push({ fromClaimKey: from, toClaimKey: to, relation: "corroborates" });
    }
  }
  return links;
}
