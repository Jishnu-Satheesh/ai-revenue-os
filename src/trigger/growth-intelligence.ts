import type { SupabaseClient } from "@supabase/supabase-js";
import { logger, queue, schemaTask, tasks } from "@trigger.dev/sdk";

import { createEventPublisher } from "@/domain/events/publisher";
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
  type ResearchAdapter,
  type ResearchRequest,
} from "@/modules/growth-intelligence/infrastructure/research/ports";
import { getQualifiedMarketResearchAdapter } from "@/modules/growth-intelligence/infrastructure/research/qualified-provider";
import type {
  ResearchModelSpender,
  ResearchModelTransport,
} from "@/modules/growth-intelligence/infrastructure/research/claim-extraction";
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
  type SynthesisMarketClaim,
} from "@/modules/growth-intelligence/application/synthesis-service";
import {
  consolidateMarketEvidence,
  consolidationPayloadSchema,
} from "@/workflows/growth-intelligence/consolidate-market-evidence";
import {
  dispatchDuePayloadSchema,
  dispatchDueWork,
} from "@/workflows/growth-intelligence/dispatch-due-work";
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
import { safeLimitationCodes, toCompactBusinessFinding } from "@/trigger/synthesis-loaders";

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

function buildResearchScope(
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

function createResearchDependencies(signal: AbortSignal) {
  const supabase = createGrowthIntelligenceWorkerServiceClient();
  const adapter: ResearchAdapter = getQualifiedMarketResearchAdapter();
  return {
    requests: createRequestOperations(supabase),
    profiles: {
      readCurrent: (input: { organizationId: string; branchId?: string | null }) =>
        readApprovedProfile(supabase, input.organizationId, input.branchId ?? null),
    },
    evidence: createMarketEvidenceRepository(supabase as unknown as MarketEvidencePersistence),
    adapter,
    extraction: {
      transport: unconfiguredResearchModelTransport("extraction"),
      spender: unconfiguredResearchModelSpender(),
      budget: researchModelBudget("extraction"),
      modelId: researchModelId("RESEARCH_EXTRACTION_MODEL", "unconfigured-extraction-model"),
    },
    supportReview: {
      transport: unconfiguredResearchModelTransport("support_review"),
      spender: unconfiguredResearchModelSpender(),
      budget: researchModelBudget("support_review"),
      modelId: researchModelId("RESEARCH_SUPPORT_REVIEW_MODEL", "unconfigured-review-model"),
    },
    excerptProvenance: triggerExcerptProvenance(),
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

const SYNTHESIS_LOADER_LIMIT = 200;

/**
 * Synthesis current-state readers. Every table and column read here is
 * verified in `src/lib/supabase/database.types.ts` (organization_market_
 * profiles, organization_market_profile_versions, growth_intelligence_
 * requests, channel_findings, market_evidence_claims, market_evidence_claim_
 * events, market_evidence_links, growth_intelligence_items) or the Task 13
 * synthesis RPCs. Business findings enter the service through the injected
 * loader seam; this default implementation selects compact finding identity
 * plus limitation codes only — never raw measures, report payloads, file contents, private records,
 * or transfer links. There is no approved-goals table in scope, so the goals loader
 * returns empty until Task 11 binds monthly report lineage (see report).
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
      channelId: string | null;
    }): Promise<{ findings: SynthesisBusinessFinding[]; fresh: boolean }> => {
      let query = supabase
        .from("channel_findings")
        .select(
          "id, detector_key, code, severity, calculation_digest, quality_state, status, channel_id, limitations",
        )
        .eq("organization_id", input.organizationId)
        .eq("status", "open")
        .eq("kind", "finding")
        .limit(SYNTHESIS_LOADER_LIMIT);
      if (input.channelId) query = query.eq("channel_id", input.channelId);
      const { data, error } = await query;
      if (error) throw new Error("Current business findings could not be loaded.");
      const compact = (data ?? []).map((row) => toCompactBusinessFinding(row));
      return {
        findings: compact,
        fresh: compact.length > 0 && (data ?? []).every((row) => row.quality_state === "complete"),
      };
    },
  };

  const claims = {
    load: async (input: {
      organizationId: string;
      profileVersionId: string;
    }): Promise<SynthesisMarketClaim[]> => {
      const { data, error } = await supabase
        .from("market_evidence_claims")
        .select(
          "id, claim_digest, paraphrase, quotation, geographic_layer, geography_ref, stale_at, expires_at, limitations",
        )
        .eq("organization_id", input.organizationId)
        .eq("market_profile_version_id", input.profileVersionId)
        .limit(SYNTHESIS_LOADER_LIMIT);
      if (error) throw new Error("Current market claims could not be loaded.");
      const rows = data ?? [];
      if (rows.length === 0) return [];
      const claimIds = rows.map((row) => row.id);
      const [{ data: events, error: eventsError }, { data: links, error: linksError }] =
        await Promise.all([
          supabase
            .from("market_evidence_claim_events")
            .select("market_evidence_claim_id, event_type")
            .eq("organization_id", input.organizationId)
            .in("market_evidence_claim_id", claimIds),
          supabase
            .from("market_evidence_links")
            .select("market_evidence_claim_id, relation")
            .eq("organization_id", input.organizationId)
            .in("market_evidence_claim_id", claimIds),
        ]);
      if (eventsError) throw new Error("Current claim events could not be loaded.");
      if (linksError) throw new Error("Current claim links could not be loaded.");
      const terminal = new Set(
        (events ?? [])
          .filter(
            (event) =>
              event.event_type === "expired" ||
              event.event_type === "withdrawn" ||
              event.event_type === "excluded" ||
              event.event_type === "erased",
          )
          .map((event) => event.market_evidence_claim_id),
      );
      const relations = new Map<string, string[]>();
      for (const link of links ?? []) {
        const list = relations.get(link.market_evidence_claim_id) ?? [];
        list.push(link.relation);
        relations.set(link.market_evidence_claim_id, list);
      }
      const at = now().getTime();
      const eligible: SynthesisMarketClaim[] = [];
      for (const row of rows) {
        if (terminal.has(row.id)) continue;
        if (row.paraphrase === null) continue;
        if (Number.isNaN(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= at) {
          continue;
        }
        const claimRelations = relations.get(row.id) ?? [];
        if (claimRelations.includes("contradicts")) continue;
        const supports = claimRelations.filter((relation) => relation === "supports").length;
        const corroborates = claimRelations.filter(
          (relation) => relation === "corroborates",
        ).length;
        eligible.push({
          id: row.id,
          digest: row.claim_digest,
          paraphrase: row.paraphrase,
          quotation: row.quotation,
          geographicLayer: row.geographic_layer,
          geographyRef: row.geography_ref,
          supportGrade:
            corroborates > 0 || supports >= 2
              ? "corroborated"
              : supports === 1
                ? "single_source"
                : "contextual",
          freshness: Date.parse(row.stale_at) <= at ? "stale" : "current",
          limitations: safeLimitationCodes(row.limitations),
        });
      }
      return eligible;
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
        .limit(SYNTHESIS_LOADER_LIMIT);
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
  };
}

tasks.onCancel(async ({ task: taskId, payload }) => {
  if (
    taskId !== "growth-intelligence.run-market-research" &&
    taskId !== "growth-intelligence.consolidate-market-evidence" &&
    taskId !== "growth-intelligence.dispatch-due" &&
    taskId !== "growth-intelligence.run-synthesis"
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
    const dependencies = createResearchDependencies(signal);
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
    const dependencies = createResearchDependencies(signal);
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
