import { createHash } from "node:crypto";

import { z } from "zod";

import type { EventPublisher } from "@/domain/events/types";
import type { MarketProfileDocumentV1 } from "@/domain/growth-intelligence/types";
import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import { createGrowthIntelligenceRequestFingerprint } from "@/domain/growth-intelligence/request-fingerprint";
import { DomainError } from "@/lib/errors";
import type { MarketEvidenceRepository } from "@/modules/growth-intelligence/infrastructure/evidence-repository";
import {
  buildCorroborationLinks,
  reviewResearchClaimSupport,
  selectAdmissibleClaims,
} from "@/modules/growth-intelligence/infrastructure/research/claim-support-review";
import {
  digestClaimCandidate,
  extractResearchClaims,
  resolveClaimFreshnessWindow,
  resolveFreshnessClass,
  type ExtractableSource,
  type ExtractedClaimCandidate,
  type ResearchModelSpender,
  type ResearchModelTransport,
  type ResearchModelUsage,
} from "@/modules/growth-intelligence/infrastructure/research/claim-extraction";
import type {
  ResearchAttemptUsage,
  ResearchCoverageEntry,
} from "@/domain/growth-intelligence/research-pipeline";
import {
  researchModelBudgetSchema,
  type ResearchModelBudget,
} from "@/domain/growth-intelligence/research-budget";
import type { ResearchQuery } from "@/modules/growth-intelligence/infrastructure/research/query-plan";
import {
  researchRetrievalResultSchema,
  type ResearchRequest,
  type ResearchRetrievedSource,
  type ResearchRetrievalResult,
} from "@/modules/growth-intelligence/infrastructure/research/ports";

/**
 * The market research worker.
 *
 * The same shape as the channel analysis worker, for the same reason: claim a
 * lease, reload every authority under it, compute deterministically, and hand
 * the result to fenced database functions that check every rule again. The
 * worker is not the authority on what may be recorded as evidence.
 *
 * Retrieval returns bounded permitted excerpts (never crawled pages);
 * extraction proposes strict claim candidates from those excerpts; a separate
 * bounded support review labels each candidate supported, unsupported or
 * uncertain; deterministic admission persists eligible supported candidates
 * only through the fenced evidence boundary. Neither model assigns money,
 * ranking or execution eligibility. No raw model or provider bodies and no
 * hidden reasoning ever reach logs or events — only identifiers and counts.
 */

export const marketResearchPayloadSchema = z
  .object({
    organizationId: z.string().uuid(),
    requestId: z.string().uuid(),
    correlationId: z.string().uuid(),
  })
  .strict();

export type MarketResearchPayload = z.infer<typeof marketResearchPayloadSchema>;

export type GrowthIntelligenceRequestView = {
  id: string;
  organizationId: string;
  branchId: string | null;
  channelId: string | null;
  kind: string;
  triggerReason: string;
  businessEvidenceDigest: string | null;
  marketProfileVersionId: string;
  sourcePolicyDigest: string;
  researchRuleVersion: string;
  localTimeBucket: string;
  correlationId: string;
};

export type ApprovedMarketProfileView = {
  versionId: string;
  digest: string;
  document: MarketProfileDocumentV1;
  sourcePolicyDigest: string;
  enabled: boolean;
};

export type MarketResearchAdapter = {
  readonly availability: { available: boolean; provider: string };
  searchAndFetch(input: ResearchRequest): Promise<ResearchRetrievalResult>;
};

export type MarketResearchModelPhase = {
  transport: ResearchModelTransport;
  spender: ResearchModelSpender;
  budget: ResearchModelBudget;
  modelId: string;
};

export type MarketResearchExcerptProvenance = {
  qualificationVersion: string;
  retainUntilFor: (retrievedAt: string) => string;
};

export type MarketResearchClaim = {
  claim(input: {
    organizationId: string;
    requestId: string;
    claimToken: string;
    leaseSeconds: number;
  }): Promise<{ outcome: string; replayed: boolean }>;
  complete(input: {
    organizationId: string;
    requestId: string;
    claimToken: string;
  }): Promise<{ outcome: string }>;
  fail(input: {
    organizationId: string;
    requestId: string;
    claimToken: string;
    safeFailureCode: string;
  }): Promise<{ outcome: string }>;
  load(input: {
    organizationId: string;
    requestId: string;
  }): Promise<GrowthIntelligenceRequestView | null>;
  enqueue(input: {
    organizationId: string;
    request: Record<string, string | null>;
  }): Promise<{ requestId: string; replayed: boolean }>;
};

export type MarketResearchProfiles = {
  readCurrent(input: { organizationId: string }): Promise<ApprovedMarketProfileView | null>;
};

export type MarketResearchCurrentSources = {
  load(input: { organizationId: string; profileVersionId: string }): Promise<readonly string[]>;
};

export type MarketResearchDependencies = {
  requests: MarketResearchClaim;
  profiles: MarketResearchProfiles;
  evidence: MarketEvidenceRepository;
  currentSources: MarketResearchCurrentSources;
  adapter: MarketResearchAdapter;
  extraction: MarketResearchModelPhase;
  supportReview: MarketResearchModelPhase;
  excerptProvenance: MarketResearchExcerptProvenance;
  planQueries: (request: ResearchRequest) => ResearchQuery[];
  buildScope: (document: MarketProfileDocumentV1) => ResearchRequest;
  events: EventPublisher;
  now?: () => Date;
  newClaimToken?: () => string;
  signal?: AbortSignal;
};

export type MarketResearchResult =
  | {
      outcome: "completed" | "partial";
      runId: string;
      claimCount: number;
      sourceAttemptCount: number;
      sourceSuccessCount: number;
      supportedCount: number;
      unsupportedCount: number;
      uncertainCount: number;
      unknownUsageCount: number;
      reassessmentEnqueued: boolean;
    }
  | { outcome: "failed"; code: string; runId: string | null }
  | { outcome: "not_acquired"; claimOutcome: string }
  | { outcome: "claim_lost" }
  | { outcome: "cancelled" };

const RESEARCH_LEASE_SECONDS = 600;
const RESEARCH_RULE_VERSION = "market-research@1";
const RESEARCH_MODEL_PROVIDER = "gemini";
const MAX_RECORDED_SOURCES = 50;

// business_evidence_changed has no synthesis consumer until Increment 2, so a
// fresh market read is the honest handling; Task 14 may narrow this set.
const RESEARCH_KINDS = new Set([
  "market_research",
  "evidence_reassessment",
  "business_evidence_changed",
]);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
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

/**
 * Honest spend ledger for one worker attempt. Known usage (reported or
 * estimated) accumulates at face value and is never clamped; unknown usage
 * stays counted, never converts to zero. Malformed model usage is treated
 * as unknown — the reserved-liability direction — rather than trusted.
 */
export type MarketResearchSpendLedger = {
  knownMicrosUsd: number;
  unknownCount: number;
  latencyMs: number;
};

export function createMarketResearchSpendLedger(): MarketResearchSpendLedger {
  return { knownMicrosUsd: 0, unknownCount: 0, latencyMs: 0 };
}

export function recordMarketResearchUsage(
  ledger: MarketResearchSpendLedger,
  usage: ResearchAttemptUsage | ResearchModelUsage,
): void {
  if (usage.kind === "unknown") {
    ledger.unknownCount += 1;
    return;
  }
  if (
    typeof usage.microsUsd !== "number" ||
    !Number.isInteger(usage.microsUsd) ||
    usage.microsUsd < 0
  ) {
    ledger.unknownCount += 1;
    return;
  }
  ledger.knownMicrosUsd += usage.microsUsd;
}

export function recordMarketResearchLatency(
  ledger: MarketResearchSpendLedger,
  latencyMs: number,
): void {
  if (typeof latencyMs === "number" && Number.isInteger(latencyMs) && latencyMs >= 0) {
    ledger.latencyMs += latencyMs;
  }
}

/**
 * Deterministic retrieval grading at the research layer: keep only sources
 * whose excerpt digest is not already current. Snippet-only retrieval has no
 * page content digest, so the retained excerpt digest is the content
 * identity — and the same value is stored as the source content digest, so
 * the current-source loader keeps deduplicating across runs.
 */
export function selectMaterialSources(
  sources: readonly ResearchRetrievedSource[],
  currentDigests: readonly string[],
): ResearchRetrievedSource[] {
  const current = new Set(currentDigests);
  return sources.filter((source) => !current.has(source.excerptDigest));
}

function publishEvent(
  events: EventPublisher,
  input: {
    organizationId: string;
    eventName:
      | "market_research.completed"
      | "market_research.partially_completed"
      | "market_research.failed";
    correlationId: string;
    occurredAt: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  return events.publish({
    organizationId: input.organizationId,
    eventId: crypto.randomUUID(),
    eventName: input.eventName,
    occurredAt: input.occurredAt,
    actorType: "system",
    correlationId: input.correlationId,
    schemaVersion: 1,
    payload: input.payload,
  });
}

function toMillisIso(value: string): string {
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms))
    throw new DomainError("DOMAIN_ERROR", "Research evidence carries an invalid timestamp.");
  return new Date(ms).toISOString();
}

function isClaimLost(error: unknown): boolean {
  return error instanceof GrowthIntelligenceError && error.code === "RESEARCH_CLAIM_LOST";
}

export async function runMarketResearch(
  input: unknown,
  dependencies: MarketResearchDependencies,
): Promise<MarketResearchResult> {
  const payload = marketResearchPayloadSchema.parse(input);
  const now = dependencies.now ?? (() => new Date());
  const newClaimToken = dependencies.newClaimToken ?? (() => crypto.randomUUID());
  const adapter = dependencies.adapter;
  const ledger = createMarketResearchSpendLedger();

  if (dependencies.signal?.aborted) return { outcome: "cancelled" };

  const claimToken = newClaimToken();
  const claim = await dependencies.requests.claim({
    organizationId: payload.organizationId,
    requestId: payload.requestId,
    claimToken,
    leaseSeconds: RESEARCH_LEASE_SECONDS,
  });
  if (claim.outcome !== "acquired") {
    return { outcome: "not_acquired", claimOutcome: claim.outcome };
  }

  const failRequest = async (code: string): Promise<MarketResearchResult> => {
    await dependencies.requests.fail({
      organizationId: payload.organizationId,
      requestId: payload.requestId,
      claimToken,
      safeFailureCode: code,
    });
    await publishEvent(dependencies.events, {
      organizationId: payload.organizationId,
      eventName: "market_research.failed",
      correlationId: payload.correlationId,
      occurredAt: now().toISOString(),
      payload: {
        requestId: payload.requestId,
        runId: null,
        code,
        unknownUsageCount: ledger.unknownCount,
      },
    });
    return { outcome: "failed", code, runId: null };
  };

  const [request, profile] = await Promise.all([
    dependencies.requests.load({
      organizationId: payload.organizationId,
      requestId: payload.requestId,
    }),
    dependencies.profiles.readCurrent({ organizationId: payload.organizationId }),
  ]);

  if (!request) return failRequest("REQUEST_CONTEXT_UNAVAILABLE");
  if (!profile || !profile.enabled) {
    return failRequest(!profile ? "PROFILE_UNAVAILABLE" : "PROFILE_DISABLED");
  }
  if (
    profile.versionId !== request.marketProfileVersionId ||
    profile.sourcePolicyDigest !== request.sourcePolicyDigest
  ) {
    return failRequest("PROFILE_VERSION_CHANGED");
  }
  if (!RESEARCH_KINDS.has(request.kind)) return failRequest("REQUEST_KIND_UNSUPPORTED");

  // The model phases must be wired before any run begins: without bounded
  // extraction and support review there are no cited claims to persist, and
  // starting a runrow first would only record a more confusing failure.
  // (The Trigger composition wires these in Task 8; until then a run that
  // reaches this point fails closed here instead of inventing claims.)
  const extractionBudget = researchModelBudgetSchema.safeParse(dependencies.extraction?.budget);
  const reviewBudget = researchModelBudgetSchema.safeParse(dependencies.supportReview?.budget);
  if (
    !dependencies.extraction ||
    !dependencies.supportReview ||
    !dependencies.excerptProvenance ||
    typeof dependencies.excerptProvenance.retainUntilFor !== "function" ||
    typeof dependencies.excerptProvenance.qualificationVersion !== "string" ||
    dependencies.excerptProvenance.qualificationVersion.trim().length === 0 ||
    !extractionBudget.success ||
    extractionBudget.data.phase !== "extraction" ||
    !reviewBudget.success ||
    reviewBudget.data.phase !== "support_review" ||
    typeof dependencies.extraction.modelId !== "string" ||
    typeof dependencies.supportReview.modelId !== "string"
  ) {
    return failRequest("EXTRACTION_UNAVAILABLE");
  }

  let research: ResearchRequest;
  let queries: ResearchQuery[];
  try {
    research = dependencies.buildScope(profile.document);
    queries = dependencies.planQueries(research);
  } catch {
    return failRequest("PROFILE_CONTEXT_INVALID");
  }

  const queryPlanDigest = sha256(canonicalize(queries));
  // The review model authors the support verdicts the links persist, so the
  // run carries its identity; the extraction model travels in events.
  const runMetadata = {
    adapterProvider: adapter.availability.provider,
    adapterVersion: RESEARCH_RULE_VERSION,
    modelProvider: RESEARCH_MODEL_PROVIDER,
    modelVersion: dependencies.supportReview.modelId,
    runFingerprint: sha256(
      canonicalize({
        requestId: payload.requestId,
        claimToken,
        profileVersionId: profile.versionId,
        queryPlanDigest,
      }),
    ),
    queryPlanDigest,
    correlationId: payload.correlationId,
  };

  const begun = await dependencies.evidence.begin({
    organizationId: payload.organizationId,
    requestId: payload.requestId,
    claimToken,
    metadata: runMetadata,
  });

  const failRun = async (code: string): Promise<MarketResearchResult> => {
    await dependencies.evidence.fail({
      organizationId: payload.organizationId,
      requestId: payload.requestId,
      claimToken,
      runId: begun.runId,
      failure: {
        safeFailureCode: code,
        adapterCostMicrosUsd: ledger.knownMicrosUsd,
        adapterLatencyMs: ledger.latencyMs,
      },
    });
    // The run failure already fences the request through the same claim token,
    // so this second call replays that outcome rather than duplicating it.
    await dependencies.requests.fail({
      organizationId: payload.organizationId,
      requestId: payload.requestId,
      claimToken,
      safeFailureCode: code,
    });
    await publishEvent(dependencies.events, {
      organizationId: payload.organizationId,
      eventName: "market_research.failed",
      correlationId: payload.correlationId,
      occurredAt: now().toISOString(),
      payload: {
        requestId: payload.requestId,
        runId: begun.runId,
        code,
        unknownUsageCount: ledger.unknownCount,
      },
    });
    return { outcome: "failed", code, runId: begun.runId };
  };

  if (!adapter.availability.available) return failRun("ADAPTER_UNAVAILABLE");
  if (dependencies.signal?.aborted) return failRun("WORKER_CANCELLED");

  // The retrieval runs outside the claim transaction: the claim RPC returned
  // long before this await, so a slow provider holds no database lock.
  let retrieval: ResearchRetrievalResult;
  try {
    retrieval = researchRetrievalResultSchema.parse(await adapter.searchAndFetch(research));
  } catch (error) {
    if (error instanceof DomainError && error.code === "FEATURE_NOT_AVAILABLE") {
      return failRun("ADAPTER_UNAVAILABLE");
    }
    if (error instanceof z.ZodError) return failRun("EVIDENCE_RECORD_INVALID");
    throw error;
  }
  if (dependencies.signal?.aborted) return failRun("WORKER_CANCELLED");
  for (const attempt of retrieval.attempts) recordMarketResearchUsage(ledger, attempt.usage);

  const currentDigests = await dependencies.currentSources.load({
    organizationId: payload.organizationId,
    profileVersionId: profile.versionId,
  });
  const material = selectMaterialSources(retrieval.sources, currentDigests);

  // Sources the confirmed policy excludes can never be recorded — the
  // persistence RPC refuses the whole payload — so they stop here, counted
  // as partial coverage rather than failing the run.
  const excludedDomains = new Set(
    profile.document.sourcePolicy.excludedDomains.map((domain) => domain.toLowerCase()),
  );
  const excludedPublishers = new Set(
    profile.document.sourcePolicy.excludedPublishers.map((publisher) => publisher.toLowerCase()),
  );
  // The SQL fence compares exclusions against the citation hostname, so the
  // worker pre-filter uses the same identity: an excluded host stops here,
  // counted as partial coverage, instead of refusing the whole payload.
  const recordable = material.filter((item) => {
    const hostname = new URL(item.sourceUrl).hostname.toLowerCase();
    if (excludedDomains.has(hostname)) return false;
    const publisher = item.publisher?.trim().toLowerCase();
    if (publisher && excludedPublishers.has(publisher)) return false;
    return true;
  });
  const excludedSourceCount = material.length - recordable.length;

  const provenance = dependencies.excerptProvenance;
  const extractable: ExtractableSource[] = recordable
    .slice(0, MAX_RECORDED_SOURCES)
    .map((item, index) => ({
      sourceKey: `src-${index}-${item.excerptDigest.slice(0, 12)}`,
      sourceUrl: item.sourceUrl,
      excerptText: item.excerptText,
      excerptDigest: item.excerptDigest,
      retrievedAt: item.retrievedAt,
    }));

  const extraction = await extractResearchClaims({
    scope: research.scope,
    sources: extractable,
    budget: extractionBudget.data,
    transport: dependencies.extraction.transport,
    spender: dependencies.extraction.spender,
    modelId: dependencies.extraction.modelId,
    now,
    signal: dependencies.signal,
  });
  for (const usage of extraction.usages) recordMarketResearchUsage(ledger, usage);
  recordMarketResearchLatency(ledger, extraction.totalLatencyMs);

  const eligibleSourceKeys = extractable.map((item) => item.sourceKey);
  const review = await reviewResearchClaimSupport({
    candidates: extraction.candidates,
    sources: extractable,
    scope: research.scope,
    eligibleSourceKeys,
    budget: reviewBudget.data,
    transport: dependencies.supportReview.transport,
    spender: dependencies.supportReview.spender,
    modelId: dependencies.supportReview.modelId,
    now,
    signal: dependencies.signal,
  });
  for (const usage of review.usages) recordMarketResearchUsage(ledger, usage);
  recordMarketResearchLatency(ledger, review.totalLatencyMs);

  const admission = selectAdmissibleClaims({
    candidates: extraction.candidates,
    reviews: review.reviews,
    eligibleSourceKeys,
  });

  const allowQuotes = profile.document.sourcePolicy.allowBoundedQuotes === true;
  const quoteLimit = allowQuotes ? profile.document.sourcePolicy.maxQuotationCharacters : 0;
  const sourceByKey = new Map(extractable.map((item) => [item.sourceKey, item] as const));
  const publisherBySourceKey = new Map(
    extractable.map((item) => {
      const retrieved = recordable.find((entry) => entry.excerptDigest === item.excerptDigest);
      return [
        item.sourceKey,
        retrieved?.publisher?.trim() || new URL(item.sourceUrl).hostname.toLowerCase(),
      ] as const;
    }),
  );

  type FinalizedClaim = {
    candidate: ExtractedClaimCandidate;
    quotation: string | null;
    staleAt: string;
    expiresAt: string;
  };
  const finalized: FinalizedClaim[] = admission.admitted.map((candidate) => {
    const observedAt = candidate.observedAt === null ? null : toMillisIso(candidate.observedAt);
    const publishedAt = candidate.publishedAt === null ? null : toMillisIso(candidate.publishedAt);
    const basisAt =
      observedAt ??
      candidate.citations
        .map((citation) => sourceByKey.get(citation.sourceKey)!.retrievedAt)
        .sort()[0]!;
    const window = resolveClaimFreshnessWindow({ claimCategory: candidate.claimCategory, basisAt });
    const limitations = [...candidate.limitations, "SNIPPET_EVIDENCE_ONLY"];
    if (candidate.sourceKeys.length === 1) limitations.push("ONE_SOURCE");
    return {
      candidate: {
        ...candidate,
        observedAt,
        publishedAt,
        limitations: [...new Set(limitations)].slice(0, 20),
      },
      quotation: candidate.quotation,
      staleAt: window.staleAt,
      expiresAt: window.expiresAt,
    };
  });

  // Quotation policy is enforced deterministically after review: claims keep
  // their quotations while the per-source aggregate fits, in paraphrase
  // order; the rest persist without quotations rather than failing admission.
  const sortedFinalized = [...finalized].sort((left, right) =>
    left.candidate.paraphrase < right.candidate.paraphrase ? -1 : 1,
  );
  const quoteTotals = new Map<string, number>();
  const keptQuotations: Array<string | null> = sortedFinalized.map((item) => {
    let quotation = item.quotation;
    if (quotation === null || quoteLimit <= 0) return null;
    for (const sourceKey of item.candidate.sourceKeys) {
      if ((quoteTotals.get(sourceKey) ?? 0) + quotation.length > quoteLimit) return null;
    }
    for (const sourceKey of item.candidate.sourceKeys) {
      quoteTotals.set(sourceKey, (quoteTotals.get(sourceKey) ?? 0) + quotation.length);
    }
    return quotation;
  });

  const claims = sortedFinalized.map((item, index) => {
    const quotation = keptQuotations[index] ?? null;
    const digest = digestClaimCandidate({
      subjectKind: item.candidate.subjectKind,
      subjectRef: item.candidate.subjectRef,
      claimKind: item.candidate.claimKind,
      paraphrase: item.candidate.paraphrase,
      quotation,
      claimCategory: item.candidate.claimCategory,
      geographicLayer: item.candidate.geographicLayer,
      geographyRef: item.candidate.geographyRef,
      sourceKeys: item.candidate.sourceKeys,
    });
    return {
      key: `clm-${digest.slice(0, 12)}`,
      claimDigest: digest,
      subjectKind: item.candidate.subjectKind,
      subjectRef: item.candidate.subjectRef,
      claimKind: item.candidate.claimKind,
      paraphrase: item.candidate.paraphrase,
      quotation,
      geographicLayer: item.candidate.geographicLayer,
      geographyRef: item.candidate.geographyRef,
      sourceKeys: item.candidate.sourceKeys,
      freshnessClass: resolveFreshnessClass(item.candidate.claimCategory),
      claimCategory: item.candidate.claimCategory,
      freshnessRegistryVersion: 1 as const,
      publishedAt: item.candidate.publishedAt,
      observedAt:
        item.candidate.observedAt ??
        item.candidate.citations
          .map((citation) => sourceByKey.get(citation.sourceKey)!.retrievedAt)
          .sort()[0]!,
      staleAt: item.staleAt,
      expiresAt: item.expiresAt,
      limitations: item.candidate.limitations,
    };
  });
  const claimKeyByCandidate = new Map(
    sortedFinalized.map(
      (item, index) => [item.candidate.candidateKey, claims[index]!.key] as const,
    ),
  );

  const links = buildCorroborationLinks({
    admitted: admission.admitted,
    keyOf: (candidate) => claimKeyByCandidate.get(candidate.candidateKey)!,
    publishersOf: (candidate) =>
      candidate.sourceKeys.map((sourceKey) => publisherBySourceKey.get(sourceKey)!),
  });

  const retainedPublisherByDigest = new Map(
    recordable.map((item) => [item.excerptDigest, item.publisher ?? null] as const),
  );
  const retainedClassByDigest = new Map(
    recordable.map((item) => [item.excerptDigest, item.sourceClass ?? null] as const),
  );
  const sources = extractable.map((item) => ({
    key: item.sourceKey,
    url: item.sourceUrl,
    domain: new URL(item.sourceUrl).hostname.toLowerCase(),
    publisher: retainedPublisherByDigest.get(item.excerptDigest) ?? null,
    sourceClass: (retainedClassByDigest.get(item.excerptDigest) ?? "public_signal") as
      | "official"
      | "first_party"
      | "industry_research"
      | "public_signal",
    availability: "available" as const,
    contentDigest: item.excerptDigest,
    safeFailureCode: null,
    retrievedAt: item.retrievedAt,
    publishedAt: null,
    observedAt: null,
    excerptText: item.excerptText,
    excerptDigest: item.excerptDigest,
    qualificationVersion: provenance.qualificationVersion,
    retainUntil: provenance.retainUntilFor(item.retrievedAt),
  }));

  // Coverage the completion transaction will read: retrieval outcomes plus
  // the extraction verdict counts that decide eligibility downstream.
  const coverage: ResearchCoverageEntry[] = retrieval.coverage;
  const retrievalIncomplete = coverage.some((entry) => entry.outcome !== "supported");
  const runOutcome =
    retrievalIncomplete || extraction.unprocessedSourceCount > 0 || excludedSourceCount > 0
      ? "partial"
      : "completed";

  if (sources.length > 0) {
    try {
      await dependencies.evidence.record({
        organizationId: payload.organizationId,
        requestId: payload.requestId,
        claimToken,
        runId: begun.runId,
        payload: { sources, claims, links },
      });
    } catch (error) {
      // Lease loss (expiry or same-branch supersession, which cancels the
      // claimed request) ends the run without further mutations: no
      // completion, no request write, no reassessment.
      if (isClaimLost(error)) return { outcome: "claim_lost" };
      throw error;
    }
  }

  const sourceAttemptCount = sources.length;
  const sourceSuccessCount = sources.filter((item) => item.availability === "available").length;
  const resultDigest = sha256(
    canonicalize({
      runFingerprint: runMetadata.runFingerprint,
      sourceAttemptCount,
      sourceSuccessCount,
      claimCount: claims.length,
      supportedCount: review.supportedCount,
      unsupportedCount: review.unsupportedCount,
      uncertainCount: review.uncertainCount,
      unprocessedSourceCount: extraction.unprocessedSourceCount,
      excludedSourceCount,
    }),
  );

  try {
    await dependencies.evidence.complete({
      organizationId: payload.organizationId,
      requestId: payload.requestId,
      claimToken,
      runId: begun.runId,
      result: {
        outcome: runOutcome,
        resultDigest,
        sourceAttemptCount,
        sourceSuccessCount,
        adapterCostMicrosUsd: ledger.knownMicrosUsd,
        adapterLatencyMs: ledger.latencyMs,
      },
    });
  } catch (error) {
    if (isClaimLost(error)) return { outcome: "claim_lost" };
    if (error instanceof DomainError || error instanceof GrowthIntelligenceError) {
      const fallback = await dependencies.requests.fail({
        organizationId: payload.organizationId,
        requestId: payload.requestId,
        claimToken,
        safeFailureCode: "RESEARCH_PROCESSING_FAILED",
      });
      if (fallback.outcome === "claim_lost") return { outcome: "claim_lost" };
      return { outcome: "failed", code: "RESEARCH_PROCESSING_FAILED", runId: begun.runId };
    }
    throw error;
  }

  const completion = await dependencies.requests.complete({
    organizationId: payload.organizationId,
    requestId: payload.requestId,
    claimToken,
  });
  if (completion.outcome !== "completed") return { outcome: "claim_lost" };

  const eventName =
    runOutcome === "partial" ? "market_research.partially_completed" : "market_research.completed";
  await publishEvent(dependencies.events, {
    organizationId: payload.organizationId,
    eventName,
    correlationId: payload.correlationId,
    occurredAt: now().toISOString(),
    payload: {
      requestId: payload.requestId,
      runId: begun.runId,
      claimCount: claims.length,
      sourceAttemptCount,
      sourceSuccessCount,
      supportedCount: review.supportedCount,
      unsupportedCount: review.unsupportedCount,
      uncertainCount: review.uncertainCount,
      unprocessedSourceCount: extraction.unprocessedSourceCount,
      excludedSourceCount,
      unknownUsageCount: ledger.unknownCount,
      extractionModel: dependencies.extraction.modelId,
      reviewModel: dependencies.supportReview.modelId,
    },
  });

  // Newly inferred source-rule changes become a reassessment request only.
  // The worker never alters active research; an operator-confirmed profile
  // revision is the only path that changes what research runs.
  const excluded = new Set(
    profile.document.sourcePolicy.excludedDomains.map((domain) => domain.toLowerCase()),
  );
  const approved = new Set(
    profile.document.publicIdentity.domains.map((domain) => domain.toLowerCase()),
  );
  const novelDomain = sources.some(
    (item) => !excluded.has(item.domain.toLowerCase()) && !approved.has(item.domain.toLowerCase()),
  );
  let reassessmentEnqueued = false;
  if (novelDomain) {
    try {
      const fingerprint = createGrowthIntelligenceRequestFingerprint({
        organizationId: payload.organizationId,
        branchId: request.branchId,
        channelId: request.channelId,
        kind: "evidence_reassessment",
        triggerReason: "source_changed",
        businessEvidenceDigest: request.businessEvidenceDigest,
        marketProfileVersionId: profile.versionId,
        sourcePolicyDigest: profile.sourcePolicyDigest,
        researchRuleVersion: RESEARCH_RULE_VERSION,
        localTimeBucket: "immediate",
        synthesisVersionTuple: null,
        playbookVersionTuple: null,
      });
      await dependencies.requests.enqueue({
        organizationId: payload.organizationId,
        request: {
          organizationId: payload.organizationId,
          branchId: request.branchId,
          channelId: request.channelId,
          kind: "evidence_reassessment",
          triggerReason: "source_changed",
          businessEvidenceDigest: request.businessEvidenceDigest,
          marketProfileVersionId: profile.versionId,
          sourcePolicyDigest: profile.sourcePolicyDigest,
          researchRuleVersion: RESEARCH_RULE_VERSION,
          localTimeBucket: "immediate",
          synthesisVersionTuple: null,
          playbookVersionTuple: null,
          requestFingerprint: fingerprint,
          dueAt: now().toISOString(),
          correlationId: payload.correlationId,
          requestedBy: null,
        },
      });
      reassessmentEnqueued = true;
    } catch {
      reassessmentEnqueued = false;
    }
  }

  return {
    outcome: runOutcome,
    runId: begun.runId,
    claimCount: claims.length,
    sourceAttemptCount,
    sourceSuccessCount,
    supportedCount: review.supportedCount,
    unsupportedCount: review.unsupportedCount,
    uncertainCount: review.uncertainCount,
    unknownUsageCount: ledger.unknownCount,
    reassessmentEnqueued,
  };
}
