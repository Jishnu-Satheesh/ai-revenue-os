import { createHash } from "node:crypto";

import { z } from "zod";

import type { EventPublisher } from "@/domain/events/types";
import type { MarketProfileDocumentV1 } from "@/domain/growth-intelligence/types";
import { createGrowthIntelligenceRequestFingerprint } from "@/domain/growth-intelligence/request-fingerprint";
import { DomainError } from "@/lib/errors";
import type { MarketEvidenceRepository } from "@/modules/growth-intelligence/infrastructure/evidence-repository";
import type { ResearchQuery } from "@/modules/growth-intelligence/infrastructure/research/query-plan";
import type { ResearchRequest } from "@/modules/growth-intelligence/infrastructure/research/ports";

/**
 * The market research worker.
 *
 * The same shape as the channel analysis worker, for the same reason: claim a
 * lease, reload every authority under it, compute deterministically, and hand
 * the result to fenced database functions that check every rule again. The
 * worker is not the authority on what may be recorded as evidence.
 *
 * The adapter always runs outside the claim transaction: the claim RPC returns
 * before the first query is planned, so a slow provider can never hold a
 * database lock. Claim-level support grades (primary, corroborated, and kin)
 * are assigned when claims are extracted; this layer grades source attempts
 * (availability, safe codes, corroborating digests) and records compact
 * citation metadata only. Claim extraction belongs to synthesis (Increment 2).
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

const safeCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,80}$/);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);

const adapterSourceAttemptSchema = z
  .object({
    queryKind: z.enum(["official_identity", "market_context", "topic_monitoring"]),
    sourceUrl: z
      .string()
      .min(8)
      .max(2_048)
      .regex(/^https?:\/\/[^/?#:@]+(?:\/[^?#]*)?$/),
    sourceDomain: z
      .string()
      .min(3)
      .max(253)
      .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/),
    publisher: z.string().min(1).max(200).nullable(),
    sourceClass: z.enum(["official", "first_party", "industry_research", "public_signal"]),
    availability: z.enum(["available", "unavailable", "excluded"]),
    contentDigest: digestSchema.nullable(),
    safeFailureCode: safeCodeSchema.nullable(),
    retrievedAt: z.string().datetime({ offset: true }),
    publishedAt: z.string().datetime({ offset: true }).nullable(),
    observedAt: z.string().datetime({ offset: true }).nullable(),
    adapterCostMicrosUsd: z.number().int().min(0).max(50_000_000),
    adapterLatencyMs: z.number().int().min(0).max(600_000),
  })
  .strict()
  .superRefine((attempt, context) => {
    if (
      (attempt.availability === "available" &&
        (!attempt.contentDigest || attempt.safeFailureCode)) ||
      (attempt.availability !== "available" && !attempt.safeFailureCode)
    ) {
      context.addIssue({
        code: "custom",
        message: "Attempt availability must match its digest and safe failure code.",
      });
    }
  });

export type AdapterSourceAttempt = z.infer<typeof adapterSourceAttemptSchema>;

export type MarketResearchAdapter = {
  readonly availability: { available: boolean; provider: string };
  searchAndFetch(input: ResearchRequest): Promise<readonly AdapterSourceAttempt[]>;
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
      reassessmentEnqueued: boolean;
    }
  | { outcome: "failed"; code: string; runId: string | null }
  | { outcome: "not_acquired"; claimOutcome: string }
  | { outcome: "claim_lost" }
  | { outcome: "cancelled" };

const RESEARCH_LEASE_SECONDS = 600;
const RESEARCH_RULE_VERSION = "market-research@1";
const RESEARCH_RUN_BUDGET_MICROS_USD = 5_000_000;
const MAX_ADAPTER_ATTEMPTS = 200;
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
 * Deterministic evidence grading at the research layer: keep only available
 * attempts whose content digest is not already current. Unchanged evidence
 * updates run lineage without creating a materially duplicate record.
 */
export function selectMaterialAttempts(
  attempts: readonly AdapterSourceAttempt[],
  currentDigests: readonly string[],
): AdapterSourceAttempt[] {
  const current = new Set(currentDigests);
  return attempts.filter(
    (attempt) =>
      attempt.availability === "available" &&
      attempt.contentDigest !== null &&
      !current.has(attempt.contentDigest),
  );
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

export async function runMarketResearch(
  input: unknown,
  dependencies: MarketResearchDependencies,
): Promise<MarketResearchResult> {
  const payload = marketResearchPayloadSchema.parse(input);
  const now = dependencies.now ?? (() => new Date());
  const newClaimToken = dependencies.newClaimToken ?? (() => crypto.randomUUID());
  const adapter = dependencies.adapter;

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
      payload: { requestId: payload.requestId, runId: null, code },
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

  let research: ResearchRequest;
  let queries: ResearchQuery[];
  try {
    research = dependencies.buildScope(profile.document);
    queries = dependencies.planQueries(research);
  } catch {
    return failRequest("PROFILE_CONTEXT_INVALID");
  }

  const queryPlanDigest = sha256(canonicalize(queries));
  const runMetadata = {
    adapterProvider: adapter.availability.provider,
    adapterVersion: RESEARCH_RULE_VERSION,
    modelProvider: null,
    modelVersion: null,
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
      failure: { safeFailureCode: code, adapterCostMicrosUsd: 0, adapterLatencyMs: 0 },
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
      payload: { requestId: payload.requestId, runId: begun.runId, code },
    });
    return { outcome: "failed", code, runId: begun.runId };
  };

  if (!adapter.availability.available) return failRun("ADAPTER_UNAVAILABLE");
  if (dependencies.signal?.aborted) return failRun("WORKER_CANCELLED");

  // The adapter runs outside the claim transaction: the claim RPC returned
  // long before this await, so a slow provider holds no database lock.
  let attempts: readonly AdapterSourceAttempt[];
  try {
    attempts = await adapter.searchAndFetch(research);
  } catch (error) {
    if (error instanceof DomainError && error.code === "FEATURE_NOT_AVAILABLE") {
      return failRun("ADAPTER_UNAVAILABLE");
    }
    throw error;
  }
  if (dependencies.signal?.aborted) return failRun("WORKER_CANCELLED");

  const parsed: AdapterSourceAttempt[] = [];
  for (const attempt of attempts) {
    const result = adapterSourceAttemptSchema.safeParse(attempt);
    if (!result.success) return failRun("EVIDENCE_RECORD_INVALID");
    parsed.push(result.data);
  }
  if (parsed.length > MAX_ADAPTER_ATTEMPTS) return failRun("ADAPTER_RESULT_UNBOUNDED");

  const currentDigests = await dependencies.currentSources.load({
    organizationId: payload.organizationId,
    profileVersionId: profile.versionId,
  });
  const material = selectMaterialAttempts(parsed, currentDigests);

  const sourceAttemptCount = parsed.length;
  const sourceSuccessCount = parsed.filter(
    (attempt) => attempt.availability === "available",
  ).length;

  if (material.length > 0) {
    const sources = material.slice(0, MAX_RECORDED_SOURCES).map((attempt, index) => ({
      key: `src-${index}-${(attempt.contentDigest ?? "unavailable").slice(0, 12)}`,
      url: attempt.sourceUrl,
      domain: attempt.sourceDomain,
      publisher: attempt.publisher,
      sourceClass: attempt.sourceClass,
      availability: attempt.availability,
      contentDigest: attempt.contentDigest,
      safeFailureCode: attempt.safeFailureCode,
      retrievedAt: attempt.retrievedAt,
      publishedAt: attempt.publishedAt,
      observedAt: attempt.observedAt,
    }));
    // Claims stay empty: claim extraction from source content is synthesis
    // work (Increment 2). Recording sources alone preserves the retrieval
    // lineage the weekly consolidation reads without inventing claim content.
    await dependencies.evidence.record({
      organizationId: payload.organizationId,
      requestId: payload.requestId,
      claimToken,
      runId: begun.runId,
      payload: { sources, claims: [], links: [] },
    });
  }

  const runOutcome = sourceSuccessCount < sourceAttemptCount ? "partial" : "completed";
  const resultDigest = sha256(
    canonicalize({
      runFingerprint: runMetadata.runFingerprint,
      sourceAttemptCount,
      sourceSuccessCount,
      claimCount: 0,
      materialDigestCount: material.length,
    }),
  );
  const adapterCostMicrosUsd = Math.min(
    parsed.reduce((total, attempt) => total + attempt.adapterCostMicrosUsd, 0),
    RESEARCH_RUN_BUDGET_MICROS_USD,
  );
  const adapterLatencyMs = Math.min(
    parsed.reduce((total, attempt) => total + attempt.adapterLatencyMs, 0),
    600_000,
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
        adapterCostMicrosUsd,
        adapterLatencyMs,
      },
    });
  } catch (error) {
    if (error instanceof DomainError) {
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
      claimCount: 0,
      sourceAttemptCount,
      sourceSuccessCount,
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
  const novelDomain = parsed.some(
    (attempt) =>
      !excluded.has(attempt.sourceDomain.toLowerCase()) &&
      !approved.has(attempt.sourceDomain.toLowerCase()),
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
    claimCount: 0,
    sourceAttemptCount,
    sourceSuccessCount,
    reassessmentEnqueued,
  };
}
