import type { SupabaseClient } from "@supabase/supabase-js";
import {
  logger,
  queue,
  schemaTask,
  tasks,
  wait,
  schedules,
  idempotencyKeys,
} from "@trigger.dev/sdk";
import { z } from "zod";

import { briefRevisionSchema, type BriefRevision } from "@/domain/growth-intelligence/brief";
import { isResearchProviderQualified } from "@/domain/growth-intelligence/research-budget";
import { createGrowthIntelligenceRequestFingerprint } from "@/domain/growth-intelligence/request-fingerprint";
import { createEventPublisher } from "@/domain/events/publisher";
import type { Database } from "@/lib/supabase/database.types";
import { DomainError } from "@/lib/errors";
import type { AgentTurnView } from "@/modules/agent-chat/infrastructure/turn-repository";
import type { AgentReportScope } from "@/modules/agent-chat/application/report-intake";
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
import { isResearchBudgetUncapped } from "@/modules/growth-intelligence/infrastructure/research/budget-policy";
import { createResearchProviderQualification } from "@/modules/growth-intelligence/infrastructure/research/qualification";
import { createAuthenticatedResearchProjectRepository } from "@/modules/growth-intelligence/infrastructure/research-project-repository";
import { readAgentResearchProfileVersion } from "@/modules/agent-chat/infrastructure/research-profile-reader";
import { createAgentWatchProjectSeams } from "@/modules/agent-chat/application/api";
import { createActorAuthorizedWatchRepository, runWithCurrentActorAuthority } from "@/modules/agent-chat/application/worker-watch-authority";
import { assertWorkerWatchManageAuthority } from "@/modules/agent-chat/infrastructure/worker-watch-authorization";
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
  branchId?: string | null,
): Promise<AgentProfileRead | null> {
  const result = await readAgentResearchProfileVersion(supabase, {
    organizationId, versionId, branchId: branchId ?? null,
  });
  if (result.kind === "ready") return result.profile;
  logger.warn("agent_chat.profile_guard_blocked", {
    organizationId, profileVersionId: versionId, reasonCode: result.reasonCode,
  });
  return null;
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

function currentQueuedGrowthAuthority(
  supabase: WorkerClient,
  input: { organizationId: string; actorId: string; correlationId: string;
    operation: "research_once" | "watch_create" | "watch_update" },
): () => Promise<void> {
  return async () => {
    try {
      await assertWorkerWatchManageAuthority(supabase, {
        organizationId: input.organizationId, actorId: input.actorId,
      });
    } catch (error) {
      logger.warn("agent_chat.queued_action_authority_refused", {
        organizationId: input.organizationId, actorId: input.actorId,
        correlationId: input.correlationId, operation: input.operation,
        reasonCode: error instanceof DomainError ? error.code : "INTEGRATION_ERROR",
      });
      throw error;
    }
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

    const assertCurrentAuthority = currentQueuedGrowthAuthority(supabase, {
      ...parsed, operation: "research_once",
    });
    await assertCurrentAuthority();

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
          parsed.branchId ?? null,
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
            const { data, error } = await runWithCurrentActorAuthority(assertCurrentAuthority,
              () => supabase.rpc("enqueue_growth_intelligence_request", {
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
            }));
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
            // ADR 0077: uncapped runtime policy skips only the day-allowance
            // comparison inside the governed RPC. The reservation call, ledger
            // row, quote bounds, and authority rechecks all still run, and
            // the bypass is logged for audit. Default is capped.
            const skipAllowance = isResearchBudgetUncapped();
            if (skipAllowance) {
              logger.info("agent_chat.research_budget_allowance_bypassed", {
                organizationId: parsed.organizationId,
                requestId: input.requestId,
              });
            }
            const reservation = await runWithCurrentActorAuthority(assertCurrentAuthority,
              () => budget.reserveRequestBudget({
              organizationId: input.organizationId,
              requestId: input.requestId,
              quoteMicrosUsd: TINYFISH_RESEARCH_QUOTE_MICROS_USD,
              priceVersion: TINYFISH_RESEARCH_PRICE_VERSION,
              ...(skipAllowance ? { skipAllowance: true as const } : {}),
            }));
            return { quoteMicrosUsd: reservation.quoteMicrosUsd };
          },
        },
        dispatch: async (input) => {
          // The executor-built thread-linked key dedups the run dispatch
          // itself; the payload key is only the caller's anti-garbage token.
          const handle = await runWithCurrentActorAuthority(assertCurrentAuthority,
            () => tasks.trigger<typeof runMarketResearchTask>(
            "growth-intelligence.run-market-research",
            {
              organizationId: input.organizationId,
              requestId: input.requestId,
              correlationId: input.correlationId,
            },
            { idempotencyKey: input.idempotencyKey },
          ));
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
    const assertCurrentAuthority = currentQueuedGrowthAuthority(supabase, { ...parsed, operation: "watch_create" });
    await assertCurrentAuthority();
    const projects = createActorAuthorizedWatchRepository(
      createAuthenticatedResearchProjectRepository(supabase),
      assertCurrentAuthority,
    );
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
        ...createAgentWatchProjectSeams(supabase, projects),
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
    const assertCurrentAuthority = currentQueuedGrowthAuthority(supabase, { ...parsed, operation: "watch_update" });
    await assertCurrentAuthority();
    const projects = createActorAuthorizedWatchRepository(
      createAuthenticatedResearchProjectRepository(supabase),
      assertCurrentAuthority,
    );
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

// ---------------------------------------------------------------------------
// Report attachment intake (governed §21.3, ADR 0075)
// ---------------------------------------------------------------------------

export const agentAttachmentPayloadSchema = z
  .object({
    organizationId: uuidSchema,
    turnId: uuidSchema,
    attachmentId: uuidSchema,
  })
  .strict();

export type AgentAttachmentPayload = z.infer<typeof agentAttachmentPayloadSchema>;

type AgentAttachmentRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message?: string } | null }>;

function agentAttachmentRpc(supabase: WorkerClient): AgentAttachmentRpc {
  return async (name, args) => {
    const { data, error } = await (
      supabase.rpc as unknown as (
        rpcName: string,
        rpcArgs: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message?: string } | null }>
    )(name, args);
    return { data, error };
  };
}

const TURN_SETTLED_PATTERNS = [
  "agent_turn_stale",
  "agent_turn_not_found",
  "agent_turn_actor_revoked",
  "agent_turn_attempts_exhausted",
  "agent_turn_forbidden",
];

/**
 * Identifier-only intake worker for one staged chat attachment. Claims the
 * turn under a fresh lease, verifies bytes before trusting them, reuses
 * exact duplicates, asks a person (server-owned challenge) for ambiguous
 * or changed scope, and promotes new files through the source-owned
 * report service — never approving mappings, admissions, or corrections
 * itself. Terminal states are idempotent: a redelivered run finds the
 * kept outcome instead of a second package.
 */
export const agentAttachmentTask = schemaTask({
  id: "agent-chat.process-attachment",
  schema: agentAttachmentPayloadSchema,
  queue: agentChatQueue,
  retry,
  maxDuration: 300,
  run: async (payload, { ctx }): Promise<Record<string, unknown>> => {
    const parsed = agentAttachmentPayloadSchema.parse(payload);
    const correlationId = parsed.turnId;
    if (!isAgentChatEnabled(parsed.organizationId)) {
      logger.info("agent_chat.attachment_blocked", {
        organizationId: parsed.organizationId,
        correlationId,
        reasonCode: "AGENT_CHAT_DISABLED",
      });
      return agentChatDisabledResult(parsed.organizationId, correlationId);
    }
    const supabase = createGrowthIntelligenceWorkerServiceClient();
    const { turnPersistenceFor } = await import("@/modules/agent-chat/application/turn-api");
    const { createAgentTurnRepository } = await import(
      "@/modules/agent-chat/infrastructure/turn-repository"
    );
    const repository = createAgentTurnRepository(turnPersistenceFor(supabase));
    const lease = {
      organizationId: parsed.organizationId,
      turnId: parsed.turnId,
      leaseToken: crypto.randomUUID(),
    };
    const turn = await repository.getTurnById(parsed.organizationId, parsed.turnId);
    if (!turn || turn.objective !== "report_intake") return { outcome: "turn_unavailable" };
    try {
      await repository.claim(lease);
    } catch (error) {
      return unavailableTurn(error, repository, lease);
    }
    try {
      await repository.appendEvent({
        ...lease,
        eventKey: `attachment:${parsed.attachmentId}:uploaded`,
        eventType: "report_uploaded",
        payload: { attachmentId: parsed.attachmentId },
      });
      const { processAgentAttachment } = await import(
        "@/modules/agent-chat/application/report-intake-worker"
      );
      const { readAgentReportContinuation } = await import(
        "@/modules/agent-chat/application/report-intake-continuation"
      );
      const { runAgentReportContinuationStep } = await import(
        "@/modules/agent-chat/application/report-turn-runner"
      );
      let packageId: string | undefined;
      for (let step = 0; step < 180; step += 1) {
        await repository.heartbeat(lease);
        if (!packageId) {
          const intake = await processAgentAttachment({
            supabase,
            ...lease,
            attachmentId: parsed.attachmentId,
          });
          if (intake.kind === "metadata_required" || intake.kind === "correction_required")
            return { outcome: intake.kind, challengeId: intake.challengeId };
          if (intake.kind === "duplicate_verification_pending") {
            await wait.for({ seconds: 5 });
            continue;
          }
          if (!("packageId" in intake)) throw new Error("Agent attachment package is unavailable.");
          packageId = intake.packageId;
        }
        const outcome = await runAgentReportContinuationStep(parsed, {
          currentRole: () => currentTurnRole(repository, lease),
          continueReport: () =>
            readAgentReportContinuation({
              supabase,
              ...lease,
              attachmentId: parsed.attachmentId,
              packageId,
            }),
          appendEvent: (event) => repository.appendEvent({ ...lease, ...event }),
          setApproval: (approval) => repository.setApproval({ ...lease, ...approval }),
          complete: (answer) => repository.complete({ ...lease, ...answer }),
          finishAssessment: (report) =>
            runGovernedAnswerWorker({
              supabase,
              repository,
              lease,
              turn,
              report: {
                scope: report.scope,
                reportHref: report.reportHref,
                partial: report.partial,
              },
            }),
        });
        if (outcome.kind === "revoked") {
          await repository.cancelRevoked(lease);
          return { outcome: "revoked" };
        }
        if (outcome.kind !== "waiting") return { outcome: outcome.kind, packageId };
        await wait.for({
          seconds: Math.max(1, Math.min(30, Math.ceil(outcome.nextPollAfterMs / 1000))),
        });
      }
      await repository.fail({ ...lease, failureCode: "REPORT_PROCESSING_TIMED_OUT" });
      return { outcome: "failed" };
    } catch (error) {
      const code = agentTurnFailureCode(error);
      logger.warn("agent_chat.attachment_failed", {
        organizationId: parsed.organizationId,
        turnId: parsed.turnId,
        correlationId,
        errorCode: error instanceof Error ? error.name : "unknown",
        attempt: ctx.attempt.number,
      });
      if (/actor_revoked/.test(code)) {
        await repository.cancelRevoked(lease);
        return { outcome: "revoked" };
      }
      if (/expired/i.test(code)) {
        await repository.fail({ ...lease, failureCode: "ATTACHMENT_EXPIRED" });
        return { outcome: "failed" };
      }
      if (/invalid|size|digest|bytes/i.test(code)) {
        await repository.fail({ ...lease, failureCode: "ATTACHMENT_INVALID" });
        return { outcome: "failed" };
      }
      if (ctx.attempt.number >= retry.maxAttempts) {
        await repository.fail({ ...lease, failureCode: "ATTACHMENT_PROCESSING_FAILED" });
        return { outcome: "failed" };
      }
      await repository.releaseForRetry(lease);
      throw error;
    }
  },
});

export const agentProcessTurnPayloadSchema = z
  .object({
    organizationId: uuidSchema,
    turnId: uuidSchema,
  })
  .strict();

/** Finite capability runner. Payload carries ids; the database owns actor,
 * question, scope, lease, events and the only final assistant message. */
export const agentProcessTurnTask = schemaTask({
  id: "agent-chat.process-turn",
  schema: agentProcessTurnPayloadSchema,
  queue: agentChatQueue,
  retry,
  maxDuration: 300,
  run: async (payload, { ctx }): Promise<Record<string, unknown>> => {
    if (!isAgentChatEnabled(payload.organizationId)) {
      return agentChatDisabledResult(payload.organizationId, payload.turnId);
    }
    const supabase = createGrowthIntelligenceWorkerServiceClient();
    const { turnPersistenceFor } = await import("@/modules/agent-chat/application/turn-api");
    const { createAgentTurnRepository } = await import(
      "@/modules/agent-chat/infrastructure/turn-repository"
    );
    const repository = createAgentTurnRepository(turnPersistenceFor(supabase));
    const turn = await repository.getTurnById(payload.organizationId, payload.turnId);
    if (!turn || turn.objective === "report_intake") return { outcome: "attachment_required" };
    if (turn.objective !== "business_advice" && turn.objective !== "channel_assessment") {
      return { outcome: "unsupported_objective" };
    }
    const lease = { ...payload, leaseToken: crypto.randomUUID() };
    try {
      await repository.claim(lease);
    } catch (error) {
      return unavailableTurn(error, repository, lease);
    }
    try {
      const result = await runGovernedAnswerWorker({ supabase, repository, lease, turn });
      return { outcome: result.kind };
    } catch (error) {
      logger.warn("agent_chat.turn_failed", {
        organizationId: payload.organizationId,
        turnId: payload.turnId,
        correlationId: payload.turnId,
        errorCode: error instanceof Error ? error.name : "unknown",
        attempt: ctx.attempt.number,
      });
      if (agentTurnFailureCode(error).includes("agent_turn_actor_revoked")) {
        await repository.cancelRevoked(lease);
        return { outcome: "revoked" };
      }
      if (ctx.attempt.number >= retry.maxAttempts) {
        await repository.fail({ ...lease, failureCode: "TURN_PROCESSING_FAILED" });
        return { outcome: "failed" };
      }
      await repository.releaseForRetry(lease);
      throw error;
    }
  },
});

type TurnRepository = ReturnType<
  typeof import("@/modules/agent-chat/infrastructure/turn-repository").createAgentTurnRepository
>;
type TurnLease = { organizationId: string; turnId: string; leaseToken: string };
async function currentTurnRole(repository: TurnRepository, lease: TurnLease) {
  try {
    return (await repository.getActorRole(lease)).role;
  } catch (error) {
    if (error instanceof DomainError && error.code === "AUTHORIZATION_ERROR") return null;
    throw error;
  }
}
async function unavailableTurn(
  error: unknown,
  repository: TurnRepository,
  lease: TurnLease,
): Promise<Record<string, unknown>> {
  const code = agentTurnFailureCode(error);
  if (code.includes("agent_turn_actor_revoked")) {
    await repository.cancelRevoked(lease);
    return { outcome: "revoked" };
  }
  if (code.includes("agent_turn_attempts_exhausted")) {
    await repository.failExhausted({ organizationId: lease.organizationId, turnId: lease.turnId });
    return { outcome: "failed" };
  }
  if (TURN_SETTLED_PATTERNS.some((pattern) => code.includes(pattern)))
    return { outcome: "turn_unavailable" };
  throw error;
}
async function runGovernedAnswerWorker(input: {
  supabase: WorkerClient;
  repository: TurnRepository;
  lease: TurnLease;
  turn: AgentTurnView;
  report?: { scope: AgentReportScope; reportHref: string; partial: boolean };
}): Promise<import("@/modules/agent-chat/application/governed-turn-runner").GovernedTurnOutcome> {
  const { supabase, repository, lease, turn, report } = input;
  const { data: message, error: messageError } = await supabase
    .from("agent_messages")
    .select("id,body,role,thread_id,created_at")
    .eq("organization_id", lease.organizationId)
    .eq("thread_id", turn.threadId)
    .eq("id", turn.userMessageId)
    .maybeSingle();
  const { data: thread, error: threadError } = await supabase
    .from("agent_threads")
    .select("id,mode")
    .eq("organization_id", lease.organizationId)
    .eq("id", turn.threadId)
    .maybeSingle();
  if (
    messageError ||
    threadError ||
    !message ||
    !thread ||
    message.role !== "user" ||
    typeof message.body !== "string" ||
    !message.body.trim()
  ) {
    await repository.fail({ ...lease, failureCode: "TURN_CONTEXT_UNAVAILABLE" });
    return { kind: "failed" as const };
  }
  const question = message.body.trim().slice(0, 8000);
  const [
    { runGovernedAgentTurn },
    { loadAgentAdviceContext },
    { assessChannelForAgentWithSession },
    { buildAgentContextPack },
    { createAgentContextReaders, readAgentRecentQuestions, resolveAgentContextScope },
    { bindAgentContextScope },
    { writeAnswer },
  ] = await Promise.all([
    import("@/modules/agent-chat/application/governed-turn-runner"),
    import("@/modules/agent-chat/application/advice-context-reader"),
    import("@/modules/agent-chat/application/channel-assessment-adapter"),
    import("@/modules/agent-chat/application/context-pack"),
    import("@/modules/agent-chat/application/api"),
    import("@/modules/agent-chat/application/research-scope"),
    import("@/modules/agent-chat/application/answer-writer"),
  ]);
  const recentQuestions = await readAgentRecentQuestions(supabase, {
    organizationId: lease.organizationId,
    threadId: turn.threadId,
    beforeCreatedAt: message.created_at,
  });
  let pendingAnalysisRunId: string | undefined;
  const savedEvents = await repository.listEvents(lease.organizationId, lease.turnId);
  const startedEvent = savedEvents.find((event) => event.type === "analysis_started");
  if (startedEvent && typeof startedEvent.payload.runId === "string")
    pendingAnalysisRunId = startedEvent.payload.runId;
  const scope = z
    .object({
      channelId: uuidSchema.optional(),
      from: z.iso.date().optional(),
      to: z.iso.date().optional(),
    })
    .strict()
    .parse(turn.answeredChallengeKind === "scope" ? (turn.challengeAnswers ?? {}) : {});
  if (report)
    Object.assign(scope, {
      channelId: report.scope.channelId,
      from: report.scope.periodStart,
      to: report.scope.periodEnd,
    });
  if (startedEvent && !report) {
    const savedScope = z
      .object({ channelId: uuidSchema, periodStart: z.iso.date(), periodEnd: z.iso.date() })
      .passthrough()
      .safeParse(startedEvent.payload);
    if (savedScope.success)
      Object.assign(scope, {
        channelId: savedScope.data.channelId,
        from: savedScope.data.periodStart,
        to: savedScope.data.periodEnd,
      });
  }
  const role = async () => {
    try {
      return (await repository.getActorRole(lease)).role;
    } catch (error) {
      if (error instanceof DomainError && error.code === "AUTHORIZATION_ERROR") return null;
      throw error;
    }
  };
  for (let step = 0; step < 180; step += 1) {
    await repository.heartbeat(lease);
    const outcome = await runGovernedAgentTurn(
      {
        ...lease,
        threadId: turn.threadId,
        userMessageId: turn.userMessageId,
        actorId: turn.requestedBy,
        objective: report
          ? "channel_assessment"
          : (turn.objective as "business_advice" | "channel_assessment"),
        mode: thread.mode,
        question,
      },
      {
        currentRole: role,
        readAdvice: async (assessmentScope) =>
          loadAgentAdviceContext({
            supabase,
            organizationId: lease.organizationId,
            actorId: turn.requestedBy,
            role: (await repository.getActorRole(lease)).role,
            question,
            correlationId: lease.turnId,
            ...(scope.channelId ? { channelId: scope.channelId } : {}),
            ...(scope.from && scope.to
              ? { requestedPeriod: { start: scope.from, end: scope.to } }
              : {}),
            ...(assessmentScope
              ? {
                  channelId: assessmentScope.channelId,
                  requestedPeriod: assessmentScope.period,
                  allowPeriodFallback: false,
                }
              : {}),
            ...(report
              ? {
                  branchId: report.scope.branchId,
                  currency: report.scope.currency,
                  allowPeriodFallback: false,
                }
              : {}),
          }),
        readPack: async () => {
          const contextScope = report
            ? { kind: "branch" as const, branchId: report.scope.branchId }
            : await resolveAgentContextScope(supabase, {
                organizationId: lease.organizationId,
                question,
              });
          return buildAgentContextPack({
            organizationId: lease.organizationId,
            userId: turn.requestedBy,
            page: "agent",
            windowDays: 30,
            ...bindAgentContextScope(contextScope, createAgentContextReaders(supabase)),
          });
        },
        assessChannel: () =>
          assessChannelForAgentWithSession({
            supabase,
            ...lease,
            actorId: turn.requestedBy,
            question,
            correlationId: lease.turnId,
            ...scope,
            allowDispatch: true,
            analysisRunId: lease.turnId,
            pendingAnalysisRunId,
            ...(report ? { branchId: report.scope.branchId, allowPeriodFallback: false } : {}),
          }),
        answer: async (input) => {
          const draft = await writeAnswer(
            {
              ...input,
              recentQuestions,
              routingNote:
                "Answer the user's business question using the source-owned evidence and give concrete next steps.",
            },
            { correlationId: lease.turnId },
          );
          if (!report) return draft;
          return {
            ...draft,
            links: [
              ...(draft.links ?? []),
              { label: "Open governed report review", href: report.reportHref },
            ].slice(0, 10),
            limitations: report.partial
              ? [
                  ...draft.limitations,
                  "This report is partially projected; conclusions cover its current validated rows only.",
                ].slice(0, 30)
              : draft.limitations,
          };
        },
        appendEvent: async (input) => {
          const receipt = await repository.appendEvent({ ...lease, ...input });
          if (input.eventType === "analysis_started" && typeof input.payload.runId === "string") {
            pendingAnalysisRunId = input.payload.runId;
            const savedScope = z
              .object({ channelId: uuidSchema, periodStart: z.iso.date(), periodEnd: z.iso.date() })
              .passthrough()
              .parse(input.payload);
            Object.assign(scope, {
              channelId: savedScope.channelId,
              from: savedScope.periodStart,
              to: savedScope.periodEnd,
            });
          }
          return receipt;
        },
        setChallenge: (input) => repository.setChallenge({ ...lease, ...input }),
        complete: (input) => repository.complete({ ...lease, ...input }),
      },
    );
    if (outcome.kind === "revoked") {
      await repository.cancelRevoked(lease);
      return { kind: "revoked" as const };
    }
    if (outcome.kind !== "waiting") return outcome;
    await wait.for({
      seconds: Math.max(1, Math.min(30, Math.ceil(outcome.nextPollAfterMs / 1000))),
    });
  }
  await repository.fail({ ...lease, failureCode: "ANALYSIS_TIMED_OUT" });
  return { kind: "failed" as const };
}

function agentTurnFailureCode(error: unknown): string {
  if (
    error instanceof DomainError &&
    error.cause &&
    typeof error.cause === "object" &&
    "reasonCode" in error.cause &&
    typeof error.cause.reasonCode === "string"
  )
    return error.cause.reasonCode;
  return error instanceof Error ? error.message : "";
}

/** Recovers abandoned leases and observes source approval, without granting it. */
export const agentTurnRecoveryTask = schedules.task({
  id: "agent-chat.recover-turns",
  cron: "*/5 * * * *",
  retry,
  run: async () => {
    const supabase = createGrowthIntelligenceWorkerServiceClient();
    const { turnPersistenceFor } = await import("@/modules/agent-chat/application/turn-api");
    const { createAgentTurnRepository } = await import(
      "@/modules/agent-chat/infrastructure/turn-repository"
    );
    const repository = createAgentTurnRepository(turnPersistenceFor(supabase));
    const now = new Date();
    const { data, error } = await supabase
      .from("agent_turns")
      .select("id,organization_id,objective,status,pending_approval,lease_expires_at,updated_at")
      .in("status", ["queued", "running", "awaiting_approval", "awaiting_user"])
      .lt("updated_at", new Date(now.getTime() - 180_000).toISOString())
      .order("updated_at", { ascending: true })
      .limit(100);
    if (error) throw new Error("Agent turn recovery read failed.");
    let resumed = 0;
    for (const row of data ?? []) {
      if (!isAgentChatEnabled(row.organization_id)) continue;
      try {
        await repository.cancelRevoked({ organizationId: row.organization_id, turnId: row.id });
        continue;
      } catch (error) {
        if (!agentTurnFailureCode(error).includes("agent_turn_actor_still_authorized")) throw error;
      }
      if (row.status === "awaiting_user") continue;
      if (
        row.status === "running" &&
        row.lease_expires_at &&
        row.lease_expires_at > now.toISOString()
      )
        continue;
      if (row.status === "awaiting_approval") {
        const approval = z
          .object({ packageId: uuidSchema })
          .passthrough()
          .safeParse(row.pending_approval);
        if (!approval.success) continue;
        try {
          await repository.resumeApproval({
            organizationId: row.organization_id,
            turnId: row.id,
            packageId: approval.data.packageId,
          });
        } catch (error) {
          const reason = agentTurnFailureCode(error);
          if (
            /agent_approval_not_recorded|agent_turn_(approval_pending|actor_revoked|forbidden|stale|not_found)/.test(
              reason,
            )
          )
            continue;
          throw error;
        }
      }
      const ids = { organizationId: row.organization_id, turnId: row.id };
      const key = await idempotencyKeys.create(
        `agent-recover:${row.id}:${Math.floor(now.getTime() / 300_000)}`,
        { scope: "global" },
      );
      if (row.objective === "report_intake") {
        const attachments = await repository.listAttachments(row.organization_id, row.id);
        const attachment = attachments.find(
          (file) => file.status === "verified" || file.status === "promoted",
        );
        if (!attachment) continue;
        await tasks.trigger<typeof agentAttachmentTask>(
          "agent-chat.process-attachment",
          { ...ids, attachmentId: attachment.id },
          { idempotencyKey: key },
        );
      } else if (row.objective === "business_advice" || row.objective === "channel_assessment") {
        await tasks.trigger<typeof agentProcessTurnTask>("agent-chat.process-turn", ids, {
          idempotencyKey: key,
        });
      } else continue;
      resumed += 1;
    }
    return { resumed };
  },
});

/** Bounded private staging erasure. Source report bytes retain their own lifecycle. */
export const agentChatRetentionTask = schedules.task({
  id: "agent-chat.purge-thread-retention",
  cron: "0 3 * * *",
  retry,
  run: async () => {
    const supabase = createGrowthIntelligenceWorkerServiceClient();
    const rpc = agentAttachmentRpc(supabase);
    const result = await rpc("purge_expired_agent_threads", {
      p_older_than: new Date(Date.now() - 90 * 86_400_000).toISOString(),
    });
    if (result.error) throw new Error("Agent thread retention failed.");
    const receipt = z
      .object({
        stagingObjects: z
          .array(
            z
              .object({
                attachmentId: uuidSchema,
                bucketId: z.literal("agent-report-staging"),
                path: z.string().min(1).max(500),
              })
              .strict(),
          )
          .max(100),
      })
      .passthrough()
      .parse(result.data);
    let removed = 0;
    for (const file of receipt.stagingObjects) {
      const removal = await supabase.storage.from(file.bucketId).remove([file.path]);
      if (removal.error) throw new Error("Agent attachment staging cleanup failed.");
      const ack = await rpc("mark_agent_attachment_staging_deleted", {
        p_attachment_ids: [file.attachmentId],
      });
      if (ack.error) throw new Error("Agent attachment cleanup acknowledgment failed.");
      removed += 1;
    }
    return { removed };
  },
});
