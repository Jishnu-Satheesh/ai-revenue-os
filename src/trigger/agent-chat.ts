import type { SupabaseClient } from "@supabase/supabase-js";
import { logger, queue, schemaTask, tasks } from "@trigger.dev/sdk";
import { z } from "zod";

import { briefRevisionSchema, type BriefRevision } from "@/domain/growth-intelligence/brief";
import { isResearchProviderQualified } from "@/domain/growth-intelligence/research-budget";
import { createGrowthIntelligenceRequestFingerprint } from "@/domain/growth-intelligence/request-fingerprint";
import { createEventPublisher } from "@/domain/events/publisher";
import type { Database } from "@/lib/supabase/database.types";
import { createGrowthIntelligenceWorkerServiceClient } from "@/lib/supabase/service";
import { isAgentChatEnabled } from "@/modules/integrations/application/feature-access";
import {
  buildMarkerReceipts,
  executeResearchOnce,
  executeWatchCreate,
  executeWatchUpdate,
  giResearchLink,
  resolveResearchLaneGate,
  type ResearchLaneBlockedCode,
} from "@/modules/agent-chat/application/executors";
import { createResearchBudgetRepository } from "@/modules/growth-intelligence/infrastructure/research/budget-repository";
import { createResearchProviderQualification } from "@/modules/growth-intelligence/infrastructure/research/qualification";
import { createAuthenticatedResearchProjectRepository } from "@/modules/growth-intelligence/infrastructure/research-project-repository";
import type { runMarketResearchTask } from "@/trigger/growth-intelligence";
import {
  isTinyfishResearchGateOpen,
  readTinyfishSearchApiKey,
  TINYFISH_RESEARCH_PRICE_VERSION,
  TINYFISH_RESEARCH_QUOTE_MICROS_USD,
} from "@/trigger/growth-intelligence-tinyfish";

/**
 * Agent chat executors on the TinyFish lane (spec section 10).
 *
 * Thin durable wrappers: the application executors in
 * `src/modules/agent-chat/application/executors.ts` own gating order,
 * idempotency, replay, and scope rules over injected seams, and these
 * tasks inject the worker-side seams — the staged TinyFish lane only
 * (`createQualifiedTinyfishResearchAdapter` assembly downstream in
 * `growth-intelligence.run-market-research`), reserve-before-call budget
 * (`reserve_request_budget`), the staged qualification RPC
 * (`check_research_provider_qualification_for` tinyfish), and the keyed
 * monitoring project RPCs. No new provider code lives here.
 *
 * Every gate fails closed to the blocked baseline (safe codes, zero
 * spend): a missing/empty API key, a closed kill-switch, or an
 * unqualified tinyfish lane returns before any enqueue, reserve, or
 * dispatch. Unknown costs stay reserved, never zeroed.
 */

const retry = {
  maxAttempts: 3,
  minTimeoutInMs: 1_000,
  maxTimeoutInMs: 30_000,
  factor: 2,
} as const;

/** Agent dispatch lane. The research run itself fences through its claim token and lease. */
const agentChatQueue = queue({
  name: "agent-chat",
  concurrencyLimit: 3,
});

/**
 * Audit trail for governed dispatches (Slice B, spec section 7). The
 * dispatch route enqueues blind — it cannot know the outcome — so the
 * worker emits the event once the outcome exists. Payloads carry
 * identifiers plus bounded outcome codes plus correlation only, never
 * bodies, questions, or estimates.
 */
async function publishAgentThreadEvent(input: {
  organizationId: string;
  actorId: string;
  correlationId: string;
  eventName: "agent_thread.research_triggered" | "agent_thread.watch_created";
  payload: Record<string, unknown>;
}): Promise<void> {
  await createEventPublisher().publish({
    organizationId: input.organizationId,
    eventId: crypto.randomUUID(),
    eventName: input.eventName,
    occurredAt: new Date().toISOString(),
    actorType: "user",
    actorId: input.actorId,
    correlationId: input.correlationId,
    schemaVersion: 1,
    payload: input.payload,
  });
}

type WorkerClient = SupabaseClient<Database>;

/** Research rule version pinned by the market-research workflow in this tree. */
const RESEARCH_RULE_VERSION = "market-research@1";

const uuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Research once
// ---------------------------------------------------------------------------

export const agentResearchOncePayloadSchema = z
  .object({
    organizationId: uuidSchema,
    actorId: z.string().trim().min(1).max(200),
    threadId: z.string().trim().min(1).max(200),
    /** Precomputed thread-linked digest (executor mints the key from it). */
    messageDigest: z.string().trim().min(1).max(200),
    branchId: uuidSchema.nullable().optional(),
    profileVersionId: uuidSchema,
    /** Digest bound at route time; a moved version fails closed. */
    profileDigest: z.string().trim().min(1).max(256),
    correlationId: uuidSchema,
    /** Thread-linked `agent_thread:<threadId>:<messageDigest>` dispatch key. */
    idempotencyKey: z.string().trim().min(16).max(200),
  })
  .strict();

export type AgentResearchOncePayload = z.infer<typeof agentResearchOncePayloadSchema>;

type AgentProfileRead = {
  versionId: string;
  digest: string;
  document: unknown;
  enabled: boolean;
  sourcePolicyDigest: string;
};

async function readAgentProfileVersion(
  supabase: WorkerClient,
  organizationId: string,
  versionId: string,
): Promise<AgentProfileRead | null> {
  const { data: version, error: versionError } = await supabase
    .from("organization_market_profile_versions")
    .select("id,market_profile_id,profile_digest,profile_document,source_policy_digest")
    .eq("organization_id", organizationId)
    .eq("id", versionId)
    .maybeSingle();
  if (versionError || !version) return null;
  const { data: profile, error: profileError } = await supabase
    .from("organization_market_profiles")
    .select("id,current_version_id,enabled")
    .eq("organization_id", organizationId)
    .eq("id", version.market_profile_id)
    .maybeSingle();
  if (profileError || !profile) return null;
  if (
    typeof version.profile_digest !== "string" ||
    typeof version.source_policy_digest !== "string"
  ) {
    return null;
  }
  return {
    versionId: version.id,
    digest: version.profile_digest,
    document: version.profile_document,
    enabled: profile.enabled === true && profile.current_version_id === version.id,
    sourcePolicyDigest: version.source_policy_digest,
  };
}

async function readRequestStatus(
  supabase: WorkerClient,
  organizationId: string,
  requestId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("growth_intelligence_requests")
    .select("status")
    .eq("organization_id", organizationId)
    .eq("id", requestId)
    .maybeSingle();
  if (error || !data || typeof data.status !== "string") return null;
  return data.status;
}

function blockedOnceResult(
  organizationId: string,
  reasonCode: ResearchLaneBlockedCode,
  copy: string,
) {
  return {
    outcome: "blocked" as const,
    reasonCode,
    copy,
    spentMicrosUsd: 0,
    markers: buildMarkerReceipts("blocked"),
    link: giResearchLink(organizationId),
  };
}

/**
 * Rollout gate (spec section 16, M2): the worker rechecks the org
 * allowlist at run start — the drawer may have dispatched minutes ago
 * and the operator can delist mid-flight. A delisted org fails closed
 * before any enqueue, reserve, or dispatch: zero spend, provably.
 */
function agentChatDisabledResult(organizationId: string, correlationId: string) {
  return {
    outcome: "blocked" as const,
    reasonCode: "AGENT_CHAT_DISABLED" as const,
    copy: "The AI agent is not available for this organization. Nothing was spent or changed.",
    spentMicrosUsd: 0,
    organizationId,
    correlationId,
  };
}

export const agentResearchOnceTask = schemaTask({
  id: "agent-chat.research-once",
  schema: agentResearchOncePayloadSchema,
  queue: agentChatQueue,
  retry,
  maxDuration: 300,
  run: async (payload) => {
    const parsed = agentResearchOncePayloadSchema.parse(payload);
    if (!isAgentChatEnabled(parsed.organizationId)) {
      logger.info("agent_chat.research_once_blocked", {
        organizationId: parsed.organizationId,
        correlationId: parsed.correlationId,
        reasonCode: "AGENT_CHAT_DISABLED",
      });
      await publishAgentThreadEvent({
        organizationId: parsed.organizationId,
        actorId: parsed.actorId,
        correlationId: parsed.correlationId,
        eventName: "agent_thread.research_triggered",
        payload: {
          threadId: parsed.threadId,
          messageDigest: parsed.messageDigest,
          idempotencyKey: parsed.idempotencyKey,
          outcome: "blocked",
          reasonCode: "AGENT_CHAT_DISABLED",
        },
      });
      return agentChatDisabledResult(parsed.organizationId, parsed.correlationId);
    }
    const supabase = createGrowthIntelligenceWorkerServiceClient();

    // Live gate recheck: the drawer may have routed minutes ago, and the
    // operator can close the lane mid-flight. Every shut gate returns
    // before any enqueue, reserve, or dispatch — zero spend, provably.
    const keyPresent = readTinyfishSearchApiKey().length > 0;
    const gateOpen = isTinyfishResearchGateOpen();
    let qualified = false;
    try {
      const { qualification } = await createResearchProviderQualification(
        supabase as unknown as {
          rpc(
            name: string,
            args: Record<string, unknown>,
          ): PromiseLike<{ data: unknown; error: unknown }>;
        },
        "tinyfish",
      ).check();
      qualified =
        isResearchProviderQualified(qualification) && qualification.provider === "tinyfish";
    } catch {
      qualified = false;
    }
    const gate = resolveResearchLaneGate({ keyPresent, enabled: gateOpen, qualified });
    if (!gate.open) {
      logger.info("agent_chat.research_once_blocked", {
        organizationId: parsed.organizationId,
        correlationId: parsed.correlationId,
        reasonCode: gate.reasonCode,
      });
      await publishAgentThreadEvent({
        organizationId: parsed.organizationId,
        actorId: parsed.actorId,
        correlationId: parsed.correlationId,
        eventName: "agent_thread.research_triggered",
        payload: {
          threadId: parsed.threadId,
          messageDigest: parsed.messageDigest,
          idempotencyKey: parsed.idempotencyKey,
          outcome: "blocked",
          reasonCode: gate.reasonCode,
        },
      });
      return blockedOnceResult(parsed.organizationId, gate.reasonCode, gate.copy);
    }

    const budget = createResearchBudgetRepository(
      supabase as unknown as {
        rpc(
          name: string,
          args: Record<string, unknown>,
        ): PromiseLike<{ data: unknown; error: unknown }>;
      },
    );
    const profileCache: { current: AgentProfileRead | null | undefined } = { current: undefined };
    const readProfile = async (): Promise<AgentProfileRead | null> => {
      if (profileCache.current === undefined) {
        profileCache.current = await readAgentProfileVersion(
          supabase,
          parsed.organizationId,
          parsed.profileVersionId,
        );
      }
      return profileCache.current;
    };

    const outcome = await executeResearchOnce(
      {
        organizationId: parsed.organizationId,
        actorId: parsed.actorId,
        threadId: parsed.threadId,
        messageDigest: parsed.messageDigest,
        ...(parsed.branchId ? { branchId: parsed.branchId } : {}),
        profileVersion: { versionId: parsed.profileVersionId, digest: parsed.profileDigest },
        correlationId: parsed.correlationId,
        gates: { keyPresent: true, enabled: true, qualified: true },
      },
      {
        profiles: {
          readVersion: async (input) => {
            const profile = await readProfile();
            if (!profile || profile.versionId !== input.versionId) return null;
            return {
              versionId: profile.versionId,
              digest: profile.digest,
              document: profile.document,
              enabled: profile.enabled,
            };
          },
        },
        requests: {
          getStatus: (input) => readRequestStatus(supabase, input.organizationId, input.requestId),
          enqueue: async (input) => {
            const profile = await readProfile();
            if (!profile) throw new Error("The Market Profile version could not be loaded.");
            const branchId = input.branchId ?? parsed.branchId ?? null;
            const fingerprint = createGrowthIntelligenceRequestFingerprint({
              organizationId: parsed.organizationId,
              branchId,
              channelId: null,
              kind: "market_research",
              triggerReason: "manual_retry",
              businessEvidenceDigest: null,
              marketProfileVersionId: parsed.profileVersionId,
              sourcePolicyDigest: profile.sourcePolicyDigest,
              researchRuleVersion: RESEARCH_RULE_VERSION,
              localTimeBucket: "immediate",
              synthesisVersionTuple: null,
              playbookVersionTuple: null,
            });
            const requestedBy = uuidSchema.safeParse(parsed.actorId).success
              ? parsed.actorId
              : null;
            const { data, error } = await supabase.rpc("enqueue_growth_intelligence_request", {
              p_organization_id: parsed.organizationId,
              p_request: {
                organizationId: parsed.organizationId,
                branchId,
                channelId: null,
                kind: "market_research",
                triggerReason: "manual_retry",
                businessEvidenceDigest: null,
                marketProfileVersionId: parsed.profileVersionId,
                sourcePolicyDigest: profile.sourcePolicyDigest,
                researchRuleVersion: RESEARCH_RULE_VERSION,
                localTimeBucket: "immediate",
                synthesisVersionTuple: null,
                playbookVersionTuple: null,
                requestFingerprint: fingerprint,
                dueAt: new Date().toISOString(),
                correlationId: parsed.correlationId,
                requestedBy,
              },
            });
            if (error) throw new Error("The research request could not be enqueued.");
            const record = (data ?? {}) as Record<string, unknown>;
            if (typeof record.requestId !== "string") {
              throw new Error("The research enqueue returned an unusable outcome.");
            }
            // The enqueue RPC converges on the scope fingerprint, not on
            // the thread key: identical scopes replay the kept request, and
            // the thread-linked key below dedups the run dispatch itself.
            return { requestId: record.requestId, replayed: record.replayed === true };
          },
        },
        budget: {
          reserveRequestBudget: async (input) => {
            const reservation = await budget.reserveRequestBudget({
              organizationId: input.organizationId,
              requestId: input.requestId,
              quoteMicrosUsd: TINYFISH_RESEARCH_QUOTE_MICROS_USD,
              priceVersion: TINYFISH_RESEARCH_PRICE_VERSION,
            });
            return { quoteMicrosUsd: reservation.quoteMicrosUsd };
          },
        },
        dispatch: async (input) => {
          // The executor-built thread-linked key dedups the run dispatch
          // itself; the payload key is only the caller's anti-garbage token.
          const handle = await tasks.trigger<typeof runMarketResearchTask>(
            "growth-intelligence.run-market-research",
            {
              organizationId: input.organizationId,
              requestId: input.requestId,
              correlationId: input.correlationId,
            },
            { idempotencyKey: input.idempotencyKey },
          );
          logger.info("agent_chat.research_once_dispatched", {
            organizationId: input.organizationId,
            correlationId: input.correlationId,
            requestId: input.requestId,
            runId: handle.id,
          });
          return { requestId: input.requestId, replayed: false };
        },
      },
    );

    logger.info("agent_chat.research_once_finished", {
      organizationId: parsed.organizationId,
      correlationId: parsed.correlationId,
      outcome: outcome.outcome,
    });
    await publishAgentThreadEvent({
      organizationId: parsed.organizationId,
      actorId: parsed.actorId,
      correlationId: parsed.correlationId,
      eventName: "agent_thread.research_triggered",
      payload: {
        threadId: parsed.threadId,
        messageDigest: parsed.messageDigest,
        idempotencyKey: parsed.idempotencyKey,
        outcome: outcome.outcome,
        ...("reasonCode" in outcome ? { reasonCode: outcome.reasonCode } : {}),
        ...("requestId" in outcome && typeof outcome.requestId === "string"
          ? { requestId: outcome.requestId }
          : {}),
      },
    });
    return outcome;
  },
});

// ---------------------------------------------------------------------------
// Watch create / update
// ---------------------------------------------------------------------------

export const agentWatchCreatePayloadSchema = z
  .object({
    organizationId: uuidSchema,
    actorId: z.string().trim().min(1).max(200),
    /** Thread the dispatch came from; carried into the audit event. */
    threadId: z.string().trim().min(1).max(200).optional(),
    branchId: uuidSchema,
    title: z.string().trim().min(1).max(200).optional(),
    question: z.string().trim().min(1).max(2000),
    mode: z.enum(["one-time", "recurring"]),
    schedule: z.unknown().optional(),
    researchArea: z.string().trim().min(1).max(160),
    competitors: z.array(z.unknown()).max(20).default([]),
    investigationAreas: z.array(z.string()).min(1).max(5).default(["demand"]),
    businessContextSnapshotId: uuidSchema.optional(),
    idempotencyKey: z.string().trim().min(16).max(200),
    correlationId: uuidSchema,
  })
  .strict();

export const agentWatchCreateTask = schemaTask({
  id: "agent-chat.watch-create",
  schema: agentWatchCreatePayloadSchema,
  queue: agentChatQueue,
  retry,
  maxDuration: 300,
  run: async (payload) => {
    const parsed = agentWatchCreatePayloadSchema.parse(payload);
    if (!isAgentChatEnabled(parsed.organizationId)) {
      logger.info("agent_chat.watch_create_blocked", {
        organizationId: parsed.organizationId,
        correlationId: parsed.correlationId,
        reasonCode: "AGENT_CHAT_DISABLED",
      });
      return agentChatDisabledResult(parsed.organizationId, parsed.correlationId);
    }
    const supabase = createGrowthIntelligenceWorkerServiceClient();
    const projects = createAuthenticatedResearchProjectRepository(supabase);
    const outcome = await executeWatchCreate(
      {
        organizationId: parsed.organizationId,
        actorId: parsed.actorId,
        branchId: parsed.branchId,
        ...(parsed.title ? { title: parsed.title } : {}),
        question: parsed.question,
        mode: parsed.mode,
        ...(parsed.schedule !== undefined ? { schedule: parsed.schedule } : {}),
        researchArea: parsed.researchArea,
        competitors: parsed.competitors,
        investigationAreas: parsed.investigationAreas,
        ...(parsed.businessContextSnapshotId
          ? { businessContextSnapshotId: parsed.businessContextSnapshotId }
          : {}),
        idempotencyKey: parsed.idempotencyKey,
      } as Parameters<typeof executeWatchCreate>[0],
      {
        listActive: async (input) => {
          const rows = await projects.listActiveProjects(input);
          // Live fingerprints ride through: the fingerprint-equality
          // branch pre-empts same-scope siblings (not just twins) with
          // the duplicate card, while the keyed create stays the
          // authoritative fence underneath.
          return rows.map((row) => ({
            projectId: row.projectId,
            title: row.title,
            question: row.question,
            mode: row.mode,
            scopeFingerprint: row.scopeFingerprint,
          }));
        },
        createKeyed: (input) => projects.createProject(input),
      },
    );
    logger.info("agent_chat.watch_create_finished", {
      organizationId: parsed.organizationId,
      correlationId: parsed.correlationId,
      outcome: outcome.outcome,
    });
    await publishAgentThreadEvent({
      organizationId: parsed.organizationId,
      actorId: parsed.actorId,
      correlationId: parsed.correlationId,
      eventName: "agent_thread.watch_created",
      payload: {
        threadId: parsed.threadId ?? null,
        idempotencyKey: parsed.idempotencyKey,
        outcome: outcome.outcome,
        ...("projectId" in outcome && typeof outcome.projectId === "string"
          ? { projectId: outcome.projectId }
          : {}),
        ...(outcome.outcome === "duplicate"
          ? { candidateProjectIds: outcome.candidates.map((candidate) => candidate.projectId) }
          : {}),
      },
    });
    return outcome;
  },
});

export const agentWatchUpdatePayloadSchema = z
  .object({
    organizationId: uuidSchema,
    actorId: z.string().trim().min(1).max(200),
    /** Thread the dispatch came from; carried in logs, not a new event. */
    threadId: z.string().trim().min(1).max(200).optional(),
    projectId: uuidSchema,
    edits: z.record(z.string(), z.unknown()),
    idempotencyKey: z.string().trim().min(16).max(200),
    correlationId: uuidSchema,
  })
  .strict();

async function readLatestBriefRevision(
  supabase: WorkerClient,
  organizationId: string,
  projectId: string,
): Promise<BriefRevision | null> {
  const { data, error } = await supabase
    .from("growth_intelligence_brief_revisions")
    .select("document")
    .eq("organization_id", organizationId)
    .eq("project_id", projectId)
    .order("revision_number", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const parsed = briefRevisionSchema.safeParse((data as { document?: unknown }).document);
  return parsed.success ? parsed.data : null;
}

type AgentWatchProject = {
  title: string;
  question: string;
  mode: "one-time" | "recurring";
  branchId: string;
  schedule: {
    cadence: "daily" | "weekly" | "monthly";
    localTime: string;
    timeZone: string;
    endDate?: string;
  };
};

async function readWatchProject(
  supabase: WorkerClient,
  organizationId: string,
  projectId: string,
): Promise<AgentWatchProject | null> {
  const { data, error } = await supabase
    .from("growth_intelligence_research_projects")
    .select("title,question,mode,branch_id,schedule")
    .eq("organization_id", organizationId)
    .eq("id", projectId)
    .maybeSingle();
  if (error || !data) return null;
  if (data.mode !== "one-time" && data.mode !== "recurring") return null;
  if (typeof data.branch_id !== "string") return null;
  const schedule = data.schedule as AgentWatchProject["schedule"] | null;
  if (!schedule || typeof schedule !== "object") return null;
  if (typeof data.title !== "string" || typeof data.question !== "string") return null;
  return {
    title: data.title,
    question: data.question,
    mode: data.mode,
    branchId: data.branch_id,
    schedule,
  };
}

export const agentWatchUpdateTask = schemaTask({
  id: "agent-chat.watch-update",
  schema: agentWatchUpdatePayloadSchema,
  queue: agentChatQueue,
  retry,
  maxDuration: 300,
  run: async (payload) => {
    const parsed = agentWatchUpdatePayloadSchema.parse(payload);
    if (!isAgentChatEnabled(parsed.organizationId)) {
      logger.info("agent_chat.watch_update_blocked", {
        organizationId: parsed.organizationId,
        correlationId: parsed.correlationId,
        reasonCode: "AGENT_CHAT_DISABLED",
      });
      return agentChatDisabledResult(parsed.organizationId, parsed.correlationId);
    }
    const supabase = createGrowthIntelligenceWorkerServiceClient();
    const projects = createAuthenticatedResearchProjectRepository(supabase);
    const brief = await readLatestBriefRevision(supabase, parsed.organizationId, parsed.projectId);
    if (!brief) {
      return {
        outcome: "update_blocked" as const,
        projectId: parsed.projectId,
        reasonCode: "WATCH_UPDATE_UNAVAILABLE" as const,
        copy: "This watch has no readable brief revision; nothing was changed.",
        validatedEdits: {},
      };
    }
    const project = await readWatchProject(supabase, parsed.organizationId, parsed.projectId);
    if (!project) {
      throw new Error("The watch could not be loaded.");
    }
    // Scope widening never writes: new competitors/topics return the
    // profile_scope_change proposal for the Market Profile approve flow
    // (the drawer submits it to market-profile/proposals). In-place edits
    // apply through the fenced keyed schedule-update RPC, which moves the
    // project row and — where the cadence or branch moved — a new brief
    // revision atomically. Terminal discipline holds: archived projects
    // are refused inside the RPC, never reopened.
    const outcome = await executeWatchUpdate(
      {
        organizationId: parsed.organizationId,
        actorId: parsed.actorId,
        projectId: parsed.projectId,
        project,
        brief,
        edits: parsed.edits,
        idempotencyKey: parsed.idempotencyKey,
      },
      {
        updateWatch: (input) => projects.updateProjectSchedule(input),
      },
    );
    logger.info("agent_chat.watch_update_finished", {
      organizationId: parsed.organizationId,
      correlationId: parsed.correlationId,
      projectId: parsed.projectId,
      outcome: outcome.outcome,
      ...(parsed.threadId ? { threadId: parsed.threadId } : {}),
    });
    // No domain event: an update re-points an existing watch rather than
    // creating one, so no creation vocabulary fits; the dispatch route
    // log plus the fenced update RPC trail the change.
    return outcome;
  },
});
