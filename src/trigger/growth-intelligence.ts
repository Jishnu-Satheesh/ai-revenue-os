import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger, queue, schedules, schemaTask, tasks } from "@trigger.dev/sdk";
import { z } from "zod";

import { createEventPublisher } from "@/domain/events/publisher";
import { briefRevisionSchema } from "@/domain/growth-intelligence/brief";
import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import { RESEARCH_BUDGET_LIMITS } from "@/domain/growth-intelligence/research-pipeline";
import {
  RESEARCH_MODEL_CALL_LIMITS,
  RESEARCH_MODEL_MAX_SOURCES_PER_BATCH,
} from "@/domain/growth-intelligence/research-budget";
import { marketProfileDocumentSchema } from "@/domain/growth-intelligence/schemas";
import type {
  MarketProfileDocumentV1,
  MarketProfileDocumentV2,
} from "@/domain/growth-intelligence/types";
import { DomainError } from "@/lib/errors";
import type { Database } from "@/lib/supabase/database.types";
import { createGrowthIntelligenceWorkerServiceClient } from "@/lib/supabase/service";
import {
  buildResearchQueryPlan,
  buildResearchQuerySlots,
  type ResearchQuery,
} from "@/modules/growth-intelligence/infrastructure/research/query-plan";
import {
  researchRequestSchema,
  researchRetrievalResultSchema,
  type ResearchAdapter,
  type ResearchRequest,
} from "@/modules/growth-intelligence/infrastructure/research/ports";
import { QUALIFIED_TINYFISH_RESEARCH_PROVIDER } from "@/modules/growth-intelligence/infrastructure/research/qualified-provider";
import { createResearchBudgetRepository } from "@/modules/growth-intelligence/infrastructure/research/budget-repository";
import {
  digestClaimCandidate,
  extractResearchClaims,
  resolveClaimFreshnessWindow,
  resolveFreshnessClass,
  type ResearchModelSpender,
  type ResearchModelTransport,
} from "@/modules/growth-intelligence/infrastructure/research/claim-extraction";
import {
  buildCorroborationLinks,
  reviewResearchClaimSupport,
  selectAdmissibleClaims,
} from "@/modules/growth-intelligence/infrastructure/research/claim-support-review";
import {
  createMarketEvidenceRepository,
  type MarketEvidencePersistence,
} from "@/modules/growth-intelligence/infrastructure/evidence-repository";
import {
  createSynthesisRepository,
  type SynthesisPersistence,
} from "@/modules/growth-intelligence/infrastructure/synthesis-repository";
import {
  createSynthesisProvider,
  parseSynthesisOutput,
  toCompactSynthesisInput,
  SYNTHESIS_MODEL_VERSION,
} from "@/modules/growth-intelligence/infrastructure/synthesis-provider";
import {
  createSynthesisService,
  type ExistingSynthesisItem,
  type SynthesisApprovedGoal,
  type SynthesisBusinessFinding,
  type SynthesisEvidenceWindow,
  type SynthesisFindingCoverage,
  type SynthesisMarketClaim,
} from "@/modules/growth-intelligence/application/synthesis-service";
import {
  createMonitoringResearchBriefBuilder,
  createMonitoringSynthesisContextBuilder,
} from "@/modules/growth-intelligence/application/market-monitoring-context";
import {
  MONITORING_UPDATE_TASK_MAX_DURATION_S,
  type MonitoringUpdateStore,
  type MonitoringUpdateTerminalStage,
} from "@/modules/growth-intelligence/application/market-monitoring-update";
import { createAuthenticatedResearchProjectRepository } from "@/modules/growth-intelligence/infrastructure/research-project-repository";
import {
  createPinReadMonitoringUpdateStore,
  marketMonitoringUpdatePayloadSchema,
  runMarketMonitoringUpdate,
  type MonitoringUpdateLifecycleHooks,
} from "@/workflows/growth-intelligence/run-market-monitoring-update";
import {
  consolidateMarketEvidence,
  consolidationPayloadSchema,
} from "@/workflows/growth-intelligence/consolidate-market-evidence";
import {
  dispatchDuePayloadSchema,
  dispatchDueWork,
} from "@/workflows/growth-intelligence/dispatch-due-work";
import {
  enqueueDueMonitoringUpdates,
  orderDueMonitoringProjectsFairly,
  type DueMonitoringProject,
} from "@/workflows/growth-intelligence/market-monitoring-dispatch";
import {
  marketResearchPayloadSchema,
  runMarketResearch,
  type ApprovedMarketProfileView,
  type GrowthIntelligenceRequestView,
  type MarketResearchClaim,
} from "@/workflows/growth-intelligence/run-market-research";
import {
  runSynthesis,
  synthesisPayloadSchema,
} from "@/workflows/growth-intelligence/run-synthesis";
import {
  chunkIdentifiers,
  selectBranchFindings,
  SYNTHESIS_CLAIM_ID_READ_BATCH_SIZE,
  SYNTHESIS_FINDING_LOADER_LIMIT,
  toEligibleMarketClaims,
} from "@/trigger/synthesis-loaders";
import {
  createQualifiedTinyfishResearchAdapter,
  type TinyfishResearchPersistence,
} from "@/trigger/growth-intelligence-tinyfish";
import { createQualifiedMonitoringResearcher } from "@/trigger/growth-intelligence-monitoring-research";
import {
  createFencedResearchModelSpender,
  createSharedResearchRequestBudget,
  createWiredResearchModelTransport,
  isResearchModelGateOpen,
  readResearchModelApiKey,
  readResearchModelId,
  shouldWireResearchModelPhase,
} from "@/trigger/growth-intelligence-research-models";

const retry = {
  maxAttempts: 3,
  minTimeoutInMs: 1_000,
  maxTimeoutInMs: 30_000,
  factor: 2,
} as const;

/**
 * Lease-bounded queue for Growth Intelligence work. The Trigger queue limits
 * worker concurrency while the database claim token and lease stay
 * authoritative for replay, cancellation, and stale-worker fencing.
 */
export const growthIntelligenceQueue = queue({
  name: "growth-intelligence",
  concurrencyLimit: 1,
});

type WorkerClient = SupabaseClient<Database>;

function claimOutcome(data: unknown): { outcome: string; replayed: boolean } {
  const record = (data ?? {}) as Record<string, unknown>;
  return {
    outcome: typeof record.outcome === "string" ? record.outcome : "unknown",
    replayed: record.replayed === true,
  };
}

function createRequestOperations(supabase: WorkerClient): MarketResearchClaim {
  return {
    async claim(input) {
      const { data, error } = await supabase.rpc("claim_growth_intelligence_request", {
        p_organization_id: input.organizationId,
        p_request_id: input.requestId,
        p_claim_token: input.claimToken,
        p_lease_seconds: input.leaseSeconds,
      });
      if (error) throw new Error("Growth Intelligence request claim failed.");
      return claimOutcome(data);
    },
    async complete(input) {
      const { data, error } = await supabase.rpc("complete_growth_intelligence_request", {
        p_organization_id: input.organizationId,
        p_request_id: input.requestId,
        p_claim_token: input.claimToken,
      });
      if (error) throw new Error("Growth Intelligence request completion failed.");
      return claimOutcome(data);
    },
    async fail(input) {
      const { data, error } = await supabase.rpc("fail_growth_intelligence_request", {
        p_organization_id: input.organizationId,
        p_request_id: input.requestId,
        p_claim_token: input.claimToken,
        p_safe_failure_code: input.safeFailureCode,
      });
      if (error) throw new Error("Growth Intelligence request failure failed.");
      return claimOutcome(data);
    },
    async load(input): Promise<GrowthIntelligenceRequestView | null> {
      const { data, error } = await supabase
        .from("growth_intelligence_requests")
        .select(
          "id, organization_id, branch_id, channel_id, kind, trigger_reason, business_evidence_digest, market_profile_version_id, source_policy_digest, research_rule_version, local_time_bucket, correlation_id, pipeline_id, phase",
        )
        .eq("organization_id", input.organizationId)
        .eq("id", input.requestId)
        .maybeSingle();
      if (error) throw new Error("Growth Intelligence request could not be loaded.");
      if (!data) return null;
      return {
        id: data.id,
        organizationId: data.organization_id,
        branchId: data.branch_id,
        channelId: data.channel_id,
        kind: data.kind,
        triggerReason: data.trigger_reason,
        businessEvidenceDigest: data.business_evidence_digest,
        marketProfileVersionId: data.market_profile_version_id,
        sourcePolicyDigest: data.source_policy_digest,
        researchRuleVersion: data.research_rule_version,
        localTimeBucket: data.local_time_bucket,
        correlationId: data.correlation_id,
        pipelineId: data.pipeline_id,
        phase: data.phase,
      };
    },
    async enqueue(input) {
      const { data, error } = await supabase.rpc("enqueue_growth_intelligence_request", {
        p_organization_id: input.organizationId,
        p_request: input.request,
      });
      if (error) throw new Error("Growth Intelligence reassessment could not be enqueued.");
      const record = (data ?? {}) as Record<string, unknown>;
      if (typeof record.requestId !== "string") {
        throw new Error("Growth Intelligence enqueue returned an unusable outcome.");
      }
      return { requestId: record.requestId, replayed: record.replayed === true };
    },
  };
}

async function readApprovedProfile(
  supabase: WorkerClient,
  organizationId: string,
  branchId: string | null = null,
): Promise<ApprovedMarketProfileView | null> {
  // Exact scope only: a set branch reads its own profile, null reads the
  // legacy organization profile. Never read by organization alone — the first
  // branch row in an organization would make maybeSingle() throw. Both
  // workers thread their request branch through here.
  let profileQuery = supabase
    .from("organization_market_profiles")
    .select("id, current_version_id, enabled")
    .eq("organization_id", organizationId);
  profileQuery =
    branchId === null ? profileQuery.is("branch_id", null) : profileQuery.eq("branch_id", branchId);
  const { data: profile, error: profileError } = await profileQuery.maybeSingle();
  if (profileError) throw new Error("The Market Profile could not be loaded.");
  if (!profile || !profile.current_version_id) return null;
  const { data: version, error: versionError } = await supabase
    .from("organization_market_profile_versions")
    .select("id, profile_digest, profile_document, source_policy_digest")
    .eq("organization_id", organizationId)
    .eq("id", profile.current_version_id)
    .maybeSingle();
  if (versionError) throw new Error("The Market Profile version could not be loaded.");
  if (!version) return null;
  return {
    versionId: version.id,
    digest: version.profile_digest,
    // Union parser: branch rows persist v2 documents, legacy rows v1. The
    // research scope builder below accepts both; synthesis reads only the
    // shared identity/geography/topic blocks, so it never assumes v1.
    document: marketProfileDocumentSchema.parse(version.profile_document),
    sourcePolicyDigest: version.source_policy_digest,
    enabled: profile.enabled,
  };
}

/**
 * Terminal claim-event types for the consolidation current-state rollup.
 * Mirrors `public.market_evidence_claim_current_state`: a claim whose latest
 * event is withdrawn, excluded, corrected/superseded, or expired is no longer
 * current. `observed` is the only non-terminal event.
 */
const TERMINAL_CLAIM_EVENT_TYPES = new Set([
  "expired",
  "withdrawn",
  "excluded",
  "corrected",
  "superseded",
]);

// Mirrors the research worker's adapter bounds in
// `src/workflows/growth-intelligence/run-market-research.ts`: the scope carries
// the timeout and budget caps the adapter must enforce.
const RESEARCH_ADAPTER_TIMEOUT_MS = 20_000;
const RESEARCH_RUN_BUDGET_MICROS_USD = RESEARCH_BUDGET_LIMITS.maxPipelineReservationMicrosUsd;

export function buildResearchScope(
  document: MarketProfileDocumentV1 | MarketProfileDocumentV2,
): ResearchRequest {
  const city = document.geographies.find((geography) => geography.layer === "city");
  const country = document.geographies.find((geography) => geography.layer === "country");
  const location = city ?? country;
  if (!location || !("countryCode" in location)) {
    throw new DomainError("DOMAIN_ERROR", "The approved profile has no usable city or country.");
  }
  const scope = {
    publicBusinessName: document.publicIdentity.approvedName,
    approvedDomains: document.publicIdentity.domains,
    niches: document.nicheDescriptors,
    city: location.name,
    countryCode: location.countryCode,
    topics: document.topics.map((topic) => topic.label),
    competitors: document.competitors.map((competitor) => ({
      name: competitor.name,
      ...(competitor.publicUrl ? { publicUrl: competitor.publicUrl } : {}),
      ...("locationHint" in competitor && competitor.locationHint
        ? { locationHint: competitor.locationHint }
        : {}),
    })),
  };
  // The full-coverage slot plan is authoritative: the request carries one
  // query per slot so the legacy bounded wrapper below cannot truncate
  // topics or competitors back to a first-N subset.
  const slotCount = buildResearchQuerySlots({
    scope,
    maxResultsPerQuery: RESEARCH_BUDGET_LIMITS.maxResultsPerQuery,
  }).length;
  return researchRequestSchema.parse({
    scope,
    maxQueries: slotCount,
    maxResultsPerQuery: RESEARCH_BUDGET_LIMITS.maxResultsPerQuery,
    maxResponseBytes: RESEARCH_BUDGET_LIMITS.maxResponseBytes,
    maxRedirects: 0,
    timeoutMs: RESEARCH_ADAPTER_TIMEOUT_MS,
    maxCostMicrosUsd: RESEARCH_RUN_BUDGET_MICROS_USD,
  });
}

function planResearchQueries(request: ResearchRequest): ResearchQuery[] {
  return buildResearchQueryPlan({
    scope: request.scope,
    maxQueries: request.maxQueries,
    maxResultsPerQuery: request.maxResultsPerQuery,
  });
}

/**
 * Fail-closed model transport: no model calls leave the worker until a
 * qualified extraction/review transport is configured. Refusals surface as
 * failed batches with honest unknown-cost accounting inside extraction and
 * support review — never as worker throws, so Trigger cannot redeliver a
 * run that simply has no model wired yet.
 */
function unconfiguredResearchModelTransport(phase: string): ResearchModelTransport {
  return {
    async complete() {
      throw new DomainError(
        "INTEGRATION_ERROR",
        `Market research ${phase} is not configured for this organization.`,
      );
    },
  };
}

/**
 * Fail-closed model spender: without a per-run budget scope no reservation
 * can be admitted, so every batch fails before any paid call. Extraction
 * and support review catch reserve refusals and fail their batch.
 */
function unconfiguredResearchModelSpender(): ResearchModelSpender {
  return {
    async reserve() {
      throw new GrowthIntelligenceError(
        "RESEARCH_PROVIDER_NOT_QUALIFIED",
        "Market research model spend is not qualified for this organization.",
      );
    },
    async settle() {},
  };
}

function researchModelBudget(phase: "extraction" | "support_review") {
  return {
    phase,
    maxCalls: RESEARCH_MODEL_CALL_LIMITS[phase].maxCalls,
    maxInputTokens: RESEARCH_MODEL_CALL_LIMITS[phase].maxInputTokens,
    maxOutputTokens: RESEARCH_MODEL_CALL_LIMITS[phase].maxOutputTokens,
    maxSourcesPerBatch: RESEARCH_MODEL_MAX_SOURCES_PER_BATCH,
  } as const;
}

function researchModelId(envName: string, fallback: string): string {
  const configured = process.env[envName]?.trim();
  return configured && configured.length > 0 ? configured : fallback;
}

/**
 * Operator-configured excerpt provenance. An empty qualification version
 * keeps the worker's EXTRACTION_UNAVAILABLE gate closed; the retain-until
 * horizon only matters once the gate passes, and the documented agreement
 * value must replace the conservative default.
 */
function triggerExcerptProvenance(): {
  qualificationVersion: string;
  retainUntilFor: (retrievedAt: string) => string;
} {
  const qualificationVersion = process.env.RESEARCH_EXCERPT_QUALIFICATION_VERSION?.trim() ?? "";
  const retentionDays = Number.parseInt(process.env.RESEARCH_EXCERPT_RETENTION_DAYS ?? "", 10);
  const horizonDays = Number.isInteger(retentionDays) && retentionDays > 0 ? retentionDays : 90;
  return {
    qualificationVersion,
    retainUntilFor: (retrievedAt: string) =>
      new Date(new Date(retrievedAt).getTime() + horizonDays * 24 * 3_600_000).toISOString(),
  };
}

async function createResearchDependencies(
  signal: AbortSignal,
  scope: { organizationId: string; requestId: string; correlationId?: string },
) {
  const supabase = createGrowthIntelligenceWorkerServiceClient();
  // The workflow claims the request after dependencies are built and reads
  // its token through newClaimToken below, so the spender records that same
  // token here: reserve_attempt fences spend on the live lease match.
  const spendClaim: { current: string | null } = { current: null };
  const adapter: ResearchAdapter = await createQualifiedTinyfishResearchAdapter({
    persistence: supabase as unknown as TinyfishResearchPersistence,
    organizationId: scope.organizationId,
    requestId: scope.requestId,
    claimToken: () => spendClaim.current,
    signal,
  });
  // Task 2: wire the extraction and support-review model phases behind the
  // existing environment names. The single TinyFish lane kill-switch governs
  // model transports too; a qualified TinyFish lane plus a present Google
  // API key and per-phase model id together authorize the wired pair.
  // Any refusal keeps the fail-closed unconfigured pair, so the phases fail
  // their batches with honest unknown-cost accounting — never a worker
  // throw. Synthesis keeps its existing provider (untouched). Model spend
  // maps to the fenced attempt ledger with phase "research" and the
  // model-phase-namespaced slot keys the runners emit; no migration.
  const laneQualified =
    adapter.availability.available &&
    adapter.availability.provider === QUALIFIED_TINYFISH_RESEARCH_PROVIDER;
  const modelGateOpen = isResearchModelGateOpen();
  const modelApiKey = readResearchModelApiKey();
  const extractionModelIdRaw = readResearchModelId("RESEARCH_EXTRACTION_MODEL");
  const reviewModelIdRaw = readResearchModelId("RESEARCH_SUPPORT_REVIEW_MODEL");
  const modelBudget = createResearchBudgetRepository(
    supabase as unknown as TinyfishResearchPersistence,
  );
  // One shared run-once reservation for both model phases: a run wiring
  // extraction and support review issues a single reserveRequestBudget RPC.
  const sharedModelReservation = createSharedResearchRequestBudget({
    budget: modelBudget,
    organizationId: scope.organizationId,
    requestId: scope.requestId,
  });
  const modelLogging = {
    ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
    ...(scope.correlationId ? { correlationId: scope.correlationId } : {}),
  };
  const wireExtraction = shouldWireResearchModelPhase({
    gateOpen: modelGateOpen,
    laneQualified,
    apiKey: modelApiKey,
    modelId: extractionModelIdRaw,
  });
  const wireReview = shouldWireResearchModelPhase({
    gateOpen: modelGateOpen,
    laneQualified,
    apiKey: modelApiKey,
    modelId: reviewModelIdRaw,
  });
  return {
    newClaimToken: () => {
      const token = randomUUID();
      spendClaim.current = token;
      return token;
    },
    requests: createRequestOperations(supabase),
    profiles: {
      readCurrent: (input: { organizationId: string; branchId?: string | null }) =>
        readApprovedProfile(supabase, input.organizationId, input.branchId ?? null),
    },
    // G23: the research brief builder is always wired. Snapshot loading is
    // not staged and model qualification is off, so production briefs stay
    // evidence-only (unavailable, no refs) while the threading is proven.
    researchBrief: createMonitoringResearchBriefBuilder({
      readProfile: async (input) => {
        const profile = await readApprovedProfile(
          supabase,
          input.organizationId,
          input.branchId,
        );
        if (!profile) return null;
        return {
          profileVersionId: profile.versionId,
          sourcePolicyDigest: profile.sourcePolicyDigest,
          scope: buildResearchScope(profile.document).scope,
        };
      },
      loadSnapshot: async () => null,
      qualified: false,
      planSlots: (scope) =>
        buildResearchQuerySlots({
          scope,
          maxResultsPerQuery: RESEARCH_BUDGET_LIMITS.maxResultsPerQuery,
        }),
    }),
    evidence: createMarketEvidenceRepository(supabase as unknown as MarketEvidencePersistence),
    adapter,
    extraction: wireExtraction
      ? {
          transport: createWiredResearchModelTransport({
            modelId: extractionModelIdRaw,
            apiKey: modelApiKey,
            logging: modelLogging,
          }),
          spender: createFencedResearchModelSpender({
            budget: modelBudget,
            organizationId: scope.organizationId,
            requestId: scope.requestId,
            claimToken: () => spendClaim.current,
            ensureReservation: () => sharedModelReservation.ensure(),
          }),
          budget: researchModelBudget("extraction"),
          modelId: extractionModelIdRaw,
        }
      : {
          transport: unconfiguredResearchModelTransport("extraction"),
          spender: unconfiguredResearchModelSpender(),
          budget: researchModelBudget("extraction"),
          modelId: researchModelId("RESEARCH_EXTRACTION_MODEL", "unconfigured-extraction-model"),
        },
    supportReview: wireReview
      ? {
          transport: createWiredResearchModelTransport({
            modelId: reviewModelIdRaw,
            apiKey: modelApiKey,
            logging: modelLogging,
          }),
          spender: createFencedResearchModelSpender({
            budget: modelBudget,
            organizationId: scope.organizationId,
            requestId: scope.requestId,
            claimToken: () => spendClaim.current,
            ensureReservation: () => sharedModelReservation.ensure(),
          }),
          budget: researchModelBudget("support_review"),
          modelId: reviewModelIdRaw,
        }
      : {
          transport: unconfiguredResearchModelTransport("support_review"),
          spender: unconfiguredResearchModelSpender(),
          budget: researchModelBudget("support_review"),
          modelId: researchModelId("RESEARCH_SUPPORT_REVIEW_MODEL", "unconfigured-review-model"),
        },
    excerptProvenance: triggerExcerptProvenance(),
    // Only Trigger constructs infrastructure implementations: the workflow
    // runner receives these pure claim engines as dependencies and never
    // imports the infrastructure modules itself (architecture boundary).
    engines: {
      parseRetrievalResult: (value: unknown) => researchRetrievalResultSchema.parse(value),
      extractClaims: extractResearchClaims,
      reviewClaimSupport: reviewResearchClaimSupport,
      selectAdmissible: selectAdmissibleClaims,
      buildLinks: buildCorroborationLinks,
      digestCandidate: digestClaimCandidate,
      freshnessWindow: resolveClaimFreshnessWindow,
      freshnessClass: resolveFreshnessClass,
    },
    planQueries: planResearchQueries,
    buildScope: buildResearchScope,
    currentSources: {
      load: async (input: { organizationId: string; profileVersionId: string }) => {
        const { data, error } = await supabase
          .from("market_evidence_sources")
          .select("source_content_digest")
          .eq("organization_id", input.organizationId)
          .eq("market_profile_version_id", input.profileVersionId)
          .eq("availability", "available");
        if (error) throw new Error("Current source digests could not be loaded.");
        return (data ?? [])
          .map((row) => row.source_content_digest)
          .filter((digest): digest is string => digest !== null);
      },
    },
    state: {
      load: async (input: {
        organizationId: string;
        profileVersionId: string;
        localTimeBucket: string;
      }) => {
        const { data: claims, error: claimsError } = await supabase
          .from("market_evidence_claims")
          .select("id")
          .eq("organization_id", input.organizationId)
          .eq("market_profile_version_id", input.profileVersionId);
        if (claimsError) throw new Error("Current claim state could not be loaded.");
        const claimIds = (claims ?? []).map((claim) => claim.id);
        let expiredCount = 0;
        let excludedCount = 0;
        let withdrawnCount = 0;
        let terminalClaimCount = 0;
        if (claimIds.length > 0) {
          const { data: events, error: eventsError } = await supabase
            .from("market_evidence_claim_events")
            .select("market_evidence_claim_id, event_type, occurred_at, created_at, id")
            .eq("organization_id", input.organizationId)
            .in("market_evidence_claim_id", claimIds)
            .order("occurred_at", { ascending: false })
            .order("created_at", { ascending: false })
            .order("id", { ascending: false });
          if (eventsError) throw new Error("Current claim events could not be loaded.");
          // Latest event per claim decides, mirroring
          // market_evidence_claim_current_state (occurred_at, created_at, id).
          const latestByClaim = new Map<string, string>();
          for (const event of events ?? []) {
            if (event.event_type === "expired") expiredCount += 1;
            else if (event.event_type === "excluded") excludedCount += 1;
            else if (event.event_type === "withdrawn") withdrawnCount += 1;
            if (!latestByClaim.has(event.market_evidence_claim_id)) {
              latestByClaim.set(event.market_evidence_claim_id, event.event_type);
            }
          }
          for (const eventType of latestByClaim.values()) {
            if (TERMINAL_CLAIM_EVENT_TYPES.has(eventType)) terminalClaimCount += 1;
          }
        }
        return {
          currentClaimCount: claimIds.length - terminalClaimCount,
          expiredCount,
          excludedCount,
          withdrawnCount,
          changedCount: 0,
        };
      },
    },
    events: createEventPublisher(),
    signal,
  };
}

/**
 * Synthesis branch filter guard: branch ids arrive from the request row, but
 * the findings read interpolates one into an `or` filter string, so a
 * malformed value must fail closed before any query is built.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Synthesis current-state readers. Every table and column read here is
 * verified in `src/lib/supabase/database.types.ts` (organization_market_
 * profiles, organization_market_profile_versions, growth_intelligence_
 * requests, channel_findings, channel_analysis_runs, market_research_runs,
 * market_evidence_claims, market_evidence_claim_events, market_evidence_
 * links, growth_intelligence_items) or the Task 13 synthesis RPCs. Business
 * findings enter the service through the injected loader seam; the findings
 * implementation selects compact finding identity plus analysis-run
 * lineage, periods, currency, and units only — never raw measures, report
 * payloads, file contents, private records, or transfer links (value_
 * numerator/denominator and monetary impact are not selected). Claims enter
 * with exact organization/profile/branch/research-run lineage. There is no
 * approved-goals table in scope, so the goals loader returns empty until
 * Task 11 binds monthly report lineage (see report).
 */
function createSynthesisDependencies(signal: AbortSignal) {
  const supabase = createGrowthIntelligenceWorkerServiceClient();
  const now = () => new Date();
  const baseSynthesis = createSynthesisRepository(supabase as unknown as SynthesisPersistence);
  const evidence = createMarketEvidenceRepository(supabase as unknown as MarketEvidencePersistence);

  // Pipeline lineage decides which fence persists synthesis. Handoff
  // children (phase synthesis on a pipeline) finalize items, request and
  // pipeline in one transaction; legacy rows keep the separate completion.
  async function pipelineLineage(input: {
    organizationId: string;
    requestId: string;
  }): Promise<{ pipelineId: string; phase: string | null } | null> {
    const { data, error } = await supabase
      .from("growth_intelligence_requests")
      .select("pipeline_id, phase")
      .eq("organization_id", input.organizationId)
      .eq("id", input.requestId)
      .maybeSingle();
    if (error) throw new Error("Synthesis request lineage could not be loaded.");
    if (!data || !data.pipeline_id) return null;
    return { pipelineId: data.pipeline_id, phase: data.phase };
  }

  const synthesis = {
    ...baseSynthesis,
    async complete(
      input: Parameters<typeof baseSynthesis.complete>[0],
    ): Promise<Awaited<ReturnType<typeof baseSynthesis.complete>>> {
      const lineage = await pipelineLineage(input);
      if (lineage && lineage.phase === "synthesis") {
        const finalized = await evidence.completeSynthesisPipeline({
          organizationId: input.organizationId,
          requestId: input.requestId,
          claimToken: input.claimToken,
          runId: input.runId,
          result: {
            outcome: "completed",
            resultDigest: input.result.resultDigest,
            items: input.result.items,
          },
        });
        return {
          runId: finalized.runId,
          status: "completed",
          itemCount: finalized.itemCount,
          supersededItemIds: finalized.supersededItemIds,
        };
      }
      return baseSynthesis.complete(input);
    },
    async fail(
      input: Parameters<typeof baseSynthesis.fail>[0],
    ): Promise<Awaited<ReturnType<typeof baseSynthesis.fail>>> {
      const lineage = await pipelineLineage(input);
      if (lineage && lineage.phase === "synthesis") {
        const failed = await evidence.failSynthesisPipeline({
          organizationId: input.organizationId,
          requestId: input.requestId,
          claimToken: input.claimToken,
          runId: input.runId,
          failureCode: input.failure.safeFailureCode,
        });
        return { runId: failed.runId, status: "failed" };
      }
      return baseSynthesis.fail(input);
    },
  };

  const findings = {
    load: async (input: {
      organizationId: string;
      branchId: string | null;
      channelId: string | null;
      evidenceWindow: SynthesisEvidenceWindow | null;
    }): Promise<{
      findings: SynthesisBusinessFinding[];
      fresh: boolean;
      coverage: SynthesisFindingCoverage;
    }> => {
      // Exact branch scope at the database: the request branch plus
      // organization-wide rows (the selector labels those broader context).
      // Other named branches never load — a missing branch yields a gap,
      // never cross-branch fallback. The branch id is UUID-shaped by
      // construction (request row column), and re-checked here so a
      // malformed value fails closed instead of breaking the filter string.
      if (input.branchId !== null && !UUID_PATTERN.test(input.branchId)) {
        throw new Error("Current business findings could not be loaded.");
      }
      let query = supabase
        .from("channel_findings")
        .select(
          "id, detector_key, code, severity, calculation_digest, quality_state, status, kind, channel_id, branch_id, analysis_run_id, period_start, period_end, currency, value_kind, limitations",
        )
        .eq("organization_id", input.organizationId)
        .eq("status", "open")
        .eq("kind", "finding")
        // Deterministic window: id-ordered at the database so the 200-row
        // cap keeps the same rows the in-memory id-sort would select first.
        .order("id", { ascending: true })
        .limit(SYNTHESIS_FINDING_LOADER_LIMIT);
      query =
        input.branchId === null
          ? query.is("branch_id", null)
          : query.or(`branch_id.eq.${input.branchId},branch_id.is.null`);
      if (input.channelId) query = query.eq("channel_id", input.channelId);
      const { data, error } = await query;
      if (error) throw new Error("Current business findings could not be loaded.");
      const rows = data ?? [];
      // Analysis-run lineage arrives in one batched read: only completed
      // runs whose scope agrees with the finding scope admit findings.
      const runIds = [...new Set(rows.map((row) => row.analysis_run_id))];
      const runsById = new Map<
        string,
        { status: string; branch_id: string | null; channel_id: string | null }
      >();
      for (const batch of chunkIdentifiers(runIds, SYNTHESIS_CLAIM_ID_READ_BATCH_SIZE)) {
        const { data: runs, error: runsError } = await supabase
          .from("channel_analysis_runs")
          .select("id, status, branch_id, channel_id")
          .eq("organization_id", input.organizationId)
          .in("id", batch);
        if (runsError) throw new Error("Current analysis runs could not be loaded.");
        for (const run of runs ?? []) runsById.set(run.id, run);
      }
      const scoped = rows.map((row) => {
        const run = runsById.get(row.analysis_run_id);
        return {
          ...row,
          run_status: run?.status ?? null,
          run_branch_id: run ? run.branch_id : null,
          run_channel_id: run ? run.channel_id : null,
        };
      });
      return selectBranchFindings(scoped, {
        organizationId: input.organizationId,
        branchId: input.branchId,
        channelId: input.channelId,
        evidenceWindow: input.evidenceWindow,
      });
    },
  };

  const claims = {
    load: async (input: {
      organizationId: string;
      profileVersionId: string;
      branchId: string | null;
    }): Promise<SynthesisMarketClaim[]> => {
      const { data, error } = await supabase
        .from("market_evidence_claims")
        .select(
          "id, claim_digest, paraphrase, quotation, geographic_layer, geography_ref, market_research_run_id, stale_at, expires_at, limitations",
        )
        .eq("organization_id", input.organizationId)
        .eq("market_profile_version_id", input.profileVersionId)
        // Deterministic window, same reason as the findings read above.
        .order("id", { ascending: true })
        .limit(SYNTHESIS_FINDING_LOADER_LIMIT);
      if (error) throw new Error("Current market claims could not be loaded.");
      const rows = data ?? [];
      if (rows.length === 0) return [];
      // Research lineage in batched reads: research run to request to exact
      // branch. Claims whose run researched another branch are excluded by
      // the selector below, never synthesized.
      const runIds = [...new Set(rows.map((row) => row.market_research_run_id))];
      const requestIdsByRun = new Map<string, string>();
      for (const batch of chunkIdentifiers(runIds, SYNTHESIS_CLAIM_ID_READ_BATCH_SIZE)) {
        const { data: runs, error: runsError } = await supabase
          .from("market_research_runs")
          .select("id, growth_intelligence_request_id")
          .eq("organization_id", input.organizationId)
          .in("id", batch);
        if (runsError) throw new Error("Current research runs could not be loaded.");
        for (const run of runs ?? []) {
          requestIdsByRun.set(run.id, run.growth_intelligence_request_id);
        }
      }
      const requestIds = [...new Set(requestIdsByRun.values())];
      const branchByRequest = new Map<string, string | null>();
      for (const batch of chunkIdentifiers(requestIds, SYNTHESIS_CLAIM_ID_READ_BATCH_SIZE)) {
        const { data: requests, error: requestsError } = await supabase
          .from("growth_intelligence_requests")
          .select("id, branch_id")
          .eq("organization_id", input.organizationId)
          .in("id", batch);
        if (requestsError) throw new Error("Current synthesis requests could not be loaded.");
        for (const request of requests ?? []) branchByRequest.set(request.id, request.branch_id);
      }
      const claimIds = rows.map((row) => row.id);
      const events: Array<{ market_evidence_claim_id: string; event_type: string }> = [];
      for (const batch of chunkIdentifiers(claimIds, SYNTHESIS_CLAIM_ID_READ_BATCH_SIZE)) {
        const { data: batchEvents, error: eventsError } = await supabase
          .from("market_evidence_claim_events")
          .select("market_evidence_claim_id, event_type")
          .eq("organization_id", input.organizationId)
          .in("market_evidence_claim_id", batch);
        if (eventsError) throw new Error("Current claim events could not be loaded.");
        events.push(...(batchEvents ?? []));
      }
      const links: Array<{ market_evidence_claim_id: string; relation: string }> = [];
      for (const batch of chunkIdentifiers(claimIds, SYNTHESIS_CLAIM_ID_READ_BATCH_SIZE)) {
        const { data: batchLinks, error: linksError } = await supabase
          .from("market_evidence_links")
          .select("market_evidence_claim_id, relation")
          .eq("organization_id", input.organizationId)
          .in("market_evidence_claim_id", batch);
        if (linksError) throw new Error("Current claim links could not be loaded.");
        links.push(...(batchLinks ?? []));
      }
      return toEligibleMarketClaims({
        rows: rows.map((row) => {
          const requestId = requestIdsByRun.get(row.market_research_run_id);
          return {
            ...row,
            run_branch_id: requestId ? (branchByRequest.get(requestId) ?? null) : null,
          };
        }),
        events,
        links,
        scope: {
          organizationId: input.organizationId,
          profileVersionId: input.profileVersionId,
          branchId: input.branchId,
        },
        nowMs: now().getTime(),
      });
    },
  };

  const goals = {
    load: async (_input: { organizationId: string }): Promise<SynthesisApprovedGoal[]> => {
      return [];
    },
  };

  const existingItems = {
    load: async (input: { organizationId: string }): Promise<ExistingSynthesisItem[]> => {
      const { data, error } = await supabase
        .from("growth_intelligence_items")
        .select("id, kind, geographic_layer, geography_ref, item_fingerprint, evidence_fingerprint")
        .eq("organization_id", input.organizationId)
        .eq("status", "current")
        .limit(SYNTHESIS_FINDING_LOADER_LIMIT);
      if (error) throw new Error("Current synthesis items could not be loaded.");
      return (data ?? []).map((row) => ({
        id: row.id,
        kind: row.kind,
        geographicLayer: row.geographic_layer,
        geographyRef: row.geography_ref,
        itemFingerprint: row.item_fingerprint,
        evidenceFingerprint: row.evidence_fingerprint,
      }));
    },
  };

  const service = createSynthesisService({
    findings,
    claims,
    goals,
    existingItems,
    provider: createSynthesisProvider(),
    synthesisVersion: SYNTHESIS_MODEL_VERSION,
    buildCompactInput: toCompactSynthesisInput,
    parseOutput: parseSynthesisOutput,
    synthesis,
    events: createEventPublisher(),
    now,
    signal,
  });

  return {
    requests: createRequestOperations(supabase),
    profiles: {
      readCurrent: (input: { organizationId: string; branchId?: string | null }) =>
        readApprovedProfile(supabase, input.organizationId, input.branchId ?? null),
    },
    synthesize: (synthesisInput: Parameters<typeof service.synthesize>[0]) =>
      service.synthesize(synthesisInput),
    // G24: the synthesis context builder wires only when snapshot loading is
    // configured. The pack schema has no null representation for manifest and
    // digest, so an unwired factory keeps legacy pack-less behavior instead
    // of fabricating lineage.
    ...(process.env.MONITORING_CONTEXT_SNAPSHOTS_ENABLED === "true"
      ? {
          synthesisContext: createMonitoringSynthesisContextBuilder({
            loadSnapshot: async () => null,
          }),
        }
      : {}),
  };
}

tasks.onCancel(async ({ task: taskId, payload }) => {
  if (
    taskId !== "growth-intelligence.run-market-research" &&
    taskId !== "growth-intelligence.consolidate-market-evidence" &&
    taskId !== "growth-intelligence.dispatch-due" &&
    taskId !== "growth-intelligence.run-synthesis" &&
    taskId !== "growth-intelligence.run-market-monitoring-update" &&
    taskId !== "growth-intelligence.monitoring-sweep"
  ) {
    return;
  }
  // Cancellation propagates through the run AbortSignal; the worker maps it
  // to a fenced WORKER_CANCELLED failure under its own claim token. This
  // handler only records which task was cancelled, with identifiers.
  if (taskId === "growth-intelligence.dispatch-due") {
    const parsed = dispatchDuePayloadSchema.parse(payload);
    logger.info("growth_intelligence.dispatch_cancelled", {
      correlationId: parsed.correlationId,
    });
    return;
  }
  if (taskId === "growth-intelligence.consolidate-market-evidence") {
    const parsed = consolidationPayloadSchema.parse(payload);
    logger.info("growth_intelligence.run_cancelled", {
      organizationId: parsed.organizationId,
      correlationId: parsed.correlationId,
      requestId: parsed.requestId,
    });
    return;
  }
  if (taskId === "growth-intelligence.run-synthesis") {
    const parsed = synthesisPayloadSchema.parse(payload);
    logger.info("growth_intelligence.run_cancelled", {
      organizationId: parsed.organizationId,
      correlationId: parsed.correlationId,
      requestId: parsed.requestId,
    });
    return;
  }
  if (taskId === "growth-intelligence.monitoring-sweep") {
    logger.info("growth_intelligence.monitoring_sweep_cancelled", {});
    return;
  }
  if (taskId === "growth-intelligence.run-market-monitoring-update") {
    const parsed = marketMonitoringUpdatePayloadSchema.parse(payload);
    logger.info("growth_intelligence.run_cancelled", {
      organizationId: parsed.organizationId,
      correlationId: parsed.correlationId,
      updateId: parsed.updateId,
    });
    // Durable cancel without the run's lease token: the privileged cancel
    // RPC settles only non-terminal rows, so a cross-run refresh starts
    // fresh and a late cancel never rewrites a settled update. Best
    // effort: the lease still fences rivals until it expires.
    try {
      const supabase = createGrowthIntelligenceWorkerServiceClient();
      await supabase.rpc("cancel_monitoring_update", {
        p_organization_id: parsed.organizationId,
        p_actor_id: parsed.actorId,
        p_update_id: parsed.updateId,
        p_reason_code: "WORKER_CANCELLED",
      });
    } catch {
      return;
    }
    return;
  }
  const parsed = marketResearchPayloadSchema.parse(payload);
  logger.info("growth_intelligence.run_cancelled", {
    organizationId: parsed.organizationId,
    correlationId: parsed.correlationId,
    requestId: parsed.requestId,
  });
});

export const runMarketResearchTask = schemaTask({
  id: "growth-intelligence.run-market-research",
  schema: marketResearchPayloadSchema,
  queue: growthIntelligenceQueue,
  retry,
  maxDuration: 300,
  run: async (payload, { signal }) => {
    const parsed = marketResearchPayloadSchema.parse(payload);
    const dependencies = await createResearchDependencies(signal, {
      organizationId: parsed.organizationId,
      requestId: parsed.requestId,
      correlationId: parsed.correlationId,
    });
    const result = await runMarketResearch(parsed, dependencies);

    logger.info("growth_intelligence.research_finished", {
      organizationId: parsed.organizationId,
      correlationId: parsed.correlationId,
      requestId: parsed.requestId,
      outcome: result.outcome,
    });

    return result;
  },
});

export const consolidateMarketEvidenceTask = schemaTask({
  id: "growth-intelligence.consolidate-market-evidence",
  schema: consolidationPayloadSchema,
  queue: growthIntelligenceQueue,
  retry,
  maxDuration: 300,
  run: async (payload, { signal }) => {
    const parsed = consolidationPayloadSchema.parse(payload);
    const dependencies = await createResearchDependencies(signal, {
      organizationId: parsed.organizationId,
      requestId: parsed.requestId,
      correlationId: parsed.correlationId,
    });
    const result = await consolidateMarketEvidence(parsed, dependencies);

    logger.info("growth_intelligence.consolidation_finished", {
      organizationId: parsed.organizationId,
      correlationId: parsed.correlationId,
      requestId: parsed.requestId,
      outcome: result.outcome,
    });

    return result;
  },
});

export const runSynthesisTask = schemaTask({
  id: "growth-intelligence.run-synthesis",
  schema: synthesisPayloadSchema,
  queue: growthIntelligenceQueue,
  retry,
  maxDuration: 300,
  run: async (payload, { signal }) => {
    const parsed = synthesisPayloadSchema.parse(payload);
    const dependencies = createSynthesisDependencies(signal);
    const result = await runSynthesis(parsed, dependencies);

    logger.info("growth_intelligence.synthesis_finished", {
      organizationId: parsed.organizationId,
      correlationId: parsed.correlationId,
      requestId: parsed.requestId,
      outcome: result.outcome,
    });

    return result;
  },
});

/**
 * Organization country for the monitoring researcher's model-phase scope.
 * Tenant-pinned read on the worker client; missing, malformed, or unreadable
 * resolves to null and the executor fails closed — geography is never
 * invented, because the brief carries no country of its own.
 */
async function readMonitoringOrganizationCountry(
  supabase: WorkerClient,
  organizationId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("organizations")
      .select("country_code")
      .eq("id", organizationId)
      .maybeSingle();
    if (error || !data || typeof data.country_code !== "string") return null;
    return data.country_code;
  } catch {
    return null;
  }
}

/**
 * Narrow tenant-validating worker reads for update convergence. Every query
 * pins the organization id; writes go through the fenced RPCs, which
 * re-verify tenant bindings server-side.
 */
function createMonitoringUpdateStore(supabase: WorkerClient): MonitoringUpdateStore {
  return createPinReadMonitoringUpdateStore(
    {
      listRevisionPins: async (input) => {
        const { data, error } = await supabase
          .from("growth_intelligence_brief_revisions")
          .select("id, revision_number, pinned_to_update_id")
          .eq("organization_id", input.organizationId)
          .eq("project_id", input.projectId)
          .order("revision_number", { ascending: false })
          .limit(50);
        if (error) throw new Error("Monitoring update pins could not be loaded.");
        return (data ?? []).map((row) => ({
          revisionId: row.id,
          revisionNumber: row.revision_number,
          pinnedToUpdateId: row.pinned_to_update_id,
        }));
      },
      listReportRevisions: async (input) => {
        const { data, error } = await supabase
          .from("growth_intelligence_reports")
          .select("brief_revision_id, report_version_id")
          .eq("organization_id", input.organizationId)
          .eq("project_id", input.projectId)
          .limit(50);
        if (error) throw new Error("Monitoring report revisions could not be loaded.");
        return (data ?? []).map((row) => ({
          briefRevisionId: row.brief_revision_id,
          reportVersionId: row.report_version_id,
        }));
      },
      findPinByUpdateId: async (input) => {
        const { data, error } = await supabase
          .from("growth_intelligence_brief_revisions")
          .select("project_id, id, revision_number")
          .eq("organization_id", input.organizationId)
          .eq("pinned_to_update_id", input.updateId)
          .order("revision_number", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw new Error("Monitoring update pin could not be loaded.");
        if (!data) return null;
        return {
          projectId: data.project_id,
          revisionId: data.id,
          revisionNumber: data.revision_number,
        };
      },
      listTerminalUpdates: async (input) => {
        // Durable lifecycle rows settle every terminal exactly (ready,
        // partial, cancelled, failed), so cross-run refresh-after-cancel
        // starts fresh and reported pins replay their true stage instead
        // of the conservative-ready approximation.
        const { data, error } = await supabase
          .from("growth_intelligence_monitoring_updates")
          .select("update_id, stage")
          .eq("organization_id", input.organizationId)
          .eq("project_id", input.projectId)
          .in("stage", [
            "ready",
            "partial",
            "empty",
            "no_findings",
            "research_failed",
            "synthesis_failed",
            "cancelled",
          ])
          .limit(50);
        if (error) throw new Error("Monitoring lifecycle terminals could not be loaded.");
        return (data ?? [])
          .filter((row) =>
            (
              [
                "ready",
                "partial",
                "empty",
                "no_findings",
                "research_failed",
                "synthesis_failed",
                "cancelled",
              ] as readonly string[]
            ).includes(row.stage),
          )
          .map((row) => ({
            updateId: row.update_id,
            stage: row.stage as MonitoringUpdateTerminalStage,
          }));
      },
    },
    () => new Date(),
  );
}

/**
 * Durable lifecycle hooks for the monitoring update worker (Slice 7). Open
 * reserves the lifecycle row with the G45 lease before paid work; settle
 * writes the exact terminal stage after the run-local store marks it. Both
 * are short fenced transactions — research and composition always run
 * outside any lock — and the lease token fences rival runs off the update.
 */
function createMonitoringLifecycleHooks(supabase: WorkerClient): MonitoringUpdateLifecycleHooks {
  return {
    async open(input) {
      const { data, error } = await supabase.rpc("open_monitoring_update", {
        p_organization_id: input.organizationId,
        p_actor_id: input.actorId,
        p_project_id: input.projectId,
        p_update_id: input.updateId,
        p_brief_revision_id: input.briefRevisionId,
        p_lease_token: input.leaseToken,
        p_lease_seconds: input.leaseSeconds,
      });
      if (error) throw new Error("Monitoring update open failed.");
      const record = (data ?? {}) as Record<string, unknown>;
      return {
        stage: typeof record.stage === "string" ? record.stage : "queued",
        attempts: typeof record.attempts === "number" ? record.attempts : 1,
        replayed: record.replayed === true,
      };
    },
    async settle(input) {
      const { data, error } = await supabase.rpc("settle_monitoring_update", {
        p_organization_id: input.organizationId,
        p_actor_id: input.actorId,
        p_update_id: input.updateId,
        p_stage: input.stage,
        p_reason_code: input.reasonCode,
        p_retryable: input.retryable,
        p_coverage: input.coverage ? JSON.parse(JSON.stringify(input.coverage)) : null,
        p_known_cost_micros_usd: input.knownCostMicrosUsd,
        p_unknown_cost_count: input.unknownCostCount,
        p_lease_token: input.leaseToken,
      });
      if (error) throw new Error("Monitoring update settle failed.");
      const record = (data ?? {}) as Record<string, unknown>;
      return { replayed: record.replayed === true };
    },
  };
}

/**
 * Sweep bounds: at most 25 starts per pass, at most 5 per organization.
 * The in-memory fairness order is the same function the sweep caller
 * applies, so SQL order and sweep order agree on who runs first.
 */
export const MONITORING_SWEEP_LIMIT = 25;
export const MONITORING_SWEEP_MAX_PER_ORGANIZATION = 5;

/**
 * Due monitoring projects with per-org fairness. Active recurring projects
 * scan oldest-first; one-time projects with still-owed work (active, no
 * report, no terminal update) re-enter so a lost start nudge is recovered
 * instead of stranding the project in Researching forever. Latest brief
 * revisions arrive in one batched read per organization;
 * scope-unparseable projects degrade to scope-blind (the sweep skips them
 * honestly) and actor-less projects are excluded with a count, never
 * fabricated.
 */
export async function listDueMonitoringProjects(
  supabase: WorkerClient,
  input: { limit: number },
): Promise<DueMonitoringProject[]> {
  const cap = Math.min(input.limit * MONITORING_SWEEP_MAX_PER_ORGANIZATION, 200);
  const projectColumns =
    "id, organization_id, branch_id, title, question, mode, schedule, lifecycle, created_by";
  const { data: recurringRows, error: recurringError } = await supabase
    .from("growth_intelligence_research_projects")
    .select(projectColumns)
    .eq("lifecycle", "active")
    .eq("mode", "recurring")
    .not("schedule", "is", null)
    .order("organization_id", { ascending: true })
    .order("updated_at", { ascending: true })
    .limit(cap);
  if (recurringError) throw new Error("Due monitoring projects could not be listed.");
  const { data: oneTimeRows, error: oneTimeError } = await supabase
    .from("growth_intelligence_research_projects")
    .select(projectColumns)
    .eq("lifecycle", "active")
    .eq("mode", "one-time")
    .order("organization_id", { ascending: true })
    .order("updated_at", { ascending: true })
    .limit(cap);
  if (oneTimeError) throw new Error("Due monitoring projects could not be listed.");
  let rows = [...(recurringRows ?? [])];
  const oneTimeCandidates = [...(oneTimeRows ?? [])];
  if (oneTimeCandidates.length > 0) {
    // A completed one-timer must never re-enter: a report row or a terminal
    // lifecycle row means the question was answered, and re-listing it would
    // start fresh research every sweep. Either exclusion read failing closes
    // the one-time lane for this pass only; recurring work is unaffected.
    const oneTimeIds = oneTimeCandidates.map((row) => row.id);
    try {
      const [
        { data: reportRows, error: reportsError },
        { data: terminalRows, error: terminalsError },
      ] = await Promise.all([
          supabase
            .from("growth_intelligence_reports")
            .select("project_id")
            .in("project_id", oneTimeIds)
            .limit(1000),
          supabase
            .from("growth_intelligence_monitoring_updates")
            .select("project_id")
            .in("project_id", oneTimeIds)
            .in("stage", [
              "ready",
              "partial",
              "empty",
              "no_findings",
              "research_failed",
              "synthesis_failed",
              "cancelled",
            ])
            .limit(1000),
        ]);
      if (reportsError || terminalsError) throw new Error("One-time completion reads failed.");
      const completed = new Set([
        ...(reportRows ?? []).map((row) => row.project_id),
        ...(terminalRows ?? []).map((row) => row.project_id),
      ]);
      rows = [...rows, ...oneTimeCandidates.filter((row) => !completed.has(row.id))];
    } catch {
      logger.info("growth_intelligence.monitoring_sweep_one_time_skipped", {
        projects: oneTimeCandidates.length,
      });
    }
  }

  const byOrganization = new Map<string, typeof rows>();
  for (const row of rows ?? []) {
    const list = byOrganization.get(row.organization_id) ?? [];
    list.push(row);
    byOrganization.set(row.organization_id, list);
  }

  const revisionsByProject = new Map<string, unknown>();
  for (const [organizationId, orgRows] of byOrganization) {
    const { data: revisions, error: revisionsError } = await supabase
      .from("growth_intelligence_brief_revisions")
      .select("project_id, document, revision_number")
      .eq("organization_id", organizationId)
      .in(
        "project_id",
        orgRows.map((row) => row.id),
      )
      .order("revision_number", { ascending: false });
    if (revisionsError) throw new Error("Due monitoring briefs could not be loaded.");
    for (const revision of revisions ?? []) {
      if (!revisionsByProject.has(revision.project_id)) {
        revisionsByProject.set(revision.project_id, revision.document);
      }
    }
  }

  const scheduleSchema = z
    .object({
      cadence: z.enum(["daily", "weekly", "monthly"]),
      localTime: z.string(),
      timeZone: z.string(),
      endDate: z.string().optional(),
    })
    .strict();

  let actorUnknown = 0;
  const candidates: DueMonitoringProject[] = [];
  for (const row of rows ?? []) {
    if (!row.created_by) {
      actorUnknown += 1;
      continue;
    }
    const brief = briefRevisionSchema.safeParse(revisionsByProject.get(row.id));
    const schedule = scheduleSchema.safeParse(row.schedule);
    candidates.push({
      organizationId: row.organization_id,
      projectId: row.id,
      branchId: row.branch_id,
      title: row.title,
      question: row.question,
      mode: row.mode === "one-time" ? "one-time" : "recurring",
      ...(schedule.success ? { schedule: schedule.data } : {}),
      lifecycle: "active",
      briefInputs: brief.success
        ? {
            researchArea: brief.data.researchArea,
            competitors: brief.data.competitors,
            investigationAreas: [...brief.data.investigationAreas],
            businessContextSnapshotId: brief.data.businessContextSnapshotId,
          }
        : null,
      actorId: row.created_by,
    });
  }
  if (actorUnknown > 0) {
    logger.info("growth_intelligence.monitoring_sweep_actor_unknown", {
      projects: actorUnknown,
    });
  }
  return orderDueMonitoringProjectsFairly({
    due: candidates,
    limit: input.limit,
    maxPerOrganization: MONITORING_SWEEP_MAX_PER_ORGANIZATION,
  });
}
/**
 * Start-dispatch nudge caller (G47). Triggered right after a monitoring
 * update starts; a lost nudge never fails the start because the cadence
 * sweep re-collects undispatched actives. Payload is identifiers plus the
 * pinned brief the worker needs — never evidence or private context.
 */
export async function triggerMarketMonitoringUpdate(input: {
  organizationId: string;
  projectId: string;
  updateId: string;
  briefRevisionId: string;
  brief: Parameters<MonitoringUpdateStore["bindRevision"]>[0]["brief"];
  actorId: string;
  correlationId: string;
}): Promise<void> {
  await tasks.trigger("growth-intelligence.run-market-monitoring-update", {
    organizationId: input.organizationId,
    projectId: input.projectId,
    updateId: input.updateId,
    briefRevisionId: input.briefRevisionId,
    brief: input.brief,
    actorId: input.actorId,
    correlationId: input.correlationId,
  });
}

export const runMarketMonitoringUpdateTask = schemaTask({
  id: "growth-intelligence.run-market-monitoring-update",
  schema: marketMonitoringUpdatePayloadSchema,
  queue: growthIntelligenceQueue,
  retry,
  maxDuration: MONITORING_UPDATE_TASK_MAX_DURATION_S,
  run: async (payload, { signal }) => {
    const parsed = marketMonitoringUpdatePayloadSchema.parse(payload);
    const supabase = createGrowthIntelligenceWorkerServiceClient();
    const projects = createAuthenticatedResearchProjectRepository(supabase);
    const result = await runMarketMonitoringUpdate(parsed, {
      updates: createMonitoringUpdateStore(supabase),
      research: await createQualifiedMonitoringResearcher({
        persistence: supabase as unknown as TinyfishResearchPersistence,
        budget: createResearchBudgetRepository(supabase as unknown as TinyfishResearchPersistence),
        organizationId: parsed.organizationId,
        brief: parsed.brief,
        organizationCountryCode: await readMonitoringOrganizationCountry(
          supabase,
          parsed.organizationId,
        ),
      }),
      reports: {
        persist: (input) => projects.persistReportVersion(input),
      },
      events: createEventPublisher(),
      lifecycle: createMonitoringLifecycleHooks(supabase),
      signal,
    });

    logger.info("growth_intelligence.monitoring_update_finished", {
      organizationId: parsed.organizationId,
      correlationId: parsed.correlationId,
      updateId: parsed.updateId,
      outcome: result.outcome,
    });

    return result;
  },
});

/**
 * Every five minutes: sweep due recurring monitoring starts and recover
 * lost nudges. `schedules.task` rather than `schemaTask`: the cron payload
 * is fixed by Trigger.dev, so there is no caller-supplied payload to
 * validate. Starts interleave fairly across organizations (at most five
 * per org per pass); the sweep joins through the converging start path, so
 * a repeat pass never duplicates paid work, and undispatched actives are
 * re-nudged idempotently.
 */
export const monitoringSweepTask = schedules.task({
  id: "growth-intelligence.monitoring-sweep",
  cron: "*/5 * * * *",
  retry,
  maxDuration: 300,
  run: async () => {
    const supabase = createGrowthIntelligenceWorkerServiceClient();
    const projects = createAuthenticatedResearchProjectRepository(supabase);
    const result = await enqueueDueMonitoringUpdates(
      { correlationId: randomUUID(), limit: MONITORING_SWEEP_LIMIT },
      {
        listDue: (input) => listDueMonitoringProjects(supabase, input),
        projects,
        updates: createMonitoringUpdateStore(supabase),
        dispatch: {
          nudge: (input) => triggerMarketMonitoringUpdate(input),
        },
        events: createEventPublisher(),
        maxPerOrganization: MONITORING_SWEEP_MAX_PER_ORGANIZATION,
      },
    );

    logger.info("growth_intelligence.monitoring_sweep_finished", {
      started: result.started,
      openedProgress: result.openedProgress,
      renudged: result.renudged,
      skipped: result.skipped,
    });

    return result;
  },
});

export const dispatchDueWorkTask = schemaTask({
  id: "growth-intelligence.dispatch-due",
  schema: dispatchDuePayloadSchema,
  queue: growthIntelligenceQueue,
  retry,
  maxDuration: 300,
  run: async (payload) => {
    const parsed = dispatchDuePayloadSchema.parse(payload);
    const supabase = createGrowthIntelligenceWorkerServiceClient();
    const result = await dispatchDueWork(parsed, {
      claimDue: async (input) => {
        const { data, error } = await supabase.rpc("claim_due_growth_intelligence_requests", {
          p_limit: input.limit,
          p_dispatch_cooldown_seconds: input.cooldownSeconds,
        });
        if (error) throw new Error("Due Growth Intelligence work could not be claimed.");
        return (data ?? []).map((row) => ({
          organizationId: row.organizationId,
          requestId: row.requestId,
          kind: row.kind,
          correlationId: row.correlationId,
        }));
      },
      trigger: async (input) => {
        await tasks.trigger(input.taskId, {
          organizationId: input.organizationId,
          requestId: input.requestId,
          correlationId: input.correlationId,
        });
      },
    });

    logger.info("growth_intelligence.dispatch_finished", {
      correlationId: parsed.correlationId,
      dispatched: result.dispatched,
      skipped: result.skipped,
    });

    return result;
  },
});
