import "server-only";

import { hasOrganizationPermission } from "@/domain/access/permissions";
import {
  assembleAgentAdviceContext,
  sharedAgentMemoryCeiling,
  type AgentAdviceContextInput,
} from "./advice-context-reader";
import type { AgentAdviceContext } from "./advice-context";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import type { ContextPackReaders } from "@/modules/agent-chat/application/context-pack";
import { createAuthenticatedMarketProfileRepository } from "@/modules/growth-intelligence/infrastructure/profile-repository";
import type { ChannelAssessmentReads } from "@/modules/agent-chat/application/channel-assessment";
import type { OrganizationRole } from "@/domain/organizations/types";
import { signQuestionnaire, verifyQuestionnaire } from "@/modules/agent-chat/infrastructure/questionnaire-signature";
import { resolveResearchBranchScope, type AgentContextScope } from "./research-scope";
import { DomainError } from "@/lib/errors";
import { createWatchProjectAdapter } from "./watch-project-adapter";
import type { ResearchProjectRepository } from "@/modules/growth-intelligence/infrastructure/research-project-repository";

export function createAgentQuestionnaireAuthority() {
  return { sign: signQuestionnaire, verify: verifyQuestionnaire };
}

/** Source-owned keyed creation and initial brief, using the caller's existing client. */
export function createAgentWatchProjectSeams(
  supabase: SessionClient,
  projects: ResearchProjectRepository,
) {
  return createWatchProjectAdapter({
    projects,
    readLatestBrief: async ({ organizationId, projectId }) => {
      const { data, error } = await supabase.from("growth_intelligence_brief_revisions")
        .select("document").eq("organization_id", organizationId).eq("project_id", projectId)
        .order("revision_number", { ascending: false }).order("id", { ascending: false })
        .limit(1).maybeSingle();
      if (error) throw new DomainError("INTEGRATION_ERROR", "The saved watch brief could not be read. Try again.");
      return data === null ? null : data.document;
    },
    readCreationKey: async ({ organizationId, idempotencyKey }) => {
      const key = await supabase.from("growth_intelligence_project_create_keys")
        .select("project_id").eq("organization_id", organizationId)
        .eq("idempotency_key", idempotencyKey).maybeSingle();
      if (key.error) throw new DomainError("INTEGRATION_ERROR", "The watch creation receipt could not be read. Try again.");
      if (!key.data) return null;
      const scope = await supabase.from("growth_intelligence_monitoring_active_scopes")
        .select("scope_fingerprint").eq("organization_id", organizationId)
        .eq("project_id", key.data.project_id).maybeSingle();
      if (scope.error) throw new DomainError("INTEGRATION_ERROR", "The watch scope could not be read. Try again.");
      return { projectId: key.data.project_id, scopeFingerprint: scope.data?.scope_fingerprint ?? null };
    },
  });
}

/** Resolve only explicit branch names from bounded tenant-owned source rows. */
export async function resolveAgentContextScope(
  supabase: SessionClient,
  input: { organizationId: string; question?: string },
): Promise<AgentContextScope> {
  try {
    const { data, error } = await supabase.from("branches").select("id,name")
      .eq("organization_id", input.organizationId).limit(101);
    if (error || !data || data.length > 100) return { kind: "unavailable" };
    return resolveResearchBranchScope(input.question ?? "", data);
  } catch {
    return { kind: "unavailable" };
  }
}

/** Exact persisted question supplies a branch hint; source identities and confirmation own scope. */
export function createAgentResearchProfileResolver(supabase: SessionClient) {
  return async (input: { organizationId: string; question?: string }) => {
    const scope = await resolveAgentContextScope(supabase, input);
    if (scope.kind === "ambiguous" || scope.kind === "unavailable") return null;
    return readMarketProfilePointer(supabase, input.organizationId,
      scope.kind === "branch" ? scope.branchId : undefined);
  };
}

/**
 * Agent chat composition root (spec section 9).
 *
 * This file is the module's wiring point: like `api-schemas.ts`, it is
 * exempt from the application-layer adapter ban, so it may construct the
 * infrastructure readers the context-pack lanes need. Every other file in
 * this layer stays behind the `ContextPackReaders` port. Reads run on the
 * caller's session client — RLS plus the per-query `organization_id` pin
 * own tenant isolation, exactly as the thread repository does. No service
 * role in user-facing paths.
 *
 * Bound lanes (verified against the live schema in this tree):
 *
 * - branch timezone: `branches.timezone`, falling back to
 *   `organizations.default_timezone`. Absent → null, and the pack renders
 *   UTC with its failure limitation (the Task 6 timezone-flag fix keeps a
 *   throwing reader honest too).
 * - Market Profile: current approved version + digest through the
 *   authenticated profile repository at the exact requested branch scope.
 *   Only a current confirmed version can bind; absent confirmation and a
 *   mismatched document remain explicit gaps.
 * - business identity: the organization's own row (name, industry,
 *   country) as unverified source-aware facts. Verified-first sorting is
 *   unaffected: these arrive `verified: false` because nobody confirmed
 *   them as facts.
 * - organization goals and active constraints/policies: bounded labels from
 *   their owning tables. Targets remain configured targets, never results.
 *
 * Honestly gapped lanes (the pack reports gaps, never zeros — each names
 * its follow-up):
 *
 * - governed evidence: the growth-progress windowed reads need
 *   branch-timezone amount mapping that is not verified here; mapping money
 *   wrong is worse than gapping.
 * - memory hits: retrieval needs actor/ceiling policy wiring per call.
 * - economics readiness: needs its repository implementation.
 * - timeline: pipeline history is branch-scoped and the pack seam carries
 *   no branch id.
 */

type SessionClient = SupabaseClient<Database>;

/** Server-owned tenant labels for deterministic routing, never model guesses. */
export async function readAgentChannelLabels(
  supabase: SessionClient,
  organizationId: string,
): Promise<string[]> {
  const [channels, aliases] = await Promise.all([
    supabase
      .from("organization_channels")
      .select("id,key,display_name")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .limit(100),
    supabase
      .from("channel_source_aliases")
      .select("channel_id,alias")
      .eq("organization_id", organizationId)
      .limit(500),
  ]);
  if (channels.error || aliases.error) throw new Error("AGENT_CHANNEL_LABEL_READ_FAILED");
  const ids = new Set((channels.data ?? []).map((row) => row.id));
  return [
    ...new Set([
      ...(channels.data ?? []).flatMap((row) => [row.key, row.display_name]),
      ...(aliases.data ?? []).filter((row) => ids.has(row.channel_id)).map((row) => row.alias),
    ]),
  ]
    .filter((label) => typeof label === "string" && label.trim().length > 1)
    .map((label) => label.trim().slice(0, 200))
    .slice(0, 300);
}

async function readGoalsAndConstraints(
  supabase: SessionClient,
  organizationId: string,
): Promise<unknown> {
  const [goals, constraints, policies] = await Promise.all([
    supabase
      .from("goals")
      .select("id,name,target_value,unit,baseline_status")
      .eq("organization_id", organizationId)
      .eq("scope_kind", "organization")
      .order("priority")
      .limit(100),
    supabase
      .from("constraints")
      .select("name,severity,effective_from,effective_to")
      .eq("organization_id", organizationId)
      .eq("scope_kind", "organization")
      .eq("is_active", true)
      .limit(100),
    supabase
      .from("policies")
      .select("name,mode")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .limit(100),
  ]);
  if (goals.error || constraints.error || policies.error)
    throw new Error("AGENT_GOALS_READ_FAILED");
  const now = new Date().toISOString();
  return {
    goals: (goals.data ?? []).map((goal) => ({
      id: goal.id,
      title: `${goal.name} (target: ${goal.target_value} ${goal.unit})`.slice(0, 280),
      status: `baseline ${goal.baseline_status}`,
    })),
    constraints: (constraints.data ?? [])
      .filter(
        (row) =>
          (!row.effective_from || row.effective_from <= now) &&
          (!row.effective_to || row.effective_to > now),
      )
      .map((row) => `${row.name} (${row.severity})`.slice(0, 280)),
    policies: (policies.data ?? []).map((row) => `${row.name}: ${row.mode}`.slice(0, 280)),
    capabilityBlocks: [],
  };
}

/** Prior user questions only: old assistant answers may contain a higher
 * sensitivity than the current member may read. Never cross threads/tenants. */
export async function readAgentRecentQuestions(
  supabase: SessionClient,
  input: { organizationId: string; threadId: string; beforeCreatedAt: string },
): Promise<string[]> {
  const { data, error } = await supabase
    .from("agent_messages")
    .select("body,created_at")
    .eq("organization_id", input.organizationId)
    .eq("thread_id", input.threadId)
    .eq("role", "user")
    .lt("created_at", input.beforeCreatedAt)
    .order("created_at", { ascending: false })
    .limit(4);
  if (error) throw new Error("AGENT_HISTORY_READ_FAILED");
  return (data ?? [])
    .reverse()
    .flatMap((row) =>
      typeof row.body === "string" && row.body.trim() ? [row.body.trim().slice(0, 2000)] : [],
    );
}

async function readBranchTimezone(
  supabase: SessionClient,
  organizationId: string,
  branchId?: string,
  requireBranch = false,
): Promise<string | null> {
  if (branchId) {
    const { data, error } = await supabase
      .from("branches")
      .select("timezone")
      .eq("organization_id", organizationId)
      .eq("id", branchId)
      .maybeSingle();
    if (requireBranch && (error || !data)) return null;
    if (!error && data && typeof data.timezone === "string" && data.timezone.length > 0) {
      return data.timezone;
    }
  }
  const { data, error } = await supabase
    .from("organizations")
    .select("default_timezone")
    .eq("id", organizationId)
    .maybeSingle();
  if (error || !data || typeof data.default_timezone !== "string") return null;
  return data.default_timezone.length > 0 ? data.default_timezone : null;
}

async function readIdentityFacts(
  supabase: SessionClient,
  organizationId: string,
): Promise<unknown> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id,name,industry,country_code")
    .eq("id", organizationId)
    .maybeSingle();
  if (error || !data) return null;
  const facts: { id: string; statement: string; verified: boolean; source: string }[] = [];
  if (typeof data.name === "string" && data.name.trim().length > 0) {
    facts.push({
      id: `org:${data.id}:name`,
      statement: data.name.trim().slice(0, 2000),
      verified: false,
      source: "organization",
    });
  }
  if (typeof data.industry === "string" && data.industry.trim().length > 0) {
    facts.push({
      id: `org:${data.id}:industry`,
      statement: `Industry: ${data.industry.trim()}`.slice(0, 2000),
      verified: false,
      source: "organization",
    });
  }
  if (typeof data.country_code === "string" && data.country_code.trim().length > 0) {
    facts.push({
      id: `org:${data.id}:country`,
      statement: `Country: ${data.country_code.trim()}`.slice(0, 2000),
      verified: false,
      source: "organization",
    });
  }
  return facts;
}

async function readMarketProfilePointer(
  supabase: SessionClient,
  organizationId: string,
  branchId?: string,
): Promise<unknown> {
  const repository = createAuthenticatedMarketProfileRepository(supabase);
  const view = await repository.read({ organizationId, branchId: branchId ?? null });
  if (!view.profile || !view.profile.currentVersionId || !view.profile.enabled) {
    return { status: "missing" };
  }
  const current = view.versions.find((version) => version.id === view.profile?.currentVersionId);
  if (!current) return { status: "missing" };
  const latestDecision = view.decisions.find((decision) => decision.profileVersionId === current.id);
  if (latestDecision?.decision !== "confirmed") {
    return { status: "missing", reasonCode: "PROFILE_NOT_CONFIRMED" };
  }
  const declaredBranch = current.document.schemaVersion === 2 ? current.document.branchId : null;
  if (declaredBranch !== (branchId ?? null)) {
    return { status: "missing", reasonCode: "PROFILE_SCOPE_MISMATCH" };
  }
  const niche = current.document.nicheDescriptors[0];
  return {
    status: "current",
    versionId: current.id,
    digest: current.digest,
    ...(niche ? { niche: niche.slice(0, 280) } : {}),
    ...(branchId ? { branchId } : {}),
  };
}

/**
 * Binds the verified readers for one pack build. Every lane call carries
 * the server-owned organization id; nothing infers tenant scope from user
 * input. A throwing lane is left to throw — the pack turns it into an
 * honest gap plus a limitation, never a crash.
 */
export function createAgentContextReaders(supabase: SessionClient): ContextPackReaders {
  return {
    resolveBranchTimezone: async (scope) =>
      readBranchTimezone(supabase, scope.organizationId, scope.branchId),
    getIdentityFacts: async (scope) => readIdentityFacts(supabase, scope.organizationId),
    getMarketProfile: async (scope) =>
      readMarketProfilePointer(supabase, scope.organizationId, scope.branchId),
    getGoals: async (scope) => readGoalsAndConstraints(supabase, scope.organizationId),
  };
}

/**
 * Shared source-owned reads for channel assessment, built in this
 * composition root (the module's adapter-ban exemption covers this file,
 * so application logic never imports infrastructure repositories
 * directly). Works with any supabase client carrying the caller's
 * authorization: the session client in routes (RLS plus per-query
 * organization pins) or the service-role client in workers (explicit
 * organization pins plus an RPC role recheck at the boundary). Every
 * source query carries an explicit organization id.
 *
 * The heavy readers load lazily inside the ports: several pull
 * environment-gated modules (rate limits, dispatch transport) that must
 * not burden unit scope or cold starts that never assess a channel.
 */
export function channelAssessmentReads(
  supabase: SessionClient,
  input: { organizationId: string; actorId: string; role: OrganizationRole; branchId?: string },
): ChannelAssessmentReads {
  const organizationId = input.organizationId;
  async function readers() {
    const [
      { createChannelService },
      { createAuthenticatedChannelRepository },
      analysisInfra,
      { resolveCurrentChannelRunForRequest },
      dispatch,
      { consumeAnalysisRunAllowance },
    ] = await Promise.all([
      import("@/modules/channels/application/service"),
      import("@/modules/channels/infrastructure/repository"),
      import("@/modules/analysis/infrastructure/read-repository"),
      import("@/modules/analysis/application/current-run"),
      import("@/modules/analysis/application/dispatch"),
      import("@/lib/cache/rate-limit"),
    ]);
    return {
      channelService: createChannelService(createAuthenticatedChannelRepository(supabase)),
      analysis: analysisInfra.createAuthenticatedChannelAnalysisRepository(supabase),
      evidenceWindowLimit: analysisInfra.MAX_EVIDENCE_WINDOWS,
      resolveCurrentChannelRunForRequest,
      requestChannelAnalysis: dispatch.requestChannelAnalysis,
      requestChannelRecommendations: dispatch.requestChannelRecommendations,
      consumeAnalysisRunAllowance,
    };
  }
  return {
    listChannels: async () => {
      const { channelService } = await readers();
      const snapshot = await channelService.listManagementSnapshot({
        organizationId,
        actorId: input.actorId,
        role: input.role,
      });
      return snapshot.channels.map((channel) => ({
        id: channel.id,
        key: channel.key,
        displayName: channel.display_name,
        status: channel.status,
        aliases: snapshot.aliases
          .filter((alias) => alias.channel_id === channel.id)
          .map((alias) => alias.alias),
      }));
    },
    loadWindows: async (channelId) => {
      const { analysis, evidenceWindowLimit } = await readers();
      const windows = await analysis.loadEvidenceWindows({
        organizationId,
        channelId,
        limit: evidenceWindowLimit,
      });
      return windows
        .filter((window) => !input.branchId || window.branchId === input.branchId)
        .map((window) => ({
          windowStart: window.windowStart,
          windowEnd: window.windowEnd,
          grain: window.grain,
          governedRowCount: window.governedRowCount,
          timeZone: window.timeZone,
        }));
    },
    resolveWindow: async (channelId, from, to) => {
      const { analysis } = await readers();
      if (input.branchId) {
        const windows = (
          await analysis.loadEvidenceWindows({ organizationId, channelId, limit: 500 })
        ).filter(
          (window) =>
            window.branchId === input.branchId &&
            window.windowStart <= to &&
            window.windowEnd >= from,
        );
        const { isWindowCovered, mergeCoverageSegments } = await import(
          "@/domain/analysis/window-selection"
        );
        if (!windows.length || !isWindowCovered(from, to, mergeCoverageSegments(windows)))
          return null;
        const timeZones = new Set(windows.map((window) => window.timeZone));
        if (timeZones.size !== 1) return null;
        const grains = new Map<import("@/domain/analysis/types").AnalysisGrain, number>();
        for (const window of windows)
          grains.set(window.grain, (grains.get(window.grain) ?? 0) + window.governedRowCount);
        const grain = [...grains.entries()].sort((a, b) => b[1] - a[1])[0][0];
        return { windowStart: from, windowEnd: to, grain, timeZone: windows[0].timeZone };
      }
      return analysis.resolveWindowInput({
        organizationId,
        channelId,
        from,
        to,
      });
    },
    currentRun: async (scope) => {
      const { resolveCurrentChannelRunForRequest } = await readers();
      return resolveCurrentChannelRunForRequest(supabase, scope);
    },
    loadRunForWindow: async (channelId, from, to) => {
      const { analysis } = await readers();
      return analysis.loadRunForWindow({
        organizationId,
        channelId,
        branchId: input.branchId ?? null,
        windowStart: from,
        windowEnd: to,
      });
    },
    readResult: async (runId) => {
      const { analysis } = await readers();
      const [findings, recommendations] = await Promise.all([
        analysis.loadFindingsForRun({ organizationId, analysisRunId: runId }),
        analysis.loadRecommendationsForRun({
          organizationId,
          analysisRunId: runId,
          viewerId: null,
        }),
      ]);
      return { findings, recommendations };
    },
    consumeAllowance: async () => {
      const { consumeAnalysisRunAllowance } = await readers();
      return consumeAnalysisRunAllowance(organizationId);
    },
    dispatchAnalysis: async (scope) => {
      const { requestChannelAnalysis } = await readers();
      return requestChannelAnalysis({
        organizationId,
        channelId: scope.channelId,
        branchId: scope.branchId,
        windowStart: scope.windowStart,
        windowEnd: scope.windowEnd,
        periodGrain: scope.grain,
        windowTimezone: scope.timeZone,
        analysisRunId: scope.analysisRunId,
        correlationId: scope.correlationId,
      });
    },
    dispatchNarration: async (channelId, runId, correlationId) => {
      const { requestChannelRecommendations } = await readers();
      return requestChannelRecommendations({
        organizationId,
        channelId,
        analysisRunId: runId,
        correlationId,
      });
    },
  };
}

/** Session-bound composition. Call after resolving current membership. */
export async function composeAgentAdviceContext(
  input: AgentAdviceContextInput,
): Promise<AgentAdviceContext> {
  // Advice needs the selected timezone, not every Digital Twin table. A
  // missing optional context read must not prevent a ready source audit
  // from reaching the final answer.
  const timeZone = await readBranchTimezone(
    input.supabase,
    input.organizationId,
    input.branchId,
    true,
  );
  if (!timeZone)
    return {
      entries: [],
      limitations: ["The requested branch or timezone is unavailable."],
      periodSwitch: null,
    };
  // Heavy source-owned readers load lazily: several pull
  // environment-gated modules (organization context, Memory workspace)
  // that must not burden unit scope or cold starts that never compose
  // advice. This keeps the module statically light like the channel
  // reads above.
  const [
    { createMemoryWorkspaceApi },
    { createGovernedMetricWindowRepository },
    { isCampaignsEnabled },
    campaignsProposalRepo,
    { hasGrowthIntelligenceAccess },
    { createAuthenticatedGrowthIntelligenceReadRepository },
    { createGrowthAdviceReader },
  ] = await Promise.all([
    import("@/modules/memory/application/api"),
    import("@/modules/metrics/infrastructure/repository"),
    import("@/modules/campaigns/application/feature-access"),
    import("@/modules/campaigns/infrastructure/proposal-read-repository"),
    import("@/modules/growth-intelligence/application/feature-access"),
    import("@/modules/growth-intelligence/infrastructure/read-repository"),
    import("@/modules/organizations/infrastructure/growth-advice-reader"),
  ]);
  const growthReads = createAuthenticatedGrowthIntelligenceReadRepository(input.supabase);
  const proposalReader = campaignsProposalRepo.createCampaignProposalReader(
    input.supabase as unknown as import("@/modules/campaigns/infrastructure/proposal-read-repository").ProposalReadPersistence,
  );
  const adviceReader = createGrowthAdviceReader({ growthReads, proposalReader });
  const metrics = createGovernedMetricWindowRepository(input.supabase);
  const actor = { userId: input.actorId, role: input.role };
  const memory = createMemoryWorkspaceApi({ supabase: input.supabase, actor });
  const growthAllowed =
    hasGrowthIntelligenceAccess(input.organizationId, "market") &&
    hasOrganizationPermission(input.role, "growth_intelligence.read");
  const campaignsAllowed =
    isCampaignsEnabled(input.organizationId) &&
    hasOrganizationPermission(input.role, "campaign.read");
  const evidenceAllowed = hasOrganizationPermission(input.role, "channel.read");
  return assembleAgentAdviceContext(
    { ...input, timeZone },
    {
      readCandidates: () =>
        adviceReader.readCandidates({
          organizationId: input.organizationId,
          // Answers live in organization-readable history. Keep source advice
          // neutral to personal pins/snoozes/feedback, as source workers do;
          // those personal tables also do not grant the worker a read.
          actorId: "",
          nowIso: input.now ?? new Date().toISOString(),
          allow: {
            recommendations: growthAllowed,
            items: growthAllowed,
            proposals: campaignsAllowed,
          },
        }),
      readMemory: async () => {
        const response = await memory.retrieval.retrieve({
          organizationId: input.organizationId,
          ...(input.branchId ? { branchId: input.branchId } : {}),
          purpose: "operator_search",
          query: input.question.slice(0, 500),
          // Chat history is readable by every organization member. Its derived
          // Memory content must fit that shared audience, even for an owner.
          sensitivityAllowance: sharedAgentMemoryCeiling(actor),
          correlationId: input.correlationId,
          limit: 10,
        });
        return response.results.flatMap((item) =>
          item.itemId
            ? [
                {
                  itemId: item.itemId,
                  title: item.title,
                  ...(item.body ? { body: item.body } : {}),
                  provenance: `${item.provenance.origin}, ${item.provenance.verificationState}`,
                  ...(item.observedAt ? { observedAt: item.observedAt } : {}),
                },
              ]
            : [],
        );
      },
      readEvidence: evidenceAllowed
        ? ({ windowStart, windowEnd, metricKeys }) =>
            metrics.loadGovernedWindow({
              organizationId: input.organizationId,
              metricKeys,
              windowStart,
              windowEnd,
              timeZone,
              ...(input.channelId ? { channelId: input.channelId } : {}),
              ...(input.branchId ? { branchId: input.branchId } : {}),
            })
        : async () => {
            throw new Error("not permitted");
          },
    },
  );
}
