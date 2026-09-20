import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  briefRevisionSchema,
  type BriefRevision,
} from "@/domain/growth-intelligence/brief";
import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import {
  RESEARCH_BUDGET_LIMITS,
  researchAttemptUsageSchema,
  researchCoverageEntrySchema,
  type ResearchAttemptUsage,
  type ResearchCoverageEntry,
  type ResearchCoverageOutcome,
} from "@/domain/growth-intelligence/research-pipeline";
import {
  RESEARCH_MODEL_CALL_LIMITS,
  RESEARCH_MODEL_MAX_SOURCES_PER_BATCH,
  researchModelBudgetSchema,
  type ResearchModelBudget,
  type ResearchModelPhase,
} from "@/domain/growth-intelligence/research-budget";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  MONITORING_UPDATE_ADAPTER_TIMEOUT_MS,
  monitoringDraftAdviceSchema,
  monitoringResearchFindingSchema,
  type MonitoringResearcher,
  type MonitoringResearchOutcome,
} from "@/modules/growth-intelligence/application/market-monitoring-update";
import {
  approvedResearchScopeSchema,
  researchRequestSchema,
  type ApprovedResearchScope,
  type ResearchRetrievedSource,
} from "@/modules/growth-intelligence/infrastructure/research/ports";
import {
  digestClaimCandidate,
  extractResearchClaims,
  type ExtractableSource,
  type ResearchModelSpender,
  type ResearchModelTransport,
} from "@/modules/growth-intelligence/infrastructure/research/claim-extraction";
import {
  reviewResearchClaimSupport,
  selectAdmissibleClaims,
} from "@/modules/growth-intelligence/infrastructure/research/claim-support-review";
import { createResearchProviderQualification } from "@/modules/growth-intelligence/infrastructure/research/qualification";
import {
  QUALIFIED_TINYFISH_RESEARCH_PROVIDER,
  resolveResearchAdapterAvailability,
} from "@/modules/growth-intelligence/infrastructure/research/qualified-provider";
import {
  runTinyfishSearchResearch,
  type TinyfishSearchDurableState,
  type TinyfishSearchGate,
  type TinyfishSearchSpender,
} from "@/modules/growth-intelligence/infrastructure/research/tinyfish-search-adapter";
import {
  createTinyfishSearchTransport,
  type TinyfishSearchTransport,
} from "@/modules/growth-intelligence/infrastructure/research/tinyfish-search-transport";
import {
  createWiredResearchModelTransport,
  isResearchModelGateOpen,
  readResearchModelApiKey,
  readResearchModelId,
  shouldWireResearchModelPhase,
} from "@/trigger/growth-intelligence-research-models";
import {
  isTinyfishResearchGateOpen,
  readTinyfishSearchApiKey,
  type TinyfishResearchPersistence,
} from "@/trigger/growth-intelligence-tinyfish";

/**
 * Project-scope research executor for one-time Market Watch updates
 * (Task 3). Replaces the fail-closed stub: a qualified TinyFish lane runs
 * live retrieval over the worker's pinned-brief query plan, the Task 2 model
 * transports propose and review claim candidates from those excerpts, and
 * deterministic admission maps the survivors onto monitoring findings.
 * Report composition stays deterministic in the worker; this module never
 * composes, persists, or settles anything — it only returns the researcher
 * outcome the worker settles through the fenced RPCs.
 *
 * Rulings honored: TinyFish retrieval + Task 2 transports for findings,
 * deterministic composition kept (worker-owned), briefIdentity stays null
 * (rejected at the boundary), no new failure codes (ADAPTER_UNAVAILABLE for
 * a closed lane, RESEARCH_EXECUTION_UNAVAILABLE for everything else the
 * executor refuses).
 *
 * Spend honesty: update-scoped spend cannot reserve through the fenced
 * attempt ledger — reserve_research_attempt fences on a claimed
 * growth_intelligence_requests row with its claim token, and a monitoring
 * update is neither a request nor a pipeline (no migration may add a scope).
 * Paid calls therefore run under the lane kill-switch, the staged TinyFish
 * qualification, the G45 research deadline, the shared attempt ceiling
 * (26 + 2) and the per-phase model call caps — with every usage returned on
 * the outcome so the worker settles honest known/unknown cost through
 * settle_monitoring_update. A follow-up migration keying reservations to
 * update ids should close this gap.
 */

/** The stub's unqualified-lane code, preserved exactly. */
const ADAPTER_UNAVAILABLE = "ADAPTER_UNAVAILABLE";

/** The stub's qualified-but-unstaged code, reused for every executor refusal. */
const RESEARCH_EXECUTION_UNAVAILABLE = "RESEARCH_EXECUTION_UNAVAILABLE";

/** Coverage outcomes that prove an outage rather than an honest empty. */
const OUTAGE_OUTCOMES: ReadonlySet<ResearchCoverageOutcome> = new Set([
  "failed",
  "skipped_budget",
  "skipped_policy",
  "not_started",
]);

const countryCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/);

/**
 * Model-phase scope from approved public brief fields only. The worker's
 * query plan already constrains retrieval to these fields; the scope carries
 * the same public context (area, competitors, investigation topics) into the
 * extraction prompt and the support-review competitor check. Geography comes
 * from the brief research area plus the organization country the wiring reads
 * with a tenant-pinned organizations lookup — never invented, never a guess:
 * a missing or malformed country fails closed before any paid call.
 */
export function buildMonitoringModelScope(input: {
  brief: BriefRevision;
  countryCode: string | null;
}): ApprovedResearchScope {
  const brief = briefRevisionSchema.parse(input.brief);
  const countryCode = countryCodeSchema.parse(input.countryCode);
  return approvedResearchScopeSchema.parse({
    publicBusinessName: (brief.title ?? "").slice(0, 160),
    approvedDomains: [],
    niches: [brief.researchArea.slice(0, 120)],
    city: brief.researchArea,
    countryCode,
    topics: [...brief.investigationAreas],
    competitors: brief.competitors.map((competitor) => ({
      name: competitor.name,
      ...(competitor.website ? { publicUrl: competitor.website } : {}),
      ...(competitor.locationHint ? { locationHint: competitor.locationHint } : {}),
    })),
  });
}

/**
 * Stable claim identity for monitoring findings. The request path mints
 * `clm-` keys from the same digest; monitoring citations need uuid-shaped
 * claim ids, so the digest bytes are formatted as a uuid with the version
 * and variant bits pinned to the v4 markers (`4` and `8`). Deterministic in
 * the claim content — the same admitted candidate always yields the same id,
 * and the pinned bits carry no invented fact.
 */
export function deriveMonitoringClaimId(input: {
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
  const digest = digestClaimCandidate(input);
  return (
    `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}` +
    `-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`
  );
}

/**
 * Ledger-free run-local spender for monitoring research. Reserve mints a
 * synthetic attempt id and settle acknowledges the receipt — no fenced RPC,
 * because no request-scoped reservation exists for an update (see the module
 * note). Bounds stay with the runners: the search runner enforces the shared
 * attempt/byte/source ceilings and the model runners enforce their per-phase
 * call caps from the budgets below. A spend phase outside the two known
 * phases is refused exactly like the fenced spender refuses it.
 */
export function createMonitoringResearchSpender(): ResearchModelSpender & {
  reserve(input: { slotKey: string; attemptIndex: number }): Promise<{ attemptId: string }>;
} {
  const attemptIds = new Set<string>();
  const attemptIdSchema = z.string().uuid();
  return {
    async reserve(input: { phase?: ResearchModelPhase; slotKey: string; attemptIndex: number }) {
      if (input.phase !== undefined && input.phase !== "extraction" && input.phase !== "support_review") {
        throw new GrowthIntelligenceError(
          "RESEARCH_BUDGET_UNAVAILABLE",
          "Research spend could not be reserved.",
        );
      }
      const attemptId = randomUUID();
      attemptIds.add(attemptId);
      return { attemptId };
    },
    async settle(input: { attemptId: string; usage: unknown }) {
      attemptIdSchema.parse(input.attemptId);
      researchAttemptUsageSchema.parse(input.usage);
    },
  };
}

/** Per-phase model budget, mirroring the trigger's researchModelBudget. */
function monitoringModelBudget(phase: ResearchModelPhase): ResearchModelBudget {
  return {
    phase,
    maxCalls: RESEARCH_MODEL_CALL_LIMITS[phase].maxCalls,
    maxInputTokens: RESEARCH_MODEL_CALL_LIMITS[phase].maxInputTokens,
    maxOutputTokens: RESEARCH_MODEL_CALL_LIMITS[phase].maxOutputTokens,
    maxSourcesPerBatch: RESEARCH_MODEL_MAX_SOURCES_PER_BATCH,
  };
}

function unconfiguredMonitoringModelTransport(phase: ResearchModelPhase): ResearchModelTransport {
  return {
    async complete() {
      throw new DomainError(
        "INTEGRATION_ERROR",
        `Market research ${phase} is not configured for this organization.`,
      );
    },
  };
}

const executorQuerySchema = z
  .object({
    slotKey: z.string().trim().min(1).max(160),
    kind: z.enum(["investigation_area", "competitor"]),
    text: z.string().trim().min(1).max(160),
    maxResults: z.number().int().min(1).max(RESEARCH_BUDGET_LIMITS.maxResultsPerQuery),
  })
  .strict();

const executorInputSchema = z
  .object({
    organizationId: z.string().uuid(),
    projectId: z.string().uuid(),
    updateId: z.string().uuid(),
    briefRevisionId: z.string().uuid(),
    queries: z
      .array(executorQuerySchema)
      .min(1)
      .max(RESEARCH_BUDGET_LIMITS.maxPrimarySearches),
    // Snapshot infrastructure has not landed (G23): the worker always passes
    // null, and any non-null identity fails closed here instead of running
    // retrieval the report could not honestly attribute.
    briefIdentity: z.null(),
    deadlineMs: z.number().int().min(250).max(300_000),
  })
  .passthrough();

export type MonitoringResearchExecutorDependencies = {
  availability: { available: boolean; provider: string };
  brief: BriefRevision;
  scope: ApprovedResearchScope;
  search: {
    transport: TinyfishSearchTransport;
    spender: TinyfishSearchSpender;
    gate: TinyfishSearchGate;
  };
  extraction: {
    transport: ResearchModelTransport;
    spender: ResearchModelSpender;
    budget: ResearchModelBudget;
    modelId: string;
  };
  supportReview: {
    transport: ResearchModelTransport;
    spender: ResearchModelSpender;
    budget: ResearchModelBudget;
    modelId: string;
  };
  now?: () => Date;
};

function failedOutcome(
  code: string,
  retrievalCoverage: ResearchCoverageEntry[],
  usages: ResearchAttemptUsage[],
): Extract<MonitoringResearchOutcome, { status: "failed" }> {
  return {
    status: "failed",
    code,
    retrievalCoverage: z.array(researchCoverageEntrySchema).parse(retrievalCoverage),
    usages: z.array(researchAttemptUsageSchema).parse(usages),
  };
}

/**
 * Composes the executor over injected retrieval and model seams. Every
 * refusal returns a failed outcome with a staged code — never a throw — so
 * the worker settles honestly and Trigger never redelivers a run that simply
 * has no lane, no scope, or no evidence.
 */
export function createMonitoringResearchExecutor(
  dependencies: MonitoringResearchExecutorDependencies,
): MonitoringResearcher {
  const brief = briefRevisionSchema.parse(dependencies.brief);
  const scope = approvedResearchScopeSchema.parse(dependencies.scope);
  const extractionBudget = researchModelBudgetSchema.parse(dependencies.extraction.budget);
  const reviewBudget = researchModelBudgetSchema.parse(dependencies.supportReview.budget);
  if (extractionBudget.phase !== "extraction" || reviewBudget.phase !== "support_review") {
    throw new Error("Monitoring research requires extraction and support_review budgets.");
  }
  const now = dependencies.now ?? (() => new Date());

  const requestEnvelope = researchRequestSchema.parse({
    scope,
    maxQueries: 1,
    maxResultsPerQuery: RESEARCH_BUDGET_LIMITS.maxResultsPerQuery,
    maxResponseBytes: RESEARCH_BUDGET_LIMITS.maxResponseBytes,
    maxRedirects: 0,
    timeoutMs: MONITORING_UPDATE_ADAPTER_TIMEOUT_MS,
    maxCostMicrosUsd: RESEARCH_BUDGET_LIMITS.maxPipelineReservationMicrosUsd,
  });

  return async (call) => {
    const parsed = executorInputSchema.safeParse(call);
    if (!parsed.success) {
      return failedOutcome(RESEARCH_EXECUTION_UNAVAILABLE, [], []);
    }
    const signal = (call as { signal?: AbortSignal }).signal;
    if (!dependencies.availability.available) {
      return failedOutcome(ADAPTER_UNAVAILABLE, [], []);
    }
    // Tenant and revision fence: the executor runs the pinned brief it was
    // built for, never a foreign organization's update or another project.
    if (
      parsed.data.organizationId !== brief.organizationId ||
      parsed.data.projectId !== brief.projectId
    ) {
      return failedOutcome(RESEARCH_EXECUTION_UNAVAILABLE, [], []);
    }
    if (signal?.aborted) return { status: "cancelled" };

    const finish = (
      outcome: MonitoringResearchOutcome,
    ): MonitoringResearchOutcome => {
      // Identifiers and platform codes only (the logger allowlist forbids
      // anything else): the worker and task logs carry outcome and counts.
      if (outcome.status === "failed") {
        logger.info("growth_intelligence.monitoring_research_finished", {
          organizationId: parsed.data.organizationId,
          errorCode: outcome.code,
        });
      } else if (outcome.status === "succeeded") {
        logger.info("growth_intelligence.monitoring_research_finished", {
          organizationId: parsed.data.organizationId,
        });
      }
      return outcome;
    };

    try {
      // One runner run per monitoring slot, chained through resumeFrom so
      // the shared attempt, retry, byte and source ceilings — plus the
      // original start time — hold across the whole plan exactly as a single
      // full-coverage run. Per-slot runs also record exact source provenance
      // (which slot retrieved which source) for finding attribution below.
      const queries = parsed.data.queries;
      const slotOrder = new Map(queries.map((query, index) => [query.slotKey, index] as const));
      const coverages: ResearchCoverageEntry[] = [];
      const sourceSlotByUrl = new Map<string, string>();
      let resumeFrom: TinyfishSearchDurableState | undefined;
      let retrieved: ResearchRetrievedSource[] = [];
      let attemptUsages: ResearchAttemptUsage[] = [];
      let chainBroken = false;

      for (const query of queries) {
        if (signal?.aborted) return { status: "cancelled" };
        if (chainBroken) {
          coverages.push(
            researchCoverageEntrySchema.parse({
              slotKey: query.slotKey,
              kind: query.kind === "competitor" ? "competitor" : "topic",
              outcome: "not_started" as const,
              attemptIds: [],
              acceptedClaimIds: [],
            }),
          );
          continue;
        }
        const previousSourceCount = retrieved.length;
        try {
          const output = await runTinyfishSearchResearch({
            request: requestEnvelope,
            plan: [
              {
                slotKey: query.slotKey,
                kind: query.kind === "competitor" ? "competitor" : "topic",
                text: query.text,
                maxResults: query.maxResults,
              },
            ],
            transport: dependencies.search.transport,
            spender: dependencies.search.spender,
            gate: dependencies.search.gate,
            ...(resumeFrom ? { resumeFrom } : {}),
            deadlineMs: parsed.data.deadlineMs,
            now,
            ...(signal ? { signal } : {}),
          });
          const slotCoverage = output.result.coverage[0];
          if (!slotCoverage) {
            throw new Error("Tinyfish search returned no coverage for its planned slot.");
          }
          coverages.push(slotCoverage);
          retrieved = output.result.sources;
          attemptUsages = output.result.attempts.map((attempt) => attempt.usage);
          for (const source of retrieved.slice(previousSourceCount)) {
            if (!sourceSlotByUrl.has(source.sourceUrl)) {
              sourceSlotByUrl.set(source.sourceUrl, query.slotKey);
            }
          }
          resumeFrom = output.durableState;
        } catch {
          // A slot that throws (never the documented per-attempt failures,
          // which the runner records as data) fails closed on its own: the
          // chain stops so ceilings stay exact, and the rest wait honestly.
          coverages.push(
            researchCoverageEntrySchema.parse({
              slotKey: query.slotKey,
              kind: query.kind === "competitor" ? "competitor" : "topic",
              outcome: "failed" as const,
              attemptIds: [],
              acceptedClaimIds: [],
            }),
          );
          chainBroken = true;
        }
      }

      if (signal?.aborted) return { status: "cancelled" };

      const extractable: ExtractableSource[] = retrieved
        .slice(0, RESEARCH_BUDGET_LIMITS.maxRetainedSources)
        .map((item, index) => ({
          sourceKey: `src-${index}-${item.excerptDigest.slice(0, 12)}`,
          sourceUrl: item.sourceUrl,
          excerptText: item.excerptText,
          excerptDigest: item.excerptDigest,
          retrievedAt: item.retrievedAt,
        }));
      const sourceUrlByKey = new Map(extractable.map((item) => [item.sourceKey, item.sourceUrl]));

      const extraction = await extractResearchClaims({
        scope,
        sources: extractable,
        budget: extractionBudget,
        transport: dependencies.extraction.transport,
        spender: dependencies.extraction.spender,
        modelId: dependencies.extraction.modelId,
        now,
        ...(signal ? { signal } : {}),
      });
      if (signal?.aborted) return { status: "cancelled" };

      const eligibleSourceKeys = extractable.map((item) => item.sourceKey);
      const review = await reviewResearchClaimSupport({
        candidates: extraction.candidates,
        sources: extractable,
        scope,
        eligibleSourceKeys,
        budget: reviewBudget,
        transport: dependencies.supportReview.transport,
        spender: dependencies.supportReview.spender,
        modelId: dependencies.supportReview.modelId,
        now,
        ...(signal ? { signal } : {}),
      });
      if (signal?.aborted) return { status: "cancelled" };

      const admission = selectAdmissibleClaims({
        candidates: extraction.candidates,
        reviews: review.reviews,
        eligibleSourceKeys,
      });
      const usages: ResearchAttemptUsage[] = z
        .array(researchAttemptUsageSchema)
        .parse([...attemptUsages, ...extraction.usages, ...review.usages]);

      if (admission.admitted.length === 0) {
        const totalOutage = coverages.every((entry) => OUTAGE_OUTCOMES.has(entry.outcome));
        // A refused model phase is an outage, never an empty: extraction
        // reports failed/unprocessed batches, and review marks unjudged
        // candidates REVIEW_INCONCLUSIVE (deterministic verdicts carry
        // specific codes instead). Anything else with zero admitted is an
        // honest empty — the models ran and judged nothing admissible.
        const extractionIncomplete =
          extraction.batchesFailed > 0 || extraction.unprocessedSourceCount > 0;
        const reviewInconclusive = review.reviews.some((item) =>
          item.limitations.includes("REVIEW_INCONCLUSIVE"),
        );
        // Retryability follows outage-ness: a dead lane or a refused model
        // phase stays retryable research_failed, while searched-but-empty
        // (or judged-but-inadmissible) keeps its precise coverage and lands
        // no_findings.
        if (totalOutage || extractionIncomplete || reviewInconclusive) {
          return finish(failedOutcome(RESEARCH_EXECUTION_UNAVAILABLE, coverages, usages));
        }
        return finish({
          status: "succeeded",
          retrievalCoverage: coverages.map((entry) => ({ ...entry })),
          findings: [],
          sources: [],
          draftAdvice: [],
          usages,
        });
      }

      const findings = admission.admitted.map((candidate) => {
        const claimId = deriveMonitoringClaimId(candidate);
        // Attribute each finding to the earliest planned slot that retrieved
        // one of its cited sources — provenance captured above, never text
        // matching, never a guess.
        let slotKey = queries[0]?.slotKey ?? "";
        let best = Number.POSITIVE_INFINITY;
        for (const key of candidate.sourceKeys) {
          const url = sourceUrlByKey.get(key);
          const slot = url ? sourceSlotByUrl.get(url) : undefined;
          const order = slot ? (slotOrder.get(slot) ?? Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
          if (slot && order < best) {
            best = order;
            slotKey = slot;
          }
        }
        return monitoringResearchFindingSchema.parse({
          key: candidate.candidateKey,
          statement: candidate.paraphrase,
          slotKey,
          citations: candidate.citations.map((citation) => ({
            claimId,
            sourceRef: citation.sourceKey,
          })),
        });
      });

      const citedSourceKeys = new Set(
        findings.flatMap((finding) =>
          finding.citations.flatMap((citation) => (citation.sourceRef ? [citation.sourceRef] : [])),
        ),
      );
      // Only cited excerpts enter the report: uncited retrieval never reaches
      // persisted content, so unreviewed snippets cannot leak into a report.
      const sources = extractable
        .filter((item) => citedSourceKeys.has(item.sourceKey))
        .map((item) => ({
          sourceRef: item.sourceKey,
          url: item.sourceUrl,
          retrievedAtUtc: item.retrievedAt,
        }));

      return finish({
        status: "succeeded",
        retrievalCoverage: coverages.map((entry) => ({ ...entry })),
        findings,
        sources,
        // No advice model runs here: gaps surface through the coverage
        // checklist, and advice is never invented.
        draftAdvice: z.array(monitoringDraftAdviceSchema).parse([]),
        usages,
      });
    } catch {
      // Near-impossible by construction (every documented failure returns as
      // data); the safety net still fails closed with the staged code and
      // keeps the prior report via the worker's backfill path.
      return finish(failedOutcome(RESEARCH_EXECUTION_UNAVAILABLE, [], []));
    }
  };
}

/**
 * Production assembly for the monitoring update task. Replicates the
 * request-path qualification check org-scoped: a present key, an open lane
 * kill-switch, and a staged tinyfish-lane qualification together authorize
 * live retrieval; anything else keeps the stub-equivalent refusal with zero
 * spend. The extraction and support-review phases reuse the Task 2 wiring
 * predicate and transports, with run-local spenders (see the module note)
 * and no brief refs — monitoring runs evidence-only until snapshot staging.
 */
export async function createQualifiedMonitoringResearcher(input: {
  persistence: TinyfishResearchPersistence;
  organizationId: string;
  brief: BriefRevision;
  organizationCountryCode: string | null;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<MonitoringResearcher> {
  const refused = (code: string): MonitoringResearcher => async () => ({
    status: "failed",
    code,
    retrievalCoverage: [],
    usages: [],
  });

  const brief = briefRevisionSchema.parse(input.brief);
  if (brief.organizationId !== input.organizationId) {
    return refused(RESEARCH_EXECUTION_UNAVAILABLE);
  }

  const apiKey = readTinyfishSearchApiKey();
  if (apiKey.length === 0 || !isTinyfishResearchGateOpen()) {
    return refused(ADAPTER_UNAVAILABLE);
  }

  let laneQualified = false;
  try {
    const { qualification } = await createResearchProviderQualification(
      input.persistence,
      "tinyfish",
    ).check();
    const staged = resolveResearchAdapterAvailability(qualification);
    laneQualified =
      staged.available && qualification.provider === QUALIFIED_TINYFISH_RESEARCH_PROVIDER;
  } catch {
    return refused(ADAPTER_UNAVAILABLE);
  }
  if (!laneQualified) return refused(ADAPTER_UNAVAILABLE);

  let scope: ApprovedResearchScope;
  try {
    scope = buildMonitoringModelScope({
      brief,
      countryCode: input.organizationCountryCode,
    });
  } catch {
    return refused(RESEARCH_EXECUTION_UNAVAILABLE);
  }

  const gateOpen = isResearchModelGateOpen();
  const modelApiKey = readResearchModelApiKey();
  const extractionModelId = readResearchModelId("RESEARCH_EXTRACTION_MODEL");
  const reviewModelId = readResearchModelId("RESEARCH_SUPPORT_REVIEW_MODEL");
  const logging = { organizationId: input.organizationId };

  const wireExtraction = shouldWireResearchModelPhase({
    gateOpen,
    laneQualified,
    apiKey: modelApiKey,
    modelId: extractionModelId,
  });
  const wireReview = shouldWireResearchModelPhase({
    gateOpen,
    laneQualified,
    apiKey: modelApiKey,
    modelId: reviewModelId,
  });

  return createMonitoringResearchExecutor({
    availability: { available: true, provider: QUALIFIED_TINYFISH_RESEARCH_PROVIDER },
    brief,
    scope,
    search: {
      transport: createTinyfishSearchTransport({
        apiKey,
        ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
      }),
      spender: createMonitoringResearchSpender(),
      gate: { isAvailable: () => isTinyfishResearchGateOpen() },
    },
    extraction: wireExtraction
      ? {
          transport: createWiredResearchModelTransport({
            modelId: extractionModelId,
            apiKey: modelApiKey,
            logging,
          }),
          spender: createMonitoringResearchSpender(),
          budget: monitoringModelBudget("extraction"),
          modelId: extractionModelId,
        }
      : {
          transport: unconfiguredMonitoringModelTransport("extraction"),
          spender: createMonitoringResearchSpender(),
          budget: monitoringModelBudget("extraction"),
          modelId:
            extractionModelId.trim().length > 0
              ? extractionModelId
              : "unconfigured-extraction-model",
        },
    supportReview: wireReview
      ? {
          transport: createWiredResearchModelTransport({
            modelId: reviewModelId,
            apiKey: modelApiKey,
            logging,
          }),
          spender: createMonitoringResearchSpender(),
          budget: monitoringModelBudget("support_review"),
          modelId: reviewModelId,
        }
      : {
          transport: unconfiguredMonitoringModelTransport("support_review"),
          spender: createMonitoringResearchSpender(),
          budget: monitoringModelBudget("support_review"),
          modelId:
            reviewModelId.trim().length > 0 ? reviewModelId : "unconfigured-review-model",
        },
    now: () => new Date(),
  });
}
