import "server-only";

import { createHash } from "node:crypto";

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
import { monitoringCompetitorSlotKey } from "@/modules/growth-intelligence/application/market-monitoring-context";
import {
  approvedResearchScopeSchema,
  researchRequestSchema,
  researchRetrievedSourceSchema,
  type ApprovedResearchScope,
  type ResearchRetrievedSource,
} from "@/modules/growth-intelligence/infrastructure/research/ports";
import {
  AGENT_SLOT_TIMEOUT_MS,
  createTinyfishAgentAdapter,
  type AgentSlotOutcome,
} from "@/modules/growth-intelligence/infrastructure/research/tinyfish-agent-adapter";
import {
  digestClaimCandidate,
  extractResearchClaims,
  type ExtractableSource,
  type ResearchModelSpender,
  type ResearchModelTransport,
} from "@/modules/growth-intelligence/infrastructure/research/claim-extraction";import {
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
import type { ResearchBudgetRepository } from "@/modules/growth-intelligence/infrastructure/research/budget-repository";
import {
  createTinyfishAgentClientSeam,
  isTinyfishResearchGateOpen,
  readTinyfishSearchApiKey,
  TINYFISH_RESEARCH_PRICE_VERSION,
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
 * Spend is fenced per update: the migration alongside this module keys
 * budget reservations to monitoring update ids, so every paid call reserves
 * its worst case through reserve_monitoring_update_attempt before the call
 * and settles explicitly afterwards — the USD 1 update quote and the shared
 * USD 5 organization-day allowance are enforced pre-call by the database.
 * Replay returns the kept attempt row and never double-books, so a
 * redelivered run re-books the same rows instead of spending twice. The
 * fence is lifecycle row state (non-terminal row for this organization),
 * because the worker never threads its lease token to the researcher; a
 * stale run spending under a rival's live lease still books against the same
 * capped reservation, and anything after settle refuses.
 */

/** The stub's unqualified-lane code, preserved exactly. */
const ADAPTER_UNAVAILABLE = "ADAPTER_UNAVAILABLE";

/** The stub's qualified-but-unstaged code, reused for every executor refusal. */
const RESEARCH_EXECUTION_UNAVAILABLE = "RESEARCH_EXECUTION_UNAVAILABLE";

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
 * Update-scoped spend bounds. One update carries the same USD 1 story as one
 * pipeline: at most 28 search attempts plus 4 extraction plus 4 review calls
 * (36 worst case) at this per-attempt maximum stays within the quote
 * (36 x 25,000 = 900,000), so a full run can never breach its admitted
 * reservation and the ledger refuses over-cap calls before they are made.
 * Rates are untouched: TinyFish settles its staged $0 receipt and model
 * calls settle unknown, exactly as on the request path.
 */
export const MONITORING_UPDATE_QUOTE_MICROS_USD = 1_000_000;
export const MONITORING_UPDATE_MAXIMUM_MICROS_USD_PER_ATTEMPT = 25_000;

export type MonitoringUpdateBudget = Pick<
  ResearchBudgetRepository,
  "reserveUpdateBudget" | "reserveUpdateAttempt" | "settleAttempt"
>;

/**
 * Shared run-once update reservation. One instance is created per researcher
 * call and handed to the search and both model-phase spenders, so a run
 * issues exactly one reserve_monitoring_update_budget RPC. A refused ensure
 * stays unmarked, so the next reserve retries rather than caching a failure.
 */
export function createSharedMonitoringUpdateBudget(input: {
  budget: Pick<ResearchBudgetRepository, "reserveUpdateBudget">;
  organizationId: string;
  updateId: string;
}): { ensure: () => Promise<void> } {
  let ensured = false;
  return {
    async ensure() {
      if (ensured) return;
      await input.budget.reserveUpdateBudget({
        organizationId: input.organizationId,
        updateId: input.updateId,
        quoteMicrosUsd: MONITORING_UPDATE_QUOTE_MICROS_USD,
        priceVersion: TINYFISH_RESEARCH_PRICE_VERSION,
      });
      ensured = true;
    },
  };
}

/**
 * Fenced TinyFish search spender over the update-keyed budget wrappers.
 * Reserve-before-call: every provider call reserves its worst case first
 * through reserve_monitoring_update_attempt (which re-verifies the update
 * row, its tenant binding, and its non-terminal stage server-side) and
 * settles explicitly afterwards. Unknown cost stays reserved, never converts
 * to zero. The update reservation is ensured lazily on the first reserve, so
 * refused lanes never touch the ledger.
 */
export function createFencedMonitoringUpdateSearchSpender(input: {
  budget: MonitoringUpdateBudget;
  organizationId: string;
  updateId: string;
  ensureReservation?: () => Promise<void>;
}): TinyfishSearchSpender {
  let reservationEnsured = false;
  const ensureReservation =
    input.ensureReservation ??
    (async () => {
      if (reservationEnsured) return;
      await input.budget.reserveUpdateBudget({
        organizationId: input.organizationId,
        updateId: input.updateId,
        quoteMicrosUsd: MONITORING_UPDATE_QUOTE_MICROS_USD,
        priceVersion: TINYFISH_RESEARCH_PRICE_VERSION,
      });
      reservationEnsured = true;
    });
  return {
    async reserve({ slotKey, attemptIndex }) {
      if (!reservationEnsured) {
        await ensureReservation();
        reservationEnsured = true;
      }
      const debit = await input.budget.reserveUpdateAttempt({
        organizationId: input.organizationId,
        updateId: input.updateId,
        phase: "research",
        slotKey,
        attemptIndex,
        maximumMicrosUsd: MONITORING_UPDATE_MAXIMUM_MICROS_USD_PER_ATTEMPT,
      });
      return { attemptId: debit.attemptId };
    },
    async settle({ attemptId, usage }) {
      await input.budget.settleAttempt({
        organizationId: input.organizationId,
        attemptId,
        usage,
      });
    },
  };
}

/**
 * Fenced model spender over the update-keyed budget wrappers. Same
 * reserve-before-call contract as the search spender above. The phase column
 * stays "research" while the slot key carries the model-phase namespace the
 * runners emit (extraction:batch-N, support-review:batch-N), exactly as on
 * the request path — attribution without a schema change.
 */
export function createFencedMonitoringUpdateModelSpender(input: {
  budget: MonitoringUpdateBudget;
  organizationId: string;
  updateId: string;
  ensureReservation?: () => Promise<void>;
}): ResearchModelSpender {
  let reservationEnsured = false;
  const ensureReservation =
    input.ensureReservation ??
    (async () => {
      if (reservationEnsured) return;
      await input.budget.reserveUpdateBudget({
        organizationId: input.organizationId,
        updateId: input.updateId,
        quoteMicrosUsd: MONITORING_UPDATE_QUOTE_MICROS_USD,
        priceVersion: TINYFISH_RESEARCH_PRICE_VERSION,
      });
      reservationEnsured = true;
    });
  return {
    async reserve({ phase, slotKey, attemptIndex }) {
      if (phase !== "extraction" && phase !== "support_review") {
        throw new GrowthIntelligenceError(
          "RESEARCH_BUDGET_UNAVAILABLE",
          "Research spend could not be reserved.",
        );
      }
      if (!reservationEnsured) {
        await ensureReservation();
        reservationEnsured = true;
      }
      const debit = await input.budget.reserveUpdateAttempt({
        organizationId: input.organizationId,
        updateId: input.updateId,
        phase: "research",
        slotKey,
        attemptIndex,
        maximumMicrosUsd: MONITORING_UPDATE_MAXIMUM_MICROS_USD_PER_ATTEMPT,
      });
      return { attemptId: debit.attemptId };
    },
    async settle({ attemptId, usage }) {
      await input.budget.settleAttempt({
        organizationId: input.organizationId,
        attemptId,
        usage,
      });
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

/**
 * Agent fallback lane (Task 3 of 2026-09-21-agent-fallback-lane, R4).
 * At most the first 2 competitor slots per update run through the Agent lane;
 * every other slot (topics, excess competitors) stays on Search+Fetch.
 */
export const AGENT_LANE_MAX_COMPETITOR_SLOTS = 2;

export type MonitoringAgentSlotRunner = {
  runCompetitorSlot(input: {
    url: string;
    competitorName: string;
    fields: string[];
    timeoutMs?: number;
    abortSignal?: AbortSignal;
  }): Promise<AgentSlotOutcome>;
};

export type MonitoringAgentLane = {
  enabled: boolean;
  runner: MonitoringAgentSlotRunner;
};

export type MonitoringResearchExecutorDependencies = {
  availability: { available: boolean; provider: string };
  brief: BriefRevision;
  scope: ApprovedResearchScope;
  budget: MonitoringUpdateBudget;
  search: {
    transport: TinyfishSearchTransport;
    gate: TinyfishSearchGate;
  };
  extraction: {
    transport: ResearchModelTransport;
    budget: ResearchModelBudget;
    modelId: string;
  };
  supportReview: {
    transport: ResearchModelTransport;
    budget: ResearchModelBudget;
    modelId: string;
  };
  agentLane?: MonitoringAgentLane;
  now?: () => Date;
};

/**
 * Tenant-pinned opt-in read. Pins organization_id + id; any anomaly (no
 * `from` seam, query error, missing row, missing/invalid column) returns false
 * so the update keeps today's search-only behavior bit-for-bit. Never throws.
 */
async function readAgentLaneOptIn(
  persistence: TinyfishResearchPersistence,
  organizationId: string,
  projectId: string,
): Promise<boolean> {
  try {
    const client = persistence as unknown as {
      from?: (table: string) => unknown;
    };
    if (typeof client.from !== "function") return false;
    const query = (client as unknown as {
      from(table: string): {
        select(columns: string): {
          eq(column: string, value: string): {
            eq(column: string, value: string): {
              maybeSingle(): Promise<{ data: unknown; error: unknown }>;
            };
          };
        };
      };
    })
      .from("growth_intelligence_research_projects")
      .select("agent_lane_opt_in")
      .eq("organization_id", organizationId)
      .eq("id", projectId);
    const { data, error } = await query.maybeSingle();
    if (error || !data || typeof data !== "object") return false;
    return (data as { agent_lane_opt_in?: unknown }).agent_lane_opt_in === true;
  } catch {
    return false;
  }
}

function resolveAgentSlotTarget(
  scope: ApprovedResearchScope,
  slotKey: string,
): { url: string; competitorName: string; fields: string[] } | null {
  const competitor = scope.competitors.find(
    (entry) => monitoringCompetitorSlotKey(entry.name) === slotKey,
  );
  if (!competitor || !competitor.publicUrl) return null;
  let url: URL;
  try {
    url = new URL(competitor.publicUrl);
  } catch {
    return null;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    return null;
  }
  if (scope.topics.length === 0) return null;
  return { url: competitor.publicUrl, competitorName: competitor.name, fields: [...scope.topics] };
}

/**
 * Wraps agent JSON as a single retained source so the existing
 * extraction → review → admission path validates it unchanged. Returns null
 * when the payload cannot become a valid source (fail-closed to the
 * no-evidence path, never a throw).
 */
function agentDataToSource(input: {
  url: string;
  data: unknown;
  retrievedAt: string;
}): ResearchRetrievedSource | null {
  try {
    const text = JSON.stringify(input.data);
    if (!text || text === "null" || text.trim().length === 0) return null;
    const excerptText = text.slice(0, RESEARCH_BUDGET_LIMITS.maxExcerptCharacters);
    if (excerptText.trim().length === 0) return null;
    const parsed = new URL(input.url);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
      return null;
    }
    const digest = createHash("sha256").update(excerptText, "utf8").digest("hex");
    return researchRetrievedSourceSchema.parse({
      sourceUrl: input.url,
      domain: parsed.hostname.toLowerCase(),
      excerptText,
      excerptDigest: digest,
      retrievedAt: input.retrievedAt,
    });
  } catch {
    return null;
  }
}

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

    // Per-call fenced spenders over one shared run-once update reservation:
    // the update id arrives per call, so the reservation is ensured here,
    // lazily on the first reserve, and every paid call books liability
    // before it is made. Replay returns the kept rows, never double-books.
    const sharedReservation = createSharedMonitoringUpdateBudget({
      budget: dependencies.budget,
      organizationId: parsed.data.organizationId,
      updateId: parsed.data.updateId,
    });
    const sharedEnsure = () => sharedReservation.ensure();
    const searchSpender = createFencedMonitoringUpdateSearchSpender({
      budget: dependencies.budget,
      organizationId: parsed.data.organizationId,
      updateId: parsed.data.updateId,
      ensureReservation: sharedEnsure,
    });
    const extractionSpender = createFencedMonitoringUpdateModelSpender({
      budget: dependencies.budget,
      organizationId: parsed.data.organizationId,
      updateId: parsed.data.updateId,
      ensureReservation: sharedEnsure,
    });
    const reviewSpender = createFencedMonitoringUpdateModelSpender({
      budget: dependencies.budget,
      organizationId: parsed.data.organizationId,
      updateId: parsed.data.updateId,
      ensureReservation: sharedEnsure,
    });

    // The G45 deadline binds the model phases too: the search runner stops
    // itself at deadlineMs, and extraction/review abort on whatever remains,
    // so the whole researcher settles inside the 300s task envelope with the
    // designed 60s settle headroom. An aborted phase fails its batches and
    // lands retryable research_failed — never a silent empty, never a task
    // timeout redelivery loop.
    const researchStartedAtMs = now().getTime();
    const boundedPhaseSignal = (): AbortSignal => {
      const remainingMs = parsed.data.deadlineMs - (now().getTime() - researchStartedAtMs);
      const timeoutSignal = AbortSignal.timeout(Math.max(1, remainingMs));
      return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    };

    const finish = (
      outcome: MonitoringResearchOutcome,
    ): MonitoringResearchOutcome => {      // Identifiers and platform codes only (the logger allowlist forbids
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

      // Agent fallback lane (R4): when enabled, the first 2 competitor slots
      // in plan order run through the Agent adapter; every other slot stays on
      // Search+Fetch. Missing/false opt-in keeps today's behavior bit-for-bit
      // because `agentLane` is absent/disabled and this set stays empty.
      const agentLane = dependencies.agentLane?.enabled ? dependencies.agentLane : null;
      const agentSlotKeys = new Set<string>();
      if (agentLane) {
        for (const candidate of queries) {
          if (candidate.kind !== "competitor") continue;
          if (agentSlotKeys.size >= AGENT_LANE_MAX_COMPETITOR_SLOTS) break;
          agentSlotKeys.add(candidate.slotKey);
        }
      }

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
        if (agentLane && agentSlotKeys.has(query.slotKey)) {
          const target = resolveAgentSlotTarget(scope, query.slotKey);
          if (target) {
            let outcome: AgentSlotOutcome;
            try {
              outcome = await agentLane.runner.runCompetitorSlot({
                url: target.url,
                competitorName: target.competitorName,
                fields: target.fields,
                timeoutMs: AGENT_SLOT_TIMEOUT_MS,
                ...(signal ? { abortSignal: signal } : {}),
              });
            } catch {
              // The adapter never throws on provider-shaped outcomes; an
              // unexpected throw still settles to the no-evidence path without
              // breaking the search chain or spending.
              coverages.push(
                researchCoverageEntrySchema.parse({
                  slotKey: query.slotKey,
                  kind: "competitor",
                  outcome: "searched_no_usable_evidence" as const,
                  attemptIds: [],
                  acceptedClaimIds: [],
                }),
              );
              // LogContext is a closed allowlist with no projectId/updateId/code:
              // runIds travel as `runId`, slot codes as `errorCode`
              // (Task 2 applied the same narrowing; logger.ts is out of scope).
              logger.warn("growth_intelligence.monitoring_agent_slot_no_evidence", {
                organizationId: parsed.data.organizationId,
                runId: "",
                errorCode: "AGENT_RUN_FAILED",
              });
              continue;
            }
            if (outcome.status === "ok") {
              const source = agentDataToSource({
                url: target.url,
                data: outcome.data,
                retrievedAt: now().toISOString(),
              });
              if (source) {
                retrieved = [...retrieved, source];
                if (!sourceSlotByUrl.has(source.sourceUrl)) {
                  sourceSlotByUrl.set(source.sourceUrl, query.slotKey);
                }
                coverages.push(
                  researchCoverageEntrySchema.parse({
                    slotKey: query.slotKey,
                    kind: "competitor",
                    outcome: "supported" as const,
                    attemptIds: [],
                    acceptedClaimIds: [],
                  }),
                );
                logger.info("growth_intelligence.monitoring_agent_slot_ok", {
                  organizationId: parsed.data.organizationId,
                  runId: outcome.runId,
                });
              } else {
                coverages.push(
                  researchCoverageEntrySchema.parse({
                    slotKey: query.slotKey,
                    kind: "competitor",
                    outcome: "searched_no_usable_evidence" as const,
                    attemptIds: [],
                    acceptedClaimIds: [],
                  }),
                );
                logger.warn("growth_intelligence.monitoring_agent_slot_no_evidence", {
                  organizationId: parsed.data.organizationId,
                  runId: outcome.runId,
                  errorCode: "AGENT_UNUSABLE_RESULT",
                });
              }
            } else {
              coverages.push(
                researchCoverageEntrySchema.parse({
                  slotKey: query.slotKey,
                  kind: "competitor",
                  outcome: "searched_no_usable_evidence" as const,
                  attemptIds: [],
                  acceptedClaimIds: [],
                }),
              );
              logger.warn("growth_intelligence.monitoring_agent_slot_no_evidence", {
                organizationId: parsed.data.organizationId,
                runId: outcome.runId,
                errorCode: outcome.code ?? "AGENT_BLOCKED",
              });
            }
            // Agent slots never touch the search resume chain, attempt usages,
            // or spend: no reservation, no settle, runIds logged for audit.
            continue;
          }
          // No public URL or fields: fall through to Search+Fetch fail-closed.
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
            spender: searchSpender,
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
        spender: extractionSpender,
        modelId: dependencies.extraction.modelId,
        now,
        signal: boundedPhaseSignal(),
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
        spender: reviewSpender,
        modelId: dependencies.supportReview.modelId,
        now,
        signal: boundedPhaseSignal(),
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
        // Retryability follows outage-ness: any slot that did not finish
        // healthy (failed, not_started, skipped_* — never silently absorbed
        // into no_findings) keeps the Retry signal with its precise per-slot
        // coverage. Only a fully searched-but-empty (or judged-but-
        // inadmissible) run lands no_findings.
        const anySlotUnhealthy = coverages.some(
          (entry) => entry.outcome !== "supported" && entry.outcome !== "searched_no_usable_evidence",
        );
        if (extractionIncomplete || reviewInconclusive || anySlotUnhealthy) {
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
 * predicate and transports, with per-call fenced spenders over one shared
 * run-once update reservation, and no brief refs — monitoring runs
 * evidence-only until snapshot staging.
 */
export async function createQualifiedMonitoringResearcher(input: {
  persistence: TinyfishResearchPersistence;
  budget: MonitoringUpdateBudget;
  organizationId: string;
  brief: BriefRevision;
  organizationCountryCode: string | null;
  fetchImpl?: typeof globalThis.fetch;
  agentLaneOptIn?: boolean;
  agentLane?: MonitoringAgentLane | null;
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

  // Agent fallback lane (Task 3): read `agent_lane_opt_in` with the project
  // row fetch. Missing/false keeps today's search-only behavior bit-for-bit.
  // True routes the first 2 competitor slots through `createTinyfishAgentAdapter`;
  // a closed gate or blank key falls back to search-only with no exception.
  // No spend accounting in this slice; runIds are logged for audit.
  let agentLane: MonitoringAgentLane | undefined;
  try {
    const optIn =
      typeof input.agentLaneOptIn === "boolean"
        ? input.agentLaneOptIn
        : await readAgentLaneOptIn(input.persistence, input.organizationId, brief.projectId);
    if (optIn && apiKey.length > 0 && isTinyfishResearchGateOpen()) {
      if (input.agentLane) {
        if (input.agentLane.enabled) agentLane = input.agentLane;
      } else {
        const seam = createTinyfishAgentClientSeam({
          apiKey,
          ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
        });
        agentLane = { enabled: true, runner: createTinyfishAgentAdapter(seam) };
      }
    }
  } catch {
    agentLane = undefined;
  }

  return createMonitoringResearchExecutor({
    ...(agentLane ? { agentLane } : {}),
    availability: { available: true, provider: QUALIFIED_TINYFISH_RESEARCH_PROVIDER },
    brief,
    scope,
    budget: input.budget,
    search: {
      transport: createTinyfishSearchTransport({
        apiKey,
        ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
      }),
      gate: { isAvailable: () => isTinyfishResearchGateOpen() },
    },
    extraction: wireExtraction
      ? {
          transport: createWiredResearchModelTransport({
            modelId: extractionModelId,
            apiKey: modelApiKey,
            logging,
          }),
          budget: monitoringModelBudget("extraction"),
          modelId: extractionModelId,
        }
      : {
          transport: unconfiguredMonitoringModelTransport("extraction"),
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
          budget: monitoringModelBudget("support_review"),
          modelId: reviewModelId,
        }
      : {
          transport: unconfiguredMonitoringModelTransport("support_review"),
          budget: monitoringModelBudget("support_review"),
          modelId:
            reviewModelId.trim().length > 0 ? reviewModelId : "unconfigured-review-model",
        },
    now: () => new Date(),
  });
}
