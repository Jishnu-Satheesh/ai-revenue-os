import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

import {
  estimateResearchPromptTokens,
  researchModelBudgetSchema,
  type ResearchModelBudget,
  type ResearchModelPhase,
} from "@/domain/growth-intelligence/research-budget";
import {
  approvedResearchScopeSchema,
  type ApprovedResearchScope,
} from "@/modules/growth-intelligence/infrastructure/research/ports";

/**
 * Bounded claim extraction over permitted excerpts.
 *
 * The model receives bounded permitted excerpts, citation IDs and approved
 * public scope through a no-tool completion seam (fixtures/mocks only while
 * paid Gemini stays unqualified — no live transport ships here). Excerpts
 * and operator text are untrusted input: every candidate is re-validated
 * against the exact stored spans before it leaves this module, so injected
 * instructions can never become claims. Neither this phase nor support
 * review assigns money, ranking or execution eligibility; deterministic
 * admission downstream decides what persists.
 */

export const CLAIM_EXTRACTION_PHASE: ResearchModelPhase = "extraction";

const keySchema = z.string().regex(/^[a-z][a-z0-9_.-]{0,79}$/);
const safeCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,80}$/);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const timestampSchema = z.string().datetime({ offset: true });

export const extractableSourceSchema = z
  .object({
    sourceKey: keySchema,
    sourceUrl: z.string().min(8).max(2_048),
    excerptText: z.string().min(1).max(2_000),
    excerptDigest: digestSchema,
    retrievedAt: timestampSchema,
  })
  .strict();

export type ExtractableSource = z.infer<typeof extractableSourceSchema>;

const citationProposalSchema = z
  .object({
    sourceKey: z.string(),
    spanStart: z.number().int().min(0),
    spanEnd: z.number().int().min(1),
    quotedText: z.string().max(500).nullable(),
  })
  .strict();

const candidateProposalSchema = z
  .object({
    candidateKey: keySchema,
    subjectKind: z.enum([
      "market",
      "competitor",
      "event",
      "regulation",
      "seasonality",
      "audience",
      "topic",
    ]),
    subjectRef: z.string().min(1).max(160),
    claimKind: z.string().regex(/^[a-z][a-z0-9_.-]{1,119}$/),
    paraphrase: z.string().min(1).max(1_000),
    quotation: z.string().max(500).nullable(),
    claimCategory: z.enum([
      "availability",
      "offer",
      "price",
      "event",
      "review_trend",
      "demand_trend",
      "regulation",
      "seasonality",
      "structural_context",
    ]),
    geographicLayer: z.enum(["trade_area", "city", "country"]),
    geographyRef: z.string().min(2).max(160),
    citations: z.array(citationProposalSchema).min(1).max(50),
    publishedAt: z.string().nullable(),
    observedAt: z.string().nullable(),
    limitations: z.array(safeCodeSchema).max(20),
  })
  .strict();

export type ClaimCitation = {
  sourceKey: string;
  spanStart: number;
  spanEnd: number;
  quotedText: string | null;
};

export type ExtractedClaimCandidate = {
  candidateKey: string;
  subjectKind: z.infer<typeof candidateProposalSchema>["subjectKind"];
  subjectRef: string;
  claimKind: string;
  paraphrase: string;
  quotation: string | null;
  claimCategory: z.infer<typeof candidateProposalSchema>["claimCategory"];
  geographicLayer: z.infer<typeof candidateProposalSchema>["geographicLayer"];
  geographyRef: string;
  citations: ClaimCitation[];
  sourceKeys: string[];
  publishedAt: string | null;
  observedAt: string | null;
  limitations: string[];
};

export type ResearchModelUsage =
  | { kind: "reported"; microsUsd: number }
  | { kind: "estimated"; microsUsd: number }
  | { kind: "unknown" };

export type ResearchModelTransport = {
  complete(input: {
    phase: ResearchModelPhase;
    prompt: string;
    maxInputTokens: number;
    maxOutputTokens: number;
    signal?: AbortSignal;
  }): Promise<{ text: string; usage: ResearchModelUsage; latencyMs: number }>;
};

export type ResearchModelSpender = {
  reserve(input: {
    phase: ResearchModelPhase;
    slotKey: string;
    attemptIndex: number;
  }): Promise<{ attemptId: string }>;
  settle(input: { attemptId: string; usage: ResearchModelUsage }): Promise<void>;
};

export type ClaimExtractionResult = {
  candidates: ExtractedClaimCandidate[];
  batchesProcessed: number;
  batchesFailed: number;
  unprocessedSourceCount: number;
  callsIssued: number;
  usages: ResearchModelUsage[];
  totalLatencyMs: number;
};

const EXTRACTION_INSTRUCTIONS =
  "Extract market claims supported by the excerpts below. " +
  "Return a JSON array only, no prose. Each entry has candidateKey, subjectKind " +
  "(market|competitor|event|regulation|seasonality|audience|topic), subjectRef, " +
  "claimKind, paraphrase (<=1000 chars), quotation (exact span text or null), " +
  "claimCategory, geographicLayer, geographyRef, citations " +
  "(sourceKey plus exact character offsets spanStart/spanEnd into that source excerpt), " +
  "publishedAt/observedAt (ISO or null) and limitations (safe codes or []). " +
  "Cite only the listed source keys. Never invent sources, offsets or dates.";

function buildExtractionPrompt(scope: ApprovedResearchScope, sources: ExtractableSource[]): string {
  return JSON.stringify({
    phase: CLAIM_EXTRACTION_PHASE,
    instructions: EXTRACTION_INSTRUCTIONS,
    scope: {
      publicBusinessName: scope.publicBusinessName,
      city: scope.city,
      countryCode: scope.countryCode,
      niches: scope.niches,
      topics: scope.topics,
      competitors: scope.competitors,
    },
    sources: sources.map((item) => ({
      sourceKey: item.sourceKey,
      sourceUrl: item.sourceUrl,
      excerptText: item.excerptText,
    })),
  });
}

function stripResponseFence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    const lines = trimmed.split("\n");
    const body = lines[0]!.replace(/^```[a-zA-Z]*\s*/, "");
    const rest = lines.slice(1);
    if (rest.length > 0 && rest[rest.length - 1]!.trim() === "```") rest.pop();
    return [body, ...rest].join("\n").trim();
  }
  return trimmed;
}

function parseTimestamp(value: string | null): number | null {
  if (value === null) return null;
  const instant = new Date(value).getTime();
  return Number.isNaN(instant) ? null : instant;
}

function validateCandidate(
  proposal: unknown,
  sourcesByKey: ReadonlyMap<string, ExtractableSource>,
  nowMs: number,
  seenKeys: Set<string>,
): ExtractedClaimCandidate | null {
  const parsed = candidateProposalSchema.safeParse(proposal);
  if (!parsed.success) return null;
  const item = parsed.data;
  if (seenKeys.has(item.candidateKey)) return null;
  const subjectRef = item.subjectRef.trim();
  const paraphrase = item.paraphrase.trim();
  const geographyRef = item.geographyRef.trim();
  if (subjectRef.length === 0 || paraphrase.length === 0 || geographyRef.length < 2) return null;

  const citations: ClaimCitation[] = [];
  for (const citation of item.citations) {
    const cited = sourcesByKey.get(citation.sourceKey);
    if (!cited) return null;
    if (citation.spanStart >= citation.spanEnd) return null;
    if (citation.spanEnd > cited.excerptText.length) return null;
    const slice = cited.excerptText.slice(citation.spanStart, citation.spanEnd);
    if (citation.quotedText !== null && citation.quotedText !== slice) return null;
    citations.push({
      sourceKey: citation.sourceKey,
      spanStart: citation.spanStart,
      spanEnd: citation.spanEnd,
      quotedText: citation.quotedText,
    });
  }

  const quotation = item.quotation === null ? null : item.quotation.trim();
  if (quotation !== null) {
    if (quotation.length === 0 || quotation.length > 500) return null;
    const quoted = citations.some((citation) => {
      const cited = sourcesByKey.get(citation.sourceKey)!;
      return cited.excerptText.slice(citation.spanStart, citation.spanEnd) === quotation;
    });
    if (!quoted) return null;
  }

  const publishedMs = item.publishedAt === null ? null : parseTimestamp(item.publishedAt);
  const observedMs = item.observedAt === null ? null : parseTimestamp(item.observedAt);
  if (
    (item.publishedAt !== null && publishedMs === null) ||
    (item.observedAt !== null && observedMs === null)
  ) {
    return null;
  }
  if (
    (publishedMs !== null && publishedMs > nowMs) ||
    (observedMs !== null && observedMs > nowMs)
  ) {
    return null;
  }
  if (observedMs !== null) {
    for (const citation of citations) {
      const retrievedMs = new Date(sourcesByKey.get(citation.sourceKey)!.retrievedAt).getTime();
      if (observedMs > retrievedMs) return null;
    }
  }

  seenKeys.add(item.candidateKey);
  return {
    candidateKey: item.candidateKey,
    subjectKind: item.subjectKind,
    subjectRef,
    claimKind: item.claimKind,
    paraphrase,
    quotation: quotation !== null && quotation.length === 0 ? null : quotation,
    claimCategory: item.claimCategory,
    geographicLayer: item.geographicLayer,
    geographyRef,
    citations,
    sourceKeys: [...new Set(citations.map((citation) => citation.sourceKey))].sort(),
    publishedAt: item.publishedAt,
    observedAt: item.observedAt,
    limitations: [...item.limitations],
  };
}

function packBatches(
  scope: ApprovedResearchScope,
  sources: ExtractableSource[],
  budget: ResearchModelBudget,
): ExtractableSource[][] {
  const scopeEstimate = estimateResearchPromptTokens(
    JSON.stringify({
      publicBusinessName: scope.publicBusinessName,
      city: scope.city,
      countryCode: scope.countryCode,
      niches: scope.niches,
      topics: scope.topics,
      competitors: scope.competitors,
    }),
  );
  const batches: ExtractableSource[][] = [];
  let current: ExtractableSource[] = [];
  let currentEstimate = scopeEstimate + estimateResearchPromptTokens(EXTRACTION_INSTRUCTIONS) + 64;
  for (const item of sources) {
    const itemEstimate =
      estimateResearchPromptTokens(item.sourceKey + item.sourceUrl + item.excerptText) + 16;
    if (
      current.length >= budget.maxSourcesPerBatch ||
      currentEstimate + itemEstimate > budget.maxInputTokens
    ) {
      if (current.length > 0) batches.push(current);
      current = [];
      currentEstimate = scopeEstimate + estimateResearchPromptTokens(EXTRACTION_INSTRUCTIONS) + 64;
    }
    if (currentEstimate + itemEstimate > budget.maxInputTokens) {
      batches.push([item]);
      current = [];
      currentEstimate = scopeEstimate + estimateResearchPromptTokens(EXTRACTION_INSTRUCTIONS) + 64;
      continue;
    }
    current.push(item);
    currentEstimate += itemEstimate;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Freshness windows mirror the database registry exactly: the persistence
 * RPC recomputes stale/expires from the same basis, so a drift here would
 * fail admission. Basis is the claim observation, else the earliest cited
 * retrieval. UTC day arithmetic matches timestamptz intervals day-for-day.
 */
const FRESHNESS_WINDOWS_MS: Record<
  ExtractedClaimCandidate["claimCategory"],
  { stale: number; expires: number }
> = {
  availability: { stale: 6 * 3_600_000, expires: 24 * 3_600_000 },
  offer: { stale: 3 * 86_400_000, expires: 7 * 86_400_000 },
  price: { stale: 3 * 86_400_000, expires: 7 * 86_400_000 },
  event: { stale: 7 * 86_400_000, expires: 14 * 86_400_000 },
  review_trend: { stale: 14 * 86_400_000, expires: 30 * 86_400_000 },
  demand_trend: { stale: 14 * 86_400_000, expires: 30 * 86_400_000 },
  regulation: { stale: 30 * 86_400_000, expires: 90 * 86_400_000 },
  seasonality: { stale: 180 * 86_400_000, expires: 400 * 86_400_000 },
  structural_context: { stale: 180 * 86_400_000, expires: 400 * 86_400_000 },
};

export function resolveClaimFreshnessWindow(input: {
  claimCategory: ExtractedClaimCandidate["claimCategory"];
  basisAt: string;
}): { staleAt: string; expiresAt: string } {
  const basisMs = new Date(input.basisAt).getTime();
  if (Number.isNaN(basisMs)) throw new Error("Claim freshness basis must be a valid timestamp.");
  const window = FRESHNESS_WINDOWS_MS[input.claimCategory];
  return {
    staleAt: new Date(basisMs + window.stale).toISOString(),
    expiresAt: new Date(basisMs + window.expires).toISOString(),
  };
}

export function resolveFreshnessClass(
  claimCategory: ExtractedClaimCandidate["claimCategory"],
): "fast" | "standard" | "structural" {
  if (claimCategory === "availability") return "fast";
  if (claimCategory === "seasonality" || claimCategory === "structural_context")
    return "structural";
  return "standard";
}

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Stable identity for a finalized claim: model text cannot set storage IDs. */
export function digestClaimCandidate(input: {
  subjectKind: string;
  subjectRef: string;
  claimKind: string;
  paraphrase: string;
  quotation: string | null;
  claimCategory: string;
  geographicLayer: string;
  geographyRef: string;
  sourceKeys: readonly string[];
}): string {
  return createHash("sha256")
    .update(
      canonicalize({
        subjectKind: input.subjectKind,
        subjectRef: input.subjectRef,
        claimKind: input.claimKind,
        paraphrase: input.paraphrase,
        quotation: input.quotation,
        claimCategory: input.claimCategory,
        geographicLayer: input.geographicLayer,
        geographyRef: input.geographyRef,
        sourceKeys: [...input.sourceKeys].sort(),
      }),
      "utf8",
    )
    .digest("hex");
}

export async function extractResearchClaims(input: {
  scope: unknown;
  sources: unknown;
  budget: unknown;
  transport: ResearchModelTransport;
  spender: ResearchModelSpender;
  modelId: string;
  now?: () => Date;
  signal?: AbortSignal;
}): Promise<ClaimExtractionResult> {
  const scope = approvedResearchScopeSchema.parse(input.scope);
  const budget = researchModelBudgetSchema.parse(input.budget);
  if (budget.phase !== CLAIM_EXTRACTION_PHASE)
    throw new Error("Extraction requires an extraction budget.");
  const sources = z.array(extractableSourceSchema).max(40).parse(input.sources);
  const now = input.now ?? (() => new Date());
  const nowMs = now().getTime();

  const result: ClaimExtractionResult = {
    candidates: [],
    batchesProcessed: 0,
    batchesFailed: 0,
    unprocessedSourceCount: sources.length,
    callsIssued: 0,
    usages: [],
    totalLatencyMs: 0,
  };
  if (sources.length === 0) {
    result.unprocessedSourceCount = 0;
    return result;
  }

  const sourcesByKey = new Map(sources.map((item) => [item.sourceKey, item] as const));
  const seenKeys = new Set<string>();
  const batches = packBatches(scope, sources, budget);
  let processed = 0;

  for (const [batchNumber, batch] of batches.entries()) {
    if (input.signal?.aborted) break;
    if (result.callsIssued >= budget.maxCalls) break;
    const prompt = buildExtractionPrompt(scope, batch);
    if (estimateResearchPromptTokens(prompt) > budget.maxInputTokens) {
      result.batchesFailed += 1;
      continue;
    }
    const slotKey = `extraction:batch-${batchNumber}`;
    let batchCandidates: ExtractedClaimCandidate[] | null = null;
    let repairs = 0;
    while (batchCandidates === null && result.callsIssued < budget.maxCalls) {
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
      let response: { text: string; usage: ResearchModelUsage; latencyMs: number };
      try {
        response = await input.transport.complete({
          phase: budget.phase,
          prompt,
          maxInputTokens: budget.maxInputTokens,
          maxOutputTokens: budget.maxOutputTokens,
          signal: input.signal,
        });
      } catch {
        // An ambiguous transport failure is never retried: it may already be
        // billable, so its reservation stays unknown and the batch fails.
        try {
          await input.spender.settle({ attemptId, usage: { kind: "unknown" } });
        } catch {
          return { ...result, unprocessedSourceCount: sources.length - processed };
        }
        result.usages.push({ kind: "unknown" });
        break;
      }
      result.usages.push(response.usage);
      result.totalLatencyMs += response.latencyMs;
      try {
        await input.spender.settle({ attemptId, usage: response.usage });
      } catch {
        return { ...result, unprocessedSourceCount: sources.length - processed };
      }
      let decoded: unknown = null;
      try {
        decoded = JSON.parse(stripResponseFence(response.text));
      } catch {
        decoded = null;
      }
      if (!Array.isArray(decoded)) {
        // One bounded repair for a malformed answer; anything else fails
        // the batch closed rather than spending the remaining budget.
        repairs += 1;
        if (repairs > 1) break;
        continue;
      }
      const validated: ExtractedClaimCandidate[] = [];
      const batchSeen = new Set<string>();
      for (const proposal of decoded) {
        const candidate = validateCandidate(proposal, sourcesByKey, nowMs, batchSeen);
        if (candidate && !seenKeys.has(candidate.candidateKey)) {
          seenKeys.add(candidate.candidateKey);
          validated.push(candidate);
        }
      }
      batchCandidates = validated;
    }
    if (batchCandidates === null) {
      result.batchesFailed += 1;
      continue;
    }
    result.candidates.push(...batchCandidates);
    result.batchesProcessed += 1;
    processed += batch.length;
  }

  result.unprocessedSourceCount = sources.length - processed;
  return result;
}
