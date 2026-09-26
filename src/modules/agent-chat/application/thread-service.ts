import { hasOrganizationPermission } from "@/domain/access/permissions";
import type { AgentIntent } from "@/domain/agent-router/intents";
import type { EventPublisher } from "@/domain/events/types";
import type { OrganizationRole } from "@/domain/organizations/types";
import { z } from "zod";
import {
  routerProposalSchema,
  type QuestionnaireSpec,
  type RouterProposal,
} from "@/domain/agent-router/contracts";
import { routeAgentMessage } from "@/modules/agent-router/application/router-service";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { ContextPack, ContextPackReaders } from "@/modules/agent-chat/application/context-pack";
import type {
  DispatchAction,
  DispatchCampaignAdvice,
  DispatchWatchCreate,
  DispatchWatchUpdate,
} from "@/modules/agent-chat/application/api-schemas";
import {
  adviseCampaign,
  campaignBundleLink,
} from "@/modules/agent-chat/application/campaign-advise";
import {
  buildThreadIdempotencyKey,
  messageDigestFor,
} from "@/modules/agent-chat/application/thread-keys";
import {
  buildAnswerIdempotencyKey,
  encodeAnswerBody,
  writeAnswer,
  type AnswerDraft,
  type AnswerSynthesizer,
} from "@/modules/agent-chat/application/answer-writer";
import {
  encodeQuestionnaireAnswerBody,
  resolvePackContextDigest,
  validateQuestionnaireAnswers,
} from "@/modules/agent-chat/application/executors";
import type {
  ThreadMessageView,
  ThreadMode,
  ThreadRepository,
  ThreadSummary,
} from "@/modules/agent-chat/infrastructure/thread-repository";

/**
 * Agent thread service (spec sections 7-8).
 *
 * Owns the write/read orchestration the routes call: viewer gates for
 * mutations (the fenced RPCs recheck inside too — this is the honest
 * 403 before touching persistence), identifier-only audit events, and
 * the classify-only route path that forwards a validated light-model
 * proposal into the sync deterministic router.
 *
 * The router never executes and this service never spends: `routeLatest`
 * classifies the newest user message and returns intent + questionnaire
 * for the drawer to render. No research, watch, or campaign write
 * happens here; those lanes arrive in later slices.
 */

export type RouterProposer = (args: {
  text: string;
  page: string;
  contextDigest: string;
  activeWatchCount: number;
}) => Promise<unknown>;

export type ThreadServiceDeps = {
  threads: ThreadRepository;
  events?: EventPublisher;
  proposeRouter?: RouterProposer;
  correlationId?: string;
  /**
   * Real context-pack readers (Task 6 swap). When present, `routeLatest`
   * digests the deterministic HEAVY pack instead of the V1 placeholder:
   * the digest format is unchanged (`/^[0-9a-f]{16}$/`), only the values
   * shift, because the digest now means something (Task 5 report). When
   * absent, routing keeps the stable per-message placeholder.
   */
  contextReaders?: ContextPackReaders;
  /**
   * Answer synthesis seam (Slice A). Injected in tests; otherwise the
   * writer's env-gated default applies (deterministic internal-only draft
   * unless `AI_ANSWER_MODEL` plus the Google credential is set). Viewers
   * never reach persistence — they receive the draft without a stored row.
   */
  synthesizeAnswer?: AnswerSynthesizer;
  /**
   * Route-redispatch dedup (ruling L4). Re-route with the same carried
   * idempotency token for the same thread + message returns the kept
   * routing without emitting a duplicate `agent_thread.routed` event.
   * Defaults to a process-local capped cache; inject a fake in tests.
   */
  routeDedup?: RouteDedupStore;
  /**
   * Governed dispatch seams (Slice B). The trigger functions enqueue the
   * three `src/trigger/agent-chat.ts` tasks; the resolvers read
   * server-owned pointers (Market Profile version, opportunity row) the
   * worker re-validates. All optional so unit scope runs the pure paths;
   * the dispatch route wires every one.
   */
  dispatchSeams?: AgentDispatchSeams;
  /**
   * Dispatch redispatch guard. The same client token for the same thread
   * + message replays the kept outcome without a duplicate enqueue and
   * without a duplicate audit event. Defaults to a process-local capped
   * cache; inject a fake in tests.
   */
  dispatchDedup?: DispatchDedupStore;
};

/**
 * Per-process redispatch guard for classify-only routes. Classification is
 * read-only, so the only side effect worth deduping is the routed audit
 * event. Bounded FIFO: the oldest token is evicted past the cap, so a
 * long-lived process cannot grow this without limit.
 */
export type RouteDedupHit = {
  intent: AgentIntent;
  confidence: "high" | "medium" | "low";
  reasonCodes: string[];
  questionnaire: QuestionnaireSpec | null;
  routingNote: string;
  thread: ThreadSummary;
  /** Kept synthesis: message id rehydrates on replay; null when viewer-only. */
  answer: { messageId: string | null; draft: AnswerDraft } | null;
};

/**
 * One synthesized answer for a routed turn. Operators persist it as an
 * `assistant` row through the fenced keyed RPC (thread-linked answer key,
 * so redispatch replays instead of double-posting); viewers receive the
 * draft with no stored row, because viewer routes are read-only. A
 * conflicting or failed append degrades to draft-only rather than failing
 * the route — the kept row (if any) still renders from the durable read.
 */
export type RouteAnswer = {
  message: ThreadMessageView | null;
  draft: AnswerDraft;
  replayed: boolean;
};

export type RouteDedupStore = {
  get(key: string): RouteDedupHit | undefined;
  set(key: string, hit: RouteDedupHit): void;
};

const ROUTE_DEDUP_CAP = 500;
const sharedRouteDedup = (() => {
  const seen = new Map<string, RouteDedupHit>();
  const store: RouteDedupStore = {
    get: (key) => seen.get(key),
    set: (key, hit) => {
      if (!seen.has(key) && seen.size >= ROUTE_DEDUP_CAP) {
        const oldest = seen.keys().next();
        if (!oldest.done) seen.delete(oldest.value);
      }
      seen.set(key, hit);
    },
  };
  return store;
})();

/**
 * Governed dispatch (Slice B, spec sections 10-12).
 *
 * The research/watch/draft lanes become dispatchable: the service
 * rechecks the caller's grants at dispatch time (viewers refused first,
 * `growth_intelligence.manage` for research/watch,
 * `campaign.create` for drafts), requires the operator's explicit
 * confirmation, and enqueues the three `src/trigger/agent-chat.ts`
 * tasks (research/watch) or admits one governed draft through
 * `adviseCampaign` (campaign). The same client token replays the kept
 * outcome without a duplicate enqueue and without a duplicate audit
 * event. Research needs no client params: the bound Market Profile
 * pointer resolves server-side and the worker re-validates its digest.
 */

export type AgentDispatchTrigger = (payload: {
  organizationId: string;
  actorId: string;
  threadId?: string;
  idempotencyKey: string;
  correlationId: string;
} & Record<string, unknown>) => Promise<{ runId: string }>;

export type AgentOpportunityRecord = {
  id: string;
  version: number;
  status: string;
  actionKey: string;
};

export type AgentDispatchSeams = {
  triggerResearchOnce?: AgentDispatchTrigger;
  triggerWatchCreate?: AgentDispatchTrigger;
  triggerWatchUpdate?: AgentDispatchTrigger;
  resolveProfilePointer?: (input: {
    organizationId: string;
  }) => Promise<{ versionId: string; digest: string } | null>;
  resolveOpportunity?: (input: {
    organizationId: string;
    opportunityId: string;
  }) => Promise<AgentOpportunityRecord | null>;
  requestDraft?: (input: {
    organizationId: string;
    actorId: string;
    opportunityId: string;
    opportunityVersion: number;
    actionKey: "campaign.governed_draft_v1";
    objective: string;
    audience: string;
    assertions: Array<{ key: string; expectedOutcome: string }>;
    idempotencyKey: string;
    correlationId: string;
  }) => Promise<{ outcome: "created" | "replayed"; requestId: string; draftRequestStatus: string }>;
};

export type ThreadDispatchInput = {
  organizationId: string;
  actorId: string;
  role: OrganizationRole;
  threadId: string;
  action: DispatchAction;
  idempotencyKey: string;
  confirmation: { confirmed: boolean };
  watchCreate?: DispatchWatchCreate;
  watchUpdate?: DispatchWatchUpdate;
  campaignAdvice?: DispatchCampaignAdvice;
};

/**
 * Verbatim wire shape Slice C and operators depend on. Every key is
 * always present (nulls where not applicable) so the contract is
 * stable: `outcome` is `dispatched` (enqueued — the worker owns the
 * result), `replayed` (same token, kept outcome), `draft_requested`
 * (admitted now), or `brief_prefilled` (ineligible, reasons named).
 * `eventId` is the audit event for this dispatch, null when no event
 * was emitted (async lanes emit from the worker instead).
 */
export type ThreadDispatchOutcome = {
  outcome: "dispatched" | "replayed" | "draft_requested" | "brief_prefilled";
  eventId: string | null;
  replayed: boolean;
  idempotencyKey: string;
  runId: string | null;
  requestId: string | null;
  projectId: string | null;
  draftRequestId: string | null;
  briefUrl: string | null;
  reasonCodes: string[];
  link: { href: string; ref: Record<string, string | null> } | null;
};

export type DispatchDedupStore = {
  get(key: string): ThreadDispatchOutcome | undefined;
  set(key: string, hit: ThreadDispatchOutcome): void;
};

const DISPATCH_DEDUP_CAP = 500;
const sharedDispatchDedup = (() => {
  const seen = new Map<string, ThreadDispatchOutcome>();
  const store: DispatchDedupStore = {
    get: (key) => seen.get(key),
    set: (key, hit) => {
      if (!seen.has(key) && seen.size >= DISPATCH_DEDUP_CAP) {
        const oldest = seen.keys().next();
        if (!oldest.done) seen.delete(oldest.value);
      }
      seen.set(key, hit);
    },
  };
  return store;
})();

function agentResearchLink(organizationId: string): ThreadDispatchOutcome["link"] {
  return {
    href: `/organizations/${organizationId}/growth-intelligence`,
    ref: { requestId: null, projectId: null, reportId: null },
  };
}

/**
 * Permissions the router understands, derived from the caller's org role
 * in code — never from client claims.
 */
export function permissionsForRole(role: OrganizationRole): string[] {
  const permissions: string[] = [];
  if (hasOrganizationPermission(role, "growth_intelligence.manage")) {
    permissions.push("growth_intelligence.manage");
  }
  if (hasOrganizationPermission(role, "campaign.create")) {
    permissions.push("campaign.create");
  }
  return permissions;
}

function requireOperatorPlus(role: OrganizationRole): void {
  if (role === "viewer") {
    throw new DomainError("AUTHORIZATION_ERROR", "Viewers cannot change this chat.");
  }
}

/**
 * Stable per-message digest for the router input. V1 placeholder: until
 * the deterministic context-pack readers land, the route classifies
 * against the conversation position, not the full evidence pack. Pure
 * arithmetic (no node:crypto) so this module stays client-importable.
 */
export function routingContextDigest(input: {
  organizationId: string;
  threadId: string;
  messageId: string;
}): string {
  const text = `${input.organizationId}:${input.threadId}:${input.messageId}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const char = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ char, 2654435761);
    h2 = Math.imul(h2 ^ char, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

async function publishAgentEvent(
  deps: ThreadServiceDeps,
  input: {
    organizationId: string;
    actorId: string;
    eventName:
      | "agent_thread.opened"
      | "agent_message.appended"
      | "agent_thread.routed"
      | "agent_thread.research_triggered"
      | "agent_thread.watch_created"
      | "agent_thread.draft_requested";
    payload: Record<string, unknown>;
  },
): Promise<void> {
  if (!deps.events) return;
  await deps.events.publish({
    organizationId: input.organizationId,
    eventId: crypto.randomUUID(),
    eventName: input.eventName,
    occurredAt: new Date().toISOString(),
    actorType: "user",
    actorId: input.actorId,
    correlationId: deps.correlationId ?? crypto.randomUUID(),
    schemaVersion: 1,
    payload: input.payload,
  });
}

async function resolveProposal(
  deps: ThreadServiceDeps,
  args: { text: string; page: string; contextDigest: string },
): Promise<RouterProposal | null> {
  if (!deps.proposeRouter) return null;
  let raw: unknown;
  try {
    raw = await deps.proposeRouter({ ...args, activeWatchCount: 0 });
  } catch {
    return null;
  }
  const parsed = routerProposalSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

async function synthesizeAssistantAnswer(
  deps: ThreadServiceDeps,
  args: {
    organizationId: string;
    actorId: string;
    role: OrganizationRole;
    thread: ThreadSummary;
    message: ThreadMessageView;
    pack: ContextPack | null;
    routingNote: string;
  },
): Promise<RouteAnswer> {
  const draft = await writeAnswer(
    { pack: args.pack, routingNote: args.routingNote, threadId: args.thread.id, mode: args.thread.mode },
    {
      ...(deps.synthesizeAnswer !== undefined ? { synthesize: deps.synthesizeAnswer } : {}),
      ...(deps.correlationId ? { correlationId: deps.correlationId } : {}),
    },
  );
  // Viewer routes are read-only: the draft returns with no stored row, and
  // the fenced RPC is never touched.
  if (args.role === "viewer") {
    return { message: null, draft, replayed: false };
  }
  const idempotencyKey = buildAnswerIdempotencyKey({
    threadId: args.thread.id,
    messageId: args.message.id,
    body: args.message.body ?? "",
  });
  try {
    const appended = await deps.threads.appendMessageKeyed({
      organizationId: args.organizationId,
      actorId: args.actorId,
      threadId: args.thread.id,
      role: "assistant",
      body: encodeAnswerBody(draft),
      idempotencyKey,
    });
    const kept = await deps.threads.getMessage({
      organizationId: args.organizationId,
      messageId: appended.messageId,
    });
    if (!kept) {
      return { message: null, draft, replayed: appended.replayed };
    }
    // No extra audit event here: the turn's `agent_thread.routed` event
    // already trails this row by thread + message ids (ruling F6 — a
    // per-append event would double the audit volume for a derived
    // artifact while the routed event plus the durable row carry the
    // same lineage; retention keeps the content-free routed event after
    // bodies are purged). The row itself is the durable, poll-rendered
    // record.
    return { message: kept, draft, replayed: appended.replayed };
  } catch (error) {
    // A conflicting or failed answer append must not fail the route: the
    // draft still returns, and the kept row (if any) renders on the next
    // durable read. Ruling F2: the swallow is logged, structured, with
    // organization/thread/message ids only — never the body.
    logger.warn("agent_thread.answer_append_failed", {
      organizationId: args.organizationId,
      threadId: args.thread.id,
      messageId: args.message.id,
      ...(deps.correlationId ? { correlationId: deps.correlationId } : {}),
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    return { message: null, draft, replayed: false };
  }
}

async function rehydrateKeptAnswer(
  deps: ThreadServiceDeps,
  input: { organizationId: string },
  kept: RouteDedupHit,
): Promise<RouteAnswer | null> {
  if (!kept.answer) return null;
  if (!kept.answer.messageId) {
    return { message: null, draft: kept.answer.draft, replayed: true };
  }
  const message = await deps.threads.getMessage({
    organizationId: input.organizationId,
    messageId: kept.answer.messageId,
  });
  return { message, draft: kept.answer.draft, replayed: true };
}

export function createThreadService(deps: ThreadServiceDeps) {
  return {
    async listThreads(input: {
      organizationId: string;
      limit?: number;
      cursor?: string;
    }): Promise<{ threads: ThreadSummary[]; nextCursor: string | null }> {
      return deps.threads.listThreads(input);
    },

    async listMessages(input: {
      organizationId: string;
      threadId: string;
      limit?: number;
      cursor?: string;
    }): Promise<{ messages: ThreadMessageView[]; nextCursor: string | null }> {
      const thread = await deps.threads.getThread({
        organizationId: input.organizationId,
        threadId: input.threadId,
      });
      if (!thread) {
        throw new DomainError(
          "TENANT_SCOPE_ERROR",
          "This chat was not found in your organization.",
        );
      }
      return deps.threads.listMessages(input);
    },

    async createThread(input: {
      organizationId: string;
      actorId: string;
      role: OrganizationRole;
      idempotencyKey: string;
      title?: string;
      mode?: ThreadMode;
    }): Promise<{ thread: ThreadSummary; replayed: boolean }> {
      requireOperatorPlus(input.role);
      const created = await deps.threads.createThreadKeyed({
        organizationId: input.organizationId,
        actorId: input.actorId,
        idempotencyKey: input.idempotencyKey,
        ...(input.title !== undefined ? { title: input.title } : {}),
        mode: input.mode ?? "quick",
      });
      const thread = await deps.threads.getThread({
        organizationId: input.organizationId,
        threadId: created.threadId,
      });
      if (!thread) {
        throw new DomainError("DOMAIN_ERROR", "This chat could not be saved.");
      }
      if (!created.replayed) {
        await publishAgentEvent(deps, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          eventName: "agent_thread.opened",
          payload: { threadId: thread.id, mode: thread.mode },
        });
      }
      return { thread, replayed: created.replayed };
    },

    async appendUserMessage(input: {
      organizationId: string;
      actorId: string;
      role: OrganizationRole;
      threadId: string;
      idempotencyKey: string;
      body: string;
    }): Promise<{ message: ThreadMessageView; replayed: boolean }> {
      requireOperatorPlus(input.role);
      const thread = await deps.threads.getThread({
        organizationId: input.organizationId,
        threadId: input.threadId,
      });
      if (!thread) {
        throw new DomainError(
          "TENANT_SCOPE_ERROR",
          "This chat was not found in your organization.",
        );
      }
      const appended = await deps.threads.appendMessageKeyed({
        organizationId: input.organizationId,
        actorId: input.actorId,
        threadId: input.threadId,
        role: "user",
        body: input.body,
        idempotencyKey: input.idempotencyKey,
      });
      const message = await deps.threads.getMessage({
        organizationId: input.organizationId,
        messageId: appended.messageId,
      });
      if (!message) {
        throw new DomainError("DOMAIN_ERROR", "This message could not be saved.");
      }
      if (!appended.replayed) {
        await publishAgentEvent(deps, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          eventName: "agent_message.appended",
          payload: { threadId: thread.id, messageId: message.id },
        });
      }
      return { message, replayed: appended.replayed };
    },

    /**
     * Classify-only route. Reads the newest user message, forwards a
     * validated proposal into the sync router, and returns intent plus
     * questionnaire. Ruling T3d: `activeWatches` stays empty in V1 — the
     * scope fingerprint is a one-way hash, so similarity needs the brief
     * rows the router must never see; the watch lane compares them when
     * it owns creation. No duplicate-watch card can over-trigger on an
     * empty candidate list.
     *
     * Task 6: digests the real HEAVY pack when `contextReaders` are bound
     * (V1 placeholder otherwise), and dedups redispatch on the carried
     * idempotency token (ruling L4).
     */
    async routeLatest(input: {
      organizationId: string;
      actorId: string;
      role: OrganizationRole;
      threadId: string;
      page?: string;
      /**
       * Client token for the later executor dispatch. Classification is
       * read-only and unkeyed; the token is carried in the audit event so
       * the future keyed dispatch can dedup on the token that produced
       * this routing — and a repeated route with the same token replays
       * the kept routing without a duplicate event.
       */
      idempotencyKey?: string;
    }): Promise<{
      intent: AgentIntent;
      confidence: "high" | "medium" | "low";
      reasonCodes: string[];
      questionnaire: QuestionnaireSpec | null;
      routingNote: string;
      thread: ThreadSummary;
      answer: RouteAnswer | null;
      replayed: boolean;
    }> {
      const thread = await deps.threads.getThread({
        organizationId: input.organizationId,
        threadId: input.threadId,
      });
      if (!thread) {
        throw new DomainError(
          "TENANT_SCOPE_ERROR",
          "This chat was not found in your organization.",
        );
      }
      const message = await deps.threads.latestUserMessage({
        organizationId: input.organizationId,
        threadId: input.threadId,
      });
      if (!message || !message.body) {
        throw new DomainError("DOMAIN_ERROR", "This chat has no readable message to route.");
      }
      const page = (input.page ?? "overview").trim();
      if (page.length < 1 || page.length > 120) {
        throw new DomainError("VALIDATION_ERROR", "Please check the submitted fields.");
      }
      const dedup = deps.routeDedup ?? sharedRouteDedup;
      const dedupKey = input.idempotencyKey
        ? `${input.organizationId}:${thread.id}:${message.id}:${input.idempotencyKey}`
        : null;
      if (dedupKey) {
        const kept = dedup.get(dedupKey);
        if (kept) {
          return { ...kept, answer: await rehydrateKeptAnswer(deps, input, kept), replayed: true };
        }
      }
      let pack: ContextPack | null = null;
      let contextDigest: string;
      if (deps.contextReaders) {
        const resolved = await resolvePackContextDigest({
          organizationId: input.organizationId,
          userId: input.actorId,
          windowDays: 30,
          page,
          readers: deps.contextReaders,
        });
        pack = resolved.pack;
        contextDigest = resolved.digest;
      } else {
        contextDigest = routingContextDigest({
          organizationId: input.organizationId,
          threadId: thread.id,
          messageId: message.id,
        });
      }
      const proposal = await resolveProposal(deps, { text: message.body, page, contextDigest });
      const output = routeAgentMessage({
        text: message.body,
        page,
        role: input.role,
        permissions: permissionsForRole(input.role),
        contextDigest,
        activeWatches: [],
        threadMode: thread.mode,
        model:
          proposal === null
            ? { kind: "live" }
            : {
                kind: "stub",
                intent: proposal.intent,
                confidence: proposal.confidence,
                missing: proposal.missing,
              },
      });
      await publishAgentEvent(deps, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        eventName: "agent_thread.routed",
        payload: {
          threadId: thread.id,
          messageId: message.id,
          intent: output.intent,
          confidence: output.confidence,
          reasonCodes: output.reasonCodes,
          questionnaireKind: output.questionnaire?.kind ?? null,
          ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        },
      });
      const routed = {
        intent: output.intent,
        confidence: output.confidence,
        reasonCodes: output.reasonCodes,
        questionnaire: output.questionnaire,
        routingNote: output.routingNote,
        thread,
        answer: await synthesizeAssistantAnswer(deps, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          role: input.role,
          thread,
          message,
          pack,
          routingNote: output.routingNote,
        }),
      };
      if (dedupKey) {
        dedup.set(dedupKey, {
          ...routed,
          answer: routed.answer
            ? { messageId: routed.answer.message?.id ?? null, draft: routed.answer.draft }
            : null,
        });
      }
      return { ...routed, replayed: false };
    },

    /**
     * Questionnaire-answer persistence + re-route (ruling F2). Submitted
     * answers reach the server — appended to thread messages through the
     * fenced keyed RPC — and re-trigger routing in the same call. Viewers
     * are refused before persistence; the reroute carries a derived key
     * (`<answersKey>:reroute`) so it never collides with the original
     * route token (ruling L4).
     */
    async submitAnswers(input: {
      organizationId: string;
      actorId: string;
      role: OrganizationRole;
      threadId: string;
      spec: QuestionnaireSpec;
      answers: unknown;
      idempotencyKey: string;
      page?: string;
    }): Promise<{
      message: ThreadMessageView;
      replayed: boolean;
      answers: Record<string, string>;
      intent: AgentIntent;
      questionnaire: QuestionnaireSpec | null;
      answer: RouteAnswer | null;
    }> {
      requireOperatorPlus(input.role);
      const normalized = validateQuestionnaireAnswers(input.spec, input.answers);
      const thread = await deps.threads.getThread({
        organizationId: input.organizationId,
        threadId: input.threadId,
      });
      if (!thread) {
        throw new DomainError(
          "TENANT_SCOPE_ERROR",
          "This chat was not found in your organization.",
        );
      }
      const appended = await deps.threads.appendMessageKeyed({
        organizationId: input.organizationId,
        actorId: input.actorId,
        threadId: input.threadId,
        role: "user",
        body: encodeQuestionnaireAnswerBody(input.spec, normalized),
        idempotencyKey: input.idempotencyKey,
      });
      const message = await deps.threads.getMessage({
        organizationId: input.organizationId,
        messageId: appended.messageId,
      });
      if (!message) {
        throw new DomainError("DOMAIN_ERROR", "This message could not be saved.");
      }
      if (!appended.replayed) {
        await publishAgentEvent(deps, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          eventName: "agent_message.appended",
          payload: { threadId: thread.id, messageId: message.id },
        });
      }
      const routed = await this.routeLatest({
        organizationId: input.organizationId,
        actorId: input.actorId,
        role: input.role,
        threadId: input.threadId,
        ...(input.page ? { page: input.page } : {}),
        idempotencyKey: `${input.idempotencyKey}:reroute`,
      });
      return {
        message,
        replayed: appended.replayed,
        answers: normalized,
        intent: routed.intent,
        questionnaire: routed.questionnaire,
        answer: routed.answer,
      };
    },

    /**
     * Governed dispatch (Slice B). Enqueues the research/watch Trigger
     * tasks or admits one campaign draft through `adviseCampaign`.
     * Viewers are refused before persistence; grants are rechecked from
     * the role (never client claims); confirmation must be explicit; the
     * same token replays the kept outcome. Research/watch lanes emit
     * their audit events from the worker (which knows the outcome); the
     * draft lane emits `agent_thread.draft_requested` here, its
     * `adviseCampaign` caller — identifier-only payload plus
     * correlation, never bodies.
     */
    async dispatch(input: ThreadDispatchInput): Promise<ThreadDispatchOutcome> {
      requireOperatorPlus(input.role);
      const grant =
        input.action === "campaign_advice" ? "campaign.create" : "growth_intelligence.manage";
      if (!hasOrganizationPermission(input.role, grant)) {
        throw new DomainError(
          "AUTHORIZATION_ERROR",
          input.action === "campaign_advice"
            ? "Campaign drafts need the campaign.create grant."
            : "Research and watch changes need the growth_intelligence.manage grant.",
        );
      }
      if (input.confirmation?.confirmed !== true) {
        throw new DomainError(
          "VALIDATION_ERROR",
          "Confirm this action before dispatch. Nothing was enqueued.",
        );
      }
      const clientToken = z.string().trim().min(16).max(200).parse(input.idempotencyKey);
      const thread = await deps.threads.getThread({
        organizationId: input.organizationId,
        threadId: input.threadId,
      });
      if (!thread) {
        throw new DomainError(
          "TENANT_SCOPE_ERROR",
          "This chat was not found in your organization.",
        );
      }
      const message = await deps.threads.latestUserMessage({
        organizationId: input.organizationId,
        threadId: input.threadId,
      });
      if (!message || !message.body) {
        throw new DomainError("DOMAIN_ERROR", "This chat has no readable message to dispatch from.");
      }
      const dedup = deps.dispatchDedup ?? sharedDispatchDedup;
      const dedupKey = `${input.organizationId}:${thread.id}:${message.id}:${clientToken}`;
      const kept = dedup.get(dedupKey);
      if (kept) {
        return { ...kept, replayed: true };
      }
      const digest = messageDigestFor({
        threadId: thread.id,
        messageId: message.id,
        body: message.body ?? "",
      });
      const correlationId = deps.correlationId ?? crypto.randomUUID();
      const seams = deps.dispatchSeams ?? {};
      let result: ThreadDispatchOutcome;
      switch (input.action) {
        case "research_once": {
          if (!seams.resolveProfilePointer || !seams.triggerResearchOnce) {
            throw new DomainError("DOMAIN_ERROR", "Research dispatch is not wired for this chat.");
          }
          const pointer = await seams.resolveProfilePointer({
            organizationId: input.organizationId,
          });
          if (!pointer) {
            throw new DomainError(
              "VALIDATION_ERROR",
              "No current Market Profile version is bound to this chat; scoped research cannot start.",
            );
          }
          const idempotencyKey = buildThreadIdempotencyKey(thread.id, digest);
          const { runId } = await seams.triggerResearchOnce({
            organizationId: input.organizationId,
            actorId: input.actorId,
            threadId: thread.id,
            messageDigest: digest,
            profileVersionId: pointer.versionId,
            profileDigest: pointer.digest,
            correlationId,
            idempotencyKey,
          });
          // No event here: the worker emits `agent_thread.research_triggered`
          // with the outcome it owns (dispatched, blocked, or replayed).
          result = {
            outcome: "dispatched",
            eventId: null,
            replayed: false,
            idempotencyKey,
            runId,
            requestId: null,
            projectId: null,
            draftRequestId: null,
            briefUrl: null,
            reasonCodes: [],
            link: agentResearchLink(input.organizationId),
          };
          break;
        }
        case "watch_create": {
          const block = input.watchCreate;
          if (!block) {
            throw new DomainError(
              "VALIDATION_ERROR",
              "This action needs its watch parameters.",
            );
          }
          if (!seams.triggerWatchCreate) {
            throw new DomainError("DOMAIN_ERROR", "Watch dispatch is not wired for this chat.");
          }
          const idempotencyKey = buildThreadIdempotencyKey(thread.id, `${digest}:watch`);
          const { runId } = await seams.triggerWatchCreate({
            organizationId: input.organizationId,
            actorId: input.actorId,
            threadId: thread.id,
            branchId: block.branchId,
            ...(block.title ? { title: block.title } : {}),
            question: block.question,
            mode: block.mode,
            ...(block.schedule !== undefined ? { schedule: block.schedule } : {}),
            researchArea: block.researchArea,
            competitors: block.competitors,
            investigationAreas: block.investigationAreas,
            ...(block.businessContextSnapshotId
              ? { businessContextSnapshotId: block.businessContextSnapshotId }
              : {}),
            correlationId,
            idempotencyKey,
          });
          // No event here: the worker emits `agent_thread.watch_created`
          // with the outcome it owns (created, replayed, or duplicate).
          result = {
            outcome: "dispatched",
            eventId: null,
            replayed: false,
            idempotencyKey,
            runId,
            requestId: null,
            projectId: null,
            draftRequestId: null,
            briefUrl: null,
            reasonCodes: [],
            link: agentResearchLink(input.organizationId),
          };
          break;
        }
        case "watch_update": {
          const block = input.watchUpdate;
          if (!block) {
            throw new DomainError(
              "VALIDATION_ERROR",
              "This action needs its watch parameters.",
            );
          }
          if (!seams.triggerWatchUpdate) {
            throw new DomainError("DOMAIN_ERROR", "Watch dispatch is not wired for this chat.");
          }
          const idempotencyKey = buildThreadIdempotencyKey(thread.id, `${digest}:watch-update`);
          const { runId } = await seams.triggerWatchUpdate({
            organizationId: input.organizationId,
            actorId: input.actorId,
            threadId: thread.id,
            projectId: block.projectId,
            edits: block.edits,
            correlationId,
            idempotencyKey,
          });
          // No event: an update re-points an existing watch rather than
          // creating one, so no creation vocabulary fits; the route log
          // plus the fenced update RPC trail the change.
          result = {
            outcome: "dispatched",
            eventId: null,
            replayed: false,
            idempotencyKey,
            runId,
            requestId: null,
            projectId: block.projectId,
            draftRequestId: null,
            briefUrl: null,
            reasonCodes: [],
            link: {
              href: `/organizations/${input.organizationId}/growth-intelligence`,
              ref: { requestId: null, projectId: block.projectId, reportId: null },
            },
          };
          break;
        }
        case "campaign_advice": {
          const block = input.campaignAdvice;
          if (!block) {
            throw new DomainError(
              "VALIDATION_ERROR",
              "This action needs its campaign parameters.",
            );
          }
          if (!seams.resolveOpportunity) {
            throw new DomainError("DOMAIN_ERROR", "Campaign dispatch is not wired for this chat.");
          }
          const resolved = await seams.resolveOpportunity({
            organizationId: input.organizationId,
            opportunityId: block.opportunity.id,
          });
          if (!resolved) {
            throw new DomainError(
              "TENANT_SCOPE_ERROR",
              "This opportunity was not found in your organization.",
            );
          }
          if (resolved.version !== block.opportunity.version) {
            throw new DomainError(
              "VALIDATION_ERROR",
              "That opportunity changed since it was read. Refresh it and confirm again.",
            );
          }
          const advised = await adviseCampaign(
            {
              organizationId: input.organizationId,
              actorId: input.actorId,
              threadId: thread.id,
              permissions: permissionsForRole(input.role),
              opportunity: { id: block.opportunity.id, version: block.opportunity.version },
              objective: block.objective,
              audience: block.audience,
              assertions: block.assertions,
              evidenceSnapshot: block.evidenceSnapshot,
              evidenceSnapshotFreezable: block.evidenceSnapshotFreezable,
              marketProfile: block.marketProfile,
              policyPass: block.policyPass,
              capabilityPass: block.capabilityPass,
              schedulePass: block.schedulePass,
              audienceReady: block.audienceReady,
              estimate: block.estimate,
              correlationId,
              existingLinks: {
                ...(thread.linkedResearchProjectId
                  ? { projectId: thread.linkedResearchProjectId }
                  : {}),
                ...(thread.linkedRequestId ? { requestId: thread.linkedRequestId } : {}),
                ...(thread.linkedCampaignId ? { campaignId: thread.linkedCampaignId } : {}),
              },
            },
            {
              ...(seams.requestDraft ? { drafts: { requestDraft: seams.requestDraft } } : {}),
              links: {
                setThreadLinks: (linkInput) =>
                  this.setThreadLinks({
                    organizationId: linkInput.organizationId,
                    actorId: linkInput.actorId,
                    role: input.role,
                    threadId: linkInput.threadId,
                    draftRequestId: linkInput.draftRequestId,
                    ...(linkInput.projectId ? { projectId: linkInput.projectId } : {}),
                    ...(linkInput.requestId ? { requestId: linkInput.requestId } : {}),
                    ...(linkInput.campaignId ? { campaignId: linkInput.campaignId } : {}),
                  }),
              },
            },
          );
          if (advised.outcome === "brief_prefilled") {
            result = {
              outcome: "brief_prefilled",
              eventId: null,
              replayed: false,
              idempotencyKey: buildThreadIdempotencyKey(thread.id, digest),
              runId: null,
              requestId: null,
              projectId: null,
              draftRequestId: null,
              briefUrl: advised.briefUrl,
              reasonCodes: [...advised.reasonCodes],
              link: null,
            };
            break;
          }
          let eventId: string | null = null;
          if (advised.draftRequestId !== "pending") {
            eventId = crypto.randomUUID();
            await publishAgentEvent(deps, {
              organizationId: input.organizationId,
              actorId: input.actorId,
              eventName: "agent_thread.draft_requested",
              payload: {
                threadId: thread.id,
                draftRequestId: advised.draftRequestId,
                opportunityId: block.opportunity.id,
                idempotencyKey: advised.idempotencyKey,
              },
            });
          }
          const bundleLink = campaignBundleLink(input.organizationId, {
            draftRequestId: advised.draftRequestId,
          });
          result = {
            outcome: "draft_requested",
            eventId,
            replayed: false,
            idempotencyKey: advised.idempotencyKey,
            runId: null,
            requestId: null,
            projectId: null,
            draftRequestId: advised.draftRequestId,
            briefUrl: null,
            reasonCodes: [],
            link: {
              href: bundleLink.href,
              ref: {
                draftRequestId: bundleLink.ref.draftRequestId,
                campaignId: bundleLink.ref.campaignId,
              },
            },
          };
          break;
        }
      }
      dedup.set(dedupKey, result);
      return { ...result, replayed: false };
    },

    /**
     * Governed thread link update (spec section 11 audit chain). Links
     * thread → research project / request / draft request / campaign
     * through the fenced `set_thread_links` RPC. Viewers are refused
     * before persistence; foreign threads read as not-found. The
     * campaign-advice handoff calls this after admitting a draft request
     * so thread, draft request, and (once the worker completes it)
     * campaign stay identifier-linked.
     */
    async setThreadLinks(input: {
      organizationId: string;
      actorId: string;
      role: OrganizationRole;
      threadId: string;
      projectId?: string | null;
      requestId?: string | null;
      draftRequestId?: string | null;
      campaignId?: string | null;
    }): Promise<{
      threadId: string;
      projectId: string | null;
      requestId: string | null;
      draftRequestId: string | null;
      campaignId: string | null;
    }> {
      requireOperatorPlus(input.role);
      const thread = await deps.threads.getThread({
        organizationId: input.organizationId,
        threadId: input.threadId,
      });
      if (!thread) {
        throw new DomainError(
          "TENANT_SCOPE_ERROR",
          "This chat was not found in your organization.",
        );
      }
      return deps.threads.setThreadLinks({
        organizationId: input.organizationId,
        actorId: input.actorId,
        threadId: input.threadId,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.requestId ? { requestId: input.requestId } : {}),
        ...(input.draftRequestId ? { draftRequestId: input.draftRequestId } : {}),
        ...(input.campaignId ? { campaignId: input.campaignId } : {}),
      });
    },
  };
}

export type ThreadService = ReturnType<typeof createThreadService>;
