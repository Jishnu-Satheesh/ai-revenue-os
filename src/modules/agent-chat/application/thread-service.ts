import { hasOrganizationPermission } from "@/domain/access/permissions";
import type { AgentIntent } from "@/domain/agent-router/intents";
import type { EventPublisher } from "@/domain/events/types";
import type { OrganizationRole } from "@/domain/organizations/types";
import { z } from "zod";
import {
  routerProposalSchema,
  questionnaireSpecSchema,
  type QuestionnaireSpec,
  type RouterProposal,
} from "@/domain/agent-router/contracts";
import { routeAgentMessage } from "@/modules/agent-router/application/router-service";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { ContextPack, ContextPackReaders } from "@/modules/agent-chat/application/context-pack";
import { bindAgentContextScope, type AgentContextScope } from "./research-scope";
import type { AgentAdviceContext } from "@/modules/agent-chat/application/advice-context";
import type { ChannelAssessmentOutcome } from "@/modules/agent-chat/application/channel-assessment";
import type {
  DispatchAction,
  DispatchCampaignAdvice,
  DispatchWatchCreate,
  DispatchWatchUpdate,
} from "@/modules/agent-chat/application/api-schemas";
import {
  adviseCampaign,
  campaignBundleLink,
  generateCampaignIdeas,
} from "@/modules/agent-chat/application/campaign-advise";
import {
  buildThreadIdempotencyKey,
  messageDigestFor,
} from "@/modules/agent-chat/application/thread-keys";
import {
  answerDraftSchema,
  buildAnswerIdempotencyKey,
  buildFallbackAnswer,
  encodeAnswerBody,
  parseAnswerBody,
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
import {
  encodeQuestionnaireState,
  bindQuestionnaireToMessage,
  parseQuestionnaireState,
  type QuestionnairePayload,
  type QuestionnaireState,
} from "@/modules/agent-chat/application/questionnaire-state";

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
  questionnaireAuthority?: {
    sign: (payload: QuestionnairePayload) => QuestionnaireState;
    verify: (state: QuestionnaireState, organizationId: string, threadId: string) => boolean;
  };
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
  /** Exact persisted question resolves branch identity through tenant-bound source reads. */
  resolveContextScope?: (input: {
    organizationId: string;
    question: string;
  }) => Promise<AgentContextScope>;
  /** Reads bounded source-owned advice under the current actor's grant. */
  loadAdviceContext?: (input: {
    organizationId: string;
    actorId: string;
    role: OrganizationRole;
    question: string;
    page: string;
  }) => Promise<AgentAdviceContext>;
  /**
   * Channel assessment for `channel_assessment` routes (session-bound,
   * permission-checked inside). Absent, the route answers from the advice
   * context alone and names the missing assessment honestly. Never throws
   * for assessment behavior: a failed read degrades to limitations, exactly
   * like the advice seam above.
   */
  assessChannel?: (input: {
    organizationId: string;
    actorId: string;
    role: OrganizationRole;
    question: string;
    correlationId: string;
  }) => Promise<ChannelAssessmentOutcome>;
  /**
   * Answer synthesis seam (Slice A). Injected in tests; otherwise the
   * writer's env-gated default applies (deterministic internal-only draft
   * unless `AI_ANSWER_MODEL` plus the Google credential is set). Viewers
   * never reach persistence — they receive the draft without a stored row.
   */
  synthesizeAnswer?: AnswerSynthesizer;
  /**
   * Campaign-ideas synthesis seam (streaming-synthesis Task 6, ideas-first).
   * Injected in tests; otherwise the ideas generator's env-gated
   * strong-tier default applies (no card unless `AI_ANSWER_STRONG_MODEL`
   * plus the Google credential is set). Generation never throws for model
   * behavior — an unavailable card keeps the direct campaign route as-is.
   */
  synthesizeIdeas?: AnswerSynthesizer | null;
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
  /** Kept auto-run receipt (Task B3); null when the turn never qualified. */
  research: ResearchAutoOutcome | null;
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
    question?: string;
  }) => Promise<{ versionId: string; digest: string; branchId?: string } | null>;
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
  /**
   * Server-minted attestation (Task B3 auto path). Never accepted from
   * clients — the dispatch body schema stays strict — and always verified
   * against server-recomputed truth for the thread's latest message.
   */
  attestation?: ResearchAutoAttestation;
};

/**
 * Server-minted research attestation (Task B3 zero-click auto-run, ADR 0074
 * L2).
 *
 * The server attests its own confirmation at send time under the turn's
 * fingerprint idempotency key — a client-claimed confirmation is never
 * trusted for the auto path. The fingerprint binds thread + latest message
 * + body, so an attestation minted for one turn cannot authorize another.
 */
export type ResearchAutoAttestation = {
  scope: "research_once";
  fingerprint: string;
};

/**
 * Mints the server attestation for one turn. Pure: the same thread +
 * message + body always yields the same fingerprint, so retries replay
 * instead of double-running.
 */
export function mintResearchAutoAttestation(input: {
  threadId: string;
  messageId: string;
  body: string;
}): ResearchAutoAttestation {
  return {
    scope: "research_once",
    fingerprint: buildThreadIdempotencyKey(
      input.threadId,
      messageDigestFor({
        threadId: input.threadId,
        messageId: input.messageId,
        body: input.body,
      }),
    ),
  };
}

/**
 * One auto-run receipt for an escalated turn. `dispatched` (enqueued now),
 * `replayed` (same turn, kept run), or `blocked` (closed gate — the route
 * still answers, and `reasonCode` names the gate honestly). Identifier-only,
 * safe to return on the route response.
 */
export type ResearchAutoOutcome = {
  status: "dispatched" | "replayed" | "blocked";
  runId: string | null;
  idempotencyKey: string;
  reasonCode: "PROFILE_UNBOUND" | null;
};

const profilePointerSchema = z
  .object({
    status: z.literal("current"),
    versionId: z.string().trim().min(1).max(200),
    digest: z.string().trim().min(1).max(256),
    branchId: z.string().uuid().optional(),
  })
  .passthrough();

/**
 * Research seams for the send-time auto path (Task B3). The route and
 * answers handlers build these from Trigger transport plus the
 * authenticated context readers — the same pieces the dispatch route wires
 * inline for the manual path. A throwing reader resolves to an unbound
 * pointer (the pack's settle-to-gap philosophy): a broken lane becomes an
 * honest block, never a crashed route.
 */
export function createResearchAutoSeams(input: {
  triggerResearchRun: (payload: {
    organizationId: string;
    actorId: string;
    threadId: string;
    messageDigest: string;
    branchId?: string;
    profileVersionId: string;
    profileDigest: string;
    correlationId: string;
    idempotencyKey: string;
  }) => Promise<{ runId: string }>;
  readers: { getMarketProfile?: (input: { organizationId: string }) => Promise<unknown> };
  resolveProfile?: (input: { organizationId: string; question?: string }) => Promise<unknown>;
}): Pick<AgentDispatchSeams, "triggerResearchOnce" | "resolveProfilePointer"> {
  return {
    triggerResearchOnce: async (payload) =>
      input.triggerResearchRun({
        organizationId: payload.organizationId,
        actorId: payload.actorId as string,
        threadId: payload.threadId as string,
        messageDigest: payload.messageDigest as string,
        ...(typeof payload.branchId === "string" ? { branchId: payload.branchId } : {}),
        profileVersionId: payload.profileVersionId as string,
        profileDigest: payload.profileDigest as string,
        correlationId: payload.correlationId,
        idempotencyKey: payload.idempotencyKey,
      }),
    resolveProfilePointer: async ({ organizationId, question }) => {
      let pointer: unknown = null;
      try {
        pointer = input.resolveProfile
          ? await input.resolveProfile({ organizationId, question })
          : await input.readers.getMarketProfile?.({ organizationId });
      } catch {
        pointer = null;
      }
      const parsed = profilePointerSchema.safeParse(pointer);
      return parsed.success
        ? { versionId: parsed.data.versionId, digest: parsed.data.digest,
            ...(parsed.data.branchId ? { branchId: parsed.data.branchId } : {}) }
        : null;
    },
  };
}

/**
 * Inline assumption for medium auto turns beyond the escalate path (B2
 * minor 4). Verbatim copy of the router's `MEDIUM_ESCALATION_ASSUMPTION`
 * (router-service.ts owns the original; this module must not drift from
 * it — the proposal carries no free text, so both are deterministic
 * platform copy).
 */
const AUTO_MEDIUM_ASSUMPTION =
  "medium-confidence research read; acting as one bounded DeepThink task";

/**
 * Auto-run predicate (Task B3): B2 escalated turns plus already-DeepThink
 * holder direct research turns (the removed Run button would strand those
 * otherwise). Viewers and grant-less callers never qualify; questionnaire
 * turns wait for answers first (never blind); low confidence never acts.
 */
function shouldAutoResearch(input: {
  intent: AgentIntent;
  confidence: "high" | "medium" | "low";
  questionnaireNull: boolean;
  role: OrganizationRole;
}): boolean {
  if (input.role === "viewer") return false;
  if (!hasOrganizationPermission(input.role, "growth_intelligence.manage")) return false;
  if (input.intent !== "research_once") return false;
  if (input.confidence === "low") return false;
  if (!input.questionnaireNull) return false;
  return true;
}

async function attemptResearchAutoRun(args: {
  run: (input: ThreadDispatchInput) => Promise<ThreadDispatchOutcome>;
  organizationId: string;
  actorId: string;
  role: OrganizationRole;
  threadId: string;
  messageId: string;
  fingerprint: string;
  correlationId?: string;
}): Promise<ResearchAutoOutcome> {
  try {
    const outcome = await args.run({
      organizationId: args.organizationId,
      actorId: args.actorId,
      role: args.role,
      threadId: args.threadId,
      action: "research_once",
      idempotencyKey: args.fingerprint,
      confirmation: { confirmed: false },
      attestation: { scope: "research_once", fingerprint: args.fingerprint },
    });
    return {
      status: outcome.replayed ? "replayed" : "dispatched",
      runId: outcome.runId,
      idempotencyKey: outcome.idempotencyKey,
      reasonCode: null,
    };
  } catch (error) {
    // Expected gates degrade: the route still answers. Transport and
    // unexpected failures propagate like manual dispatch — loud, never
    // mistaken for a queued run. The unbound-pointer message is matched
    // verbatim from the research lane below; any other expected gate (an
    // unwired lane, a concurrent send moving the latest message under the
    // minted attestation) degrades without a user-facing code.
    if (!(error instanceof DomainError)) throw error;
    const reasonCode = /No current Market Profile version is bound/.test(error.message)
      ? ("PROFILE_UNBOUND" as const)
      : null;
    logger.warn("agent_thread.research_auto_blocked", {
      organizationId: args.organizationId,
      threadId: args.threadId,
      messageId: args.messageId,
      ...(args.correlationId ? { correlationId: args.correlationId } : {}),
      ...(reasonCode ? { reasonCodes: [reasonCode] } : {}),
      errorCode: error.code,
    });
    return { status: "blocked", runId: null, idempotencyKey: args.fingerprint, reasonCode };
  }
}

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
  if (hasOrganizationPermission(role, "channel.read")) {
    permissions.push("channel.read");
  }
  if (hasOrganizationPermission(role, "report.upload")) {
    permissions.push("report.upload");
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

const CHANNEL_NOT_AVAILABLE_COPY: Record<string, string> = {
  channel_not_found: "The named channel was not found in this organization.",
  no_governed_report:
    "No usable governed report covers this channel and period, so there is nothing to assess yet.",
  analysis_permission_required:
    "Starting analysis needs an operator role; this answer uses readable results only.",
  analysis_not_started:
    "No current analysis exists yet; an operator can start one from the channel audit page.",
  rate_limited: "Analysis starts are rate-limited right now; try again shortly.",
  dispatch_failed: "The analysis could not be started; try again shortly.",
  feature_disabled: "Channel analysis is not enabled for this organization.",
  invalid_period: "The requested period is not a valid analysis window.",
  read_permission_required: "Reading channel results needs channel access.",
};

/**
 * Merges a channel-assessment outcome into the advice context the answer
 * writer synthesizes. Pure: deterministic copy only, no reads, no writes.
 * Ready findings become citable entries with the exact audit href (which
 * the writer turns into a link marker); every other outcome becomes an
 * honest limitation so gaps are voiced, never zero-filled.
 */
export function mergeChannelAssessmentIntoAdvice(
  advice: AgentAdviceContext | undefined,
  outcome: ChannelAssessmentOutcome,
): { advice: AgentAdviceContext; reasonCode: string } {
  const base: AgentAdviceContext = advice ?? { entries: [], limitations: [], periodSwitch: null };
  if (outcome.status === "ready") {
    return {
      advice: {
        entries: [
          {
            sourceId: outcome.runId,
            kind: "insight" as const,
            title: `Channel audit: ${outcome.channelName}`,
            detail: outcome.summary,
            href: outcome.auditHref,
            sourceWindowStart: outcome.period.start,
            sourceWindowEnd: outcome.period.end,
            channelIds: [outcome.channelId],
            branchIds: [],
            evidenceRefs: [...outcome.evidenceRefs],
          },
          ...base.entries,
        ].slice(0, 40),
        limitations: [...base.limitations],
        periodSwitch: outcome.periodSwitch ?? base.periodSwitch,
      },
      reasonCode: "CHANNEL_ANALYSIS_REUSED",
    };
  }
  if (outcome.status === "in_progress") {
    const stageCopy =
      outcome.stage === "running"
        ? "The governed analysis is still running."
        : outcome.stage === "narrating"
          ? "Detection finished and recommendations are being written."
          : "The governed analysis has started.";
    return {
      advice: {
        entries: [
          ...(outcome.runId && outcome.auditHref
            ? [
                {
                  sourceId: outcome.runId,
                  kind: "insight" as const,
                  title: `Channel analysis ${outcome.stage}: ${outcome.channelName}`,
                  detail: `${stageCopy} Track the exact run rather than re-asking: findings will be citable once it completes.`,
                  href: outcome.auditHref,
                  sourceWindowStart: outcome.period.start,
                  sourceWindowEnd: outcome.period.end,
                  channelIds: [outcome.channelId],
                  branchIds: [],
                  evidenceRefs: [] as string[],
                },
              ]
            : []),
          ...base.entries,
        ].slice(0, 40),
        limitations: [
          ...base.limitations,
          `${stageCopy} Ask again after it completes, or follow the exact audit link.`,
        ].slice(0, 30),
        periodSwitch: outcome.periodSwitch ?? base.periodSwitch,
      },
      reasonCode: "CHANNEL_ANALYSIS_IN_PROGRESS",
    };
  }
  if (outcome.status === "needs_scope") {
    return {
      advice: {
        entries: [...base.entries],
        limitations: [
          ...base.limitations,
          outcome.field === "channel"
            ? "The channel name matched nothing uniquely; say which channel to assess."
            : "The requested period is incomplete; say which report period to use.",
        ].slice(0, 30),
        periodSwitch: base.periodSwitch,
      },
      reasonCode: "CHANNEL_SCOPE_NEEDED",
    };
  }
  return {
    advice: {
      entries: [...base.entries],
      limitations: [
        ...base.limitations,
        CHANNEL_NOT_AVAILABLE_COPY[outcome.reason] ?? "Channel analysis is unavailable.",
      ].slice(0, 30),
      periodSwitch: base.periodSwitch,
    },
    reasonCode: "CHANNEL_ASSESSMENT_BLOCKED",
  };
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
    advice?: AgentAdviceContext;
    routingNote: string;
  },
): Promise<RouteAnswer> {
  const draft = await writeAnswer(
    {
      pack: args.pack,
      routingNote: args.routingNote,
      threadId: args.thread.id,
      mode: args.thread.mode,
      ...(args.message.body ? { question: args.message.body } : {}),
      ...(args.advice ? { advice: args.advice } : {}),
    },
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

/**
 * Answers-body prefix (mirrors `encodeQuestionnaireAnswerBody`): answers
 * rows are turn metadata, not new turns, so turn scope skips them.
 */
const ANSWERS_BODY_PREFIX = "[answers ";

/**
 * The turn's kept assistant row (G3 honest skip): the latest `assistant`
 * message after the latest non-answers `user` message. Answers rows are
 * skipped because they belong to the turn they answer — "the turn's row"
 * in tests means the assistant row(s) after the latest user ask, and
 * exactly one must exist after an answers submit (reused, or synthesized
 * once when the turn has none yet). Null when the turn has no row yet, or
 * when there is no ask at all.
 */
export function findTurnAssistantRow(
  messages: readonly ThreadMessageView[],
): ThreadMessageView | null {
  let askIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (
      candidate &&
      candidate.role === "user" &&
      !(candidate.body ?? "").startsWith(ANSWERS_BODY_PREFIX)
    ) {
      askIndex = index;
      break;
    }
  }
  if (askIndex === -1) return null;
  for (let index = messages.length - 1; index > askIndex; index -= 1) {
    const candidate = messages[index];
    if (candidate && candidate.role === "assistant") return candidate;
  }
  return null;
}

/**
 * Returns the kept turn row as the turn message without synthesizing a
 * second assistant row (G3 skip: no new RPC, no update path, no delete —
 * the existing row is simply returned). The draft parses back out of the
 * durable body, which round-trips the writer's encoding; an unreadable
 * row degrades to the honest general fallback rather than failing the
 * route.
 */
function reuseTurnAnswer(message: ThreadMessageView): RouteAnswer {
  const parsed = parseAnswerBody(message.body ?? "");
  const draft = answerDraftSchema.safeParse({
    body: parsed.body,
    citations: parsed.citations,
    limitations: parsed.limitations,
    estimates: parsed.estimates,
  });
  if (draft.success) return { message, draft: draft.data, replayed: true };
  return {
    message,
    draft: buildFallbackAnswer(
      null,
      "The kept turn answer was not re-readable; this stays general.",
    ),
    replayed: true,
  };
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

/**
 * Ideas-first questionnaire for a routed turn (streaming-synthesis Task 6).
 * A direct `campaign_advice` route (no missing-fields card) carries the
 * 3-option ideas card generated on the strong tier over the pack; every
 * other turn keeps the router's questionnaire untouched. Returns null
 * (keeping the direct route) when no pack is bound or the card is
 * unavailable — advice stays free, execution stays fenced at the pick.
 *
 * Fix round: when the latest message IS the just-answered ideas card, the
 * pick's draft receipt (not a fresh card) is the UI — regeneration is
 * skipped so one pick costs one strong-tier call, not two.
 */
async function questionnaireForRoute(
  args: {
    deps: ThreadServiceDeps;
    intent: AgentIntent;
    questionnaire: QuestionnaireSpec | null;
    pack: ContextPack | null;
    routingNote: string;
    page: string;
    contextDigest: string;
    latestBody: string;
  },
): Promise<QuestionnaireSpec | null> {
  if (args.intent === "watch" && args.questionnaire === null && !args.latestBody.startsWith("[answers ")) {
    return questionnaireSpecSchema.parse({
      kind: "missing_fields", title: "Keep monitoring",
      resumeKey: `router:watch:${args.page.replace(/[^a-z0-9]/gi, "x").toLowerCase().slice(0, 60)}:${args.contextDigest.slice(0, 16)}`,
      items: [{ key: "confirm_watch", label: "Create this recurring watch?", kind: "confirm", required: true,
        helpText: "Uses weekly checks by default. Approval and research gates still apply." }],
    });
  }
  if (args.intent !== "campaign_advice" || args.questionnaire !== null || !args.pack) {
    return args.questionnaire;
  }
  if (args.latestBody.startsWith("[answers campaign_ideas]")) {
    return args.questionnaire;
  }
  const ideas = await generateCampaignIdeas(
    {
      pack: args.pack,
      routingNote: args.routingNote,
      page: args.page,
      contextDigest: args.contextDigest,
    },
    {
      ...(args.deps.synthesizeIdeas !== undefined
        ? { synthesize: args.deps.synthesizeIdeas }
        : {}),
      ...(args.deps.correlationId ? { correlationId: args.deps.correlationId } : {}),
    },
  );
  return ideas ?? args.questionnaire;
}

async function readQuestionnaireHistory(threads: ThreadRepository, input: {
  organizationId: string; threadId: string;
}): Promise<ThreadMessageView[]> {
  const messages: ThreadMessageView[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const batch = await threads.listMessages({ organizationId: input.organizationId,
      threadId: input.threadId, limit: 50, ...(cursor ? { cursor } : {}) });
    messages.push(...batch.messages);
    if (!batch.nextCursor) return messages;
    cursor = batch.nextCursor;
  }
  throw new DomainError("VALIDATION_ERROR", "This conversation is too long for an action card. Start a new chat.");
}

export function createThreadService(deps: ThreadServiceDeps) {
  return {
    async saveQuestionnaire(input: {
      organizationId: string; actorId: string; threadId: string;
      sourceMessage: ThreadMessageView; intent: AgentIntent; spec: QuestionnaireSpec;
      continuationAnswers?: QuestionnairePayload["continuationAnswers"];
    }): Promise<void> {
      if (!deps.questionnaireAuthority) {
        throw new DomainError("INTEGRATION_ERROR", "This action card is temporarily unavailable.");
      }
      const state = deps.questionnaireAuthority.sign({
        organizationId: input.organizationId, threadId: input.threadId,
        sourceMessageId: input.sourceMessage.id, intent: input.intent,
        issuedAt: input.sourceMessage.createdAt, spec: input.spec,
        ...(input.continuationAnswers ? { continuationAnswers: input.continuationAnswers } : {}),
      });
      const digest = messageDigestFor({ threadId: input.threadId, messageId: input.sourceMessage.id,
        body: JSON.stringify({ spec: input.spec, ...(input.continuationAnswers ? { continuationAnswers: input.continuationAnswers } : {}) }) });
      // Read the kept note before generating a new timestamp on replay.
      const history = await readQuestionnaireHistory(deps.threads, input);
      if (history.some((entry) => {
        const prior = entry.role === "system_note" ? parseQuestionnaireState(entry.body) : null;
        return prior && !prior.answerReceipt && prior.sourceMessageId === state.sourceMessageId &&
          JSON.stringify(prior.spec) === JSON.stringify(state.spec) &&
          JSON.stringify(prior.continuationAnswers) === JSON.stringify(state.continuationAnswers) &&
          deps.questionnaireAuthority?.verify(prior, input.organizationId, input.threadId);
      })) return;
      await deps.threads.appendMessageKeyed({
        organizationId: input.organizationId, actorId: input.actorId, threadId: input.threadId,
        role: "system_note", body: encodeQuestionnaireState(state),
        idempotencyKey: buildThreadIdempotencyKey(input.threadId, `${digest}:questionnaire`),
      });
    },
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
      if (input.role === "viewer" && input.mode === "deepthink") {
        throw new DomainError("AUTHORIZATION_ERROR", "DeepThink actions require an operator role.");
      }
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

    /**
     * Single-thread read for the drawer checkpoint poll (Slice C M9).
     * Returns the one row whose worker-written links and terminal status
     * the poll watches — never the collection. Foreign threads read as
     * not-found, never as a denial. Any member may read; classification
     * and answers stay behind their own gates.
     */
    async getThread(input: {
      organizationId: string;
      threadId: string;
    }): Promise<{ thread: ThreadSummary }> {
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
      return { thread };
    },

    async appendUserMessage(input: {
      organizationId: string;
      actorId: string;
      role: OrganizationRole;
      threadId: string;
      idempotencyKey: string;
      body: string;
    }): Promise<{ message: ThreadMessageView; replayed: boolean }> {
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
     *
     * Task B2: applies the server-owned Quick → DeepThink mode flip
     * in-memory when the router signals `DEEPTHINK_AUTO_ESCALATED` for a
     * grant-holding caller; the returned thread carries the escalated mode.
     *
     * Task B3: qualifying turns (escalated plus already-DeepThink holder
     * direct research turns) auto-enqueue one bounded run under the turn's
     * fingerprint key with a server-minted attestation; the returned
     * `research` receipt is null for every other turn.
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
      /**
        * Kept turn row for the answers re-route (G3 honest skip). When
        * present, the turn already holds a fresh assistant row from the
        * initial route synthesis, so the re-route returns it as the turn
        * message instead of synthesizing a second one. Absent → synthesize
        * exactly once as today. Direct routes never pass this.
        */
      reuseAnswer?: ThreadMessageView | null;
      /** Internal continuation from an exact verified server card; never a route body field. */
      questionnaireIntent?: AgentIntent;
    }): Promise<{
      intent: AgentIntent;
      confidence: "high" | "medium" | "low";
      reasonCodes: string[];
      questionnaire: QuestionnaireSpec | null;
      routingNote: string;
      thread: ThreadSummary;
      answer: RouteAnswer | null;
      research: ResearchAutoOutcome | null;
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
        let scope: AgentContextScope = { kind: "organization" };
        if (deps.resolveContextScope) {
          try {
            scope = await deps.resolveContextScope({
              organizationId: input.organizationId,
              question: message.body,
            });
          } catch {
            scope = { kind: "unavailable" };
          }
        }
        const scopedReaders = bindAgentContextScope(scope, deps.contextReaders);
        const resolved = await resolvePackContextDigest({
          organizationId: input.organizationId,
          userId: input.actorId,
          windowDays: 30,
          page,
          ...scopedReaders,
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
      const proposal = input.questionnaireIntent
        ? { intent: input.questionnaireIntent, confidence: "high" as const, missing: [] }
        : await resolveProposal(deps, { text: message.body, page, contextDigest });
      let advice: AgentAdviceContext | undefined;
      if (deps.loadAdviceContext) {
        try {
          advice = await deps.loadAdviceContext({
            organizationId: input.organizationId,
            actorId: input.actorId,
            role: input.role,
            question: message.body,
            page,
          });
        } catch (error) {
          logger.warn("agent_thread.advice_read_degraded", {
            organizationId: input.organizationId,
            threadId: thread.id,
            ...(deps.correlationId ? { correlationId: deps.correlationId } : {}),
            errorCode: error instanceof Error ? error.name : "unknown",
          });
        }
      }
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
      // Channel assessment (governed §21.2): a direct `channel_assessment`
      // route resolves the named channel against organization-owned
      // identity and folds source-owned findings into the advice the
      // writer synthesizes, with the exact audit href carried through to
      // a link marker. Missing analysis dispatches through the existing
      // permission-checked, rate-limited service when this is a fresh
      // ask — re-routes replay the kept answer instead of spending a
      // second allowance. A failed read degrades to limitations; the
      // route never fails for assessment behavior.
      let channelReasonCode: string | null = null;
      if (
        output.intent === "channel_assessment" &&
        output.questionnaire === null &&
        deps.assessChannel &&
        !input.reuseAnswer
      ) {
        try {
          const outcome = await deps.assessChannel({
            organizationId: input.organizationId,
            actorId: input.actorId,
            role: input.role,
            question: message.body,
            correlationId: deps.correlationId ?? "agent-thread",
          });
          const merged = mergeChannelAssessmentIntoAdvice(advice, outcome);
          advice = merged.advice;
          channelReasonCode = merged.reasonCode;
        } catch (error) {
          logger.warn("agent_thread.channel_assessment_degraded", {
            organizationId: input.organizationId,
            threadId: thread.id,
            ...(deps.correlationId ? { correlationId: deps.correlationId } : {}),
            errorCode: error instanceof Error ? error.name : "unknown",
          });
        }
      }
      // Zero-click auto-escalation (Task B2, ADR 0074): the router signals
      // a holder escalation with DEEPTHINK_AUTO_ESCALATED, and the service
      // applies the server-owned mode flip to the returned thread when the
      // persisted row is still Quick. In-memory only: RLS carries no
      // thread-mode write policy and no mode RPC exists, so the persisted
      // row stays Quick and the drawer merge holds the marker for the
      // session. The grant is re-checked from the role here, never trusted
      // from router output alone — viewers and grant-less callers keep the
      // router's answer_memory downgrade with its honest codes and never
      // flip.
      const escalated =
        hasOrganizationPermission(input.role, "growth_intelligence.manage") &&
        output.intent === "research_once" &&
        output.reasonCodes.includes("DEEPTHINK_AUTO_ESCALATED") &&
        thread.mode === "quick";
      const routedThread: ThreadSummary = escalated ? { ...thread, mode: "deepthink" } : thread;
      // Zero-click auto-run (Task B3, ADR 0074 L2): qualifying turns
      // enqueue one bounded run under the turn's fingerprint key before the
      // routed event publishes, so the event, the response, and the drawer
      // steps all carry the same honest codes. Retries replay the kept run
      // through the fingerprint Trigger key — never a second run.
      const autoTurn = shouldAutoResearch({
        intent: output.intent,
        confidence: output.confidence,
        questionnaireNull: output.questionnaire === null,
        role: input.role,
      });
      let routingNote = output.routingNote;
      const reasonCodes = [...output.reasonCodes];
      if (channelReasonCode) reasonCodes.push(channelReasonCode);
      let research: ResearchAutoOutcome | null = null;
      if (autoTurn) {
        // Medium auto turns beyond the escalate path state the same inline
        // assumption the router states on escalate-medium (B2 minor 4).
        if (!escalated && output.confidence === "medium") {
          routingNote = `${routingNote}\nassumption=${AUTO_MEDIUM_ASSUMPTION}`;
        }
        const fingerprint = mintResearchAutoAttestation({
          threadId: thread.id,
          messageId: message.id,
          body: message.body ?? "",
        }).fingerprint;
        research = await attemptResearchAutoRun({
          run: (dispatchInput) => this.dispatch(dispatchInput),
          organizationId: input.organizationId,
          actorId: input.actorId,
          role: input.role,
          threadId: thread.id,
          messageId: message.id,
          fingerprint,
          ...(deps.correlationId ? { correlationId: deps.correlationId } : {}),
        });
        if (research.status === "blocked" && research.reasonCode) {
          reasonCodes.push(research.reasonCode);
        }
      }
      await publishAgentEvent(deps, {
        organizationId: input.organizationId,
        actorId: input.actorId,
        eventName: "agent_thread.routed",
        payload: {
          threadId: thread.id,
          messageId: message.id,
          intent: output.intent,
          confidence: output.confidence,
          reasonCodes,
          questionnaireKind: output.questionnaire?.kind ?? null,
          ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        },
      });
      const routed = {
        intent: output.intent,
        confidence: output.confidence,
        reasonCodes,
        // Ideas-first campaigns (streaming-synthesis Task 6): a direct
        // campaign_advice route carries the 3-option ideas card generated
        // on the strong tier over the pack. Missing-fields cards keep
        // priority (evidence first, ideas arrive after the answers
        // re-route). Generation never throws for model behavior — null
        // keeps the direct route without a card.
        questionnaire: await questionnaireForRoute({
          deps,
          intent: output.intent,
          questionnaire: output.questionnaire,
          pack,
          routingNote,
          page,
          contextDigest,
          latestBody: message.body ?? "",
        }),
        routingNote,
        thread: routedThread,
        research,
        // G3 honest skip: the answers re-route carries the turn's kept row
        // and returns it — no second synthesis, no second assistant row.
        answer: input.reuseAnswer
          ? reuseTurnAnswer(input.reuseAnswer)
          : await synthesizeAssistantAnswer(deps, {
              organizationId: input.organizationId,
              actorId: input.actorId,
              role: input.role,
              thread: routedThread,
              message,
              pack,
              ...(advice ? { advice } : {}),
              routingNote,
            }),
      };
      if (routed.questionnaire && input.role !== "viewer") {
        routed.questionnaire = bindQuestionnaireToMessage(routed.questionnaire, message.id);
        await this.saveQuestionnaire({ organizationId: input.organizationId, actorId: input.actorId,
          threadId: thread.id, sourceMessage: message, intent: routed.intent, spec: routed.questionnaire });
      }
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
      /** Internal continuation input from the verified card's source position. */
      sourceQuestion: string | null;
      /** Server-signed prior watch inputs; never part of the public submitted answers. */
      continuationAnswers: QuestionnairePayload["continuationAnswers"];
      intent: AgentIntent;
      confidence: "high" | "medium" | "low";
      reasonCodes: string[];
      questionnaire: QuestionnaireSpec | null;
      answer: RouteAnswer | null;
      research: ResearchAutoOutcome | null;
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
      const history = await readQuestionnaireHistory(deps.threads, input);
      const submittedSpec = questionnaireSpecSchema.parse(input.spec);
      // Text prefixes cannot prove that a user row came from this endpoint.
      // Only an exact server-signed receipt identifies generated answers.
      const verifiedAnswerIds = new Set<string>();
      for (let index = 0; index < history.length; index += 1) {
        const entry = history[index]!;
        const receipt = entry.role === "system_note" ? parseQuestionnaireState(entry.body) : null;
        if (!receipt?.answerReceipt || !deps.questionnaireAuthority?.verify(receipt, input.organizationId, input.threadId)) continue;
        const receiptSourceIndex = history.findIndex((row) => row.id === receipt.sourceMessageId && row.role === "user");
        const answerIndex = history.findIndex((row) => row.id === receipt.answerReceipt!.messageId && row.role === "user");
        const answer = history[answerIndex];
        if (receiptSourceIndex >= 0 && answerIndex > receiptSourceIndex && answerIndex < index && answer?.body &&
            receipt.answerReceipt.bodyDigest === messageDigestFor({ threadId: input.threadId, messageId: answer.id, body: answer.body })) {
          verifiedAnswerIds.add(answer.id);
        }
      }
      let saved: QuestionnaireState | null = null;
      let savedIndex = -1;
      for (let index = history.length - 1; index >= 0; index -= 1) {
        const entry = history[index]!;
        const candidate = entry.role === "system_note" ? parseQuestionnaireState(entry.body) : null;
        if (candidate && !candidate.answerReceipt && candidate.spec.resumeKey === submittedSpec.resumeKey &&
            deps.questionnaireAuthority?.verify(candidate, input.organizationId, input.threadId)) {
          saved = candidate; savedIndex = index; break;
        }
      }
      const sourceIndex = saved ? history.findIndex((entry) => entry.id === saved.sourceMessageId && entry.role === "user") : -1;
      if (!saved || sourceIndex < 0 || sourceIndex >= savedIndex ||
          JSON.stringify(saved.spec) !== JSON.stringify(submittedSpec) ||
          history.slice(savedIndex + 1).some((entry) => {
            if (entry.role === "user" && !verifiedAnswerIds.has(entry.id)) return true;
            const newer = entry.role === "system_note" ? parseQuestionnaireState(entry.body) : null;
            return newer && !newer.answerReceipt && deps.questionnaireAuthority?.verify(newer, input.organizationId, input.threadId) &&
              JSON.stringify(newer.spec) !== JSON.stringify(saved.spec);
          })) {
        throw new DomainError("VALIDATION_ERROR", "This action card is no longer current. Send the request again.");
      }
      const normalized = validateQuestionnaireAnswers(saved.spec, input.answers);
      const continuationAnswers = saved.continuationAnswers;
      const sourceQuestion = [...history.slice(0, sourceIndex + 1)].reverse().find((entry) =>
        entry.role === "user" && !!entry.body?.trim() && !verifiedAnswerIds.has(entry.id))?.body?.trim() ?? null;
      if (saved.intent === "watch" && normalized.confirm_watch !== undefined && normalized.confirm_watch !== "yes") {
        throw new DomainError("VALIDATION_ERROR", "Confirm this watch before creating it.");
      }
      const fixedTap = saved.intent === "watch" || (saved.intent === "campaign_advice" && saved.spec.kind === "campaign_ideas");
      if (fixedTap && !hasOrganizationPermission(input.role, saved.intent === "watch" ? "growth_intelligence.manage" : "campaign.create")) {
        throw new DomainError("AUTHORIZATION_ERROR", "You no longer have permission to create this action.");
      }
      // G3 honest skip: read the turn before appending, so the re-route
      // below reuses the turn's existing assistant row (when the initial
      // route already synthesized one) instead of appending a second.
      // The read never fails the submit: an unavailable history (a throwing
      // reader, or a caller mock that predates this read) degrades to "no
      // reusable row", and the re-route synthesizes once as before.
      let keptTurnRow: ThreadMessageView | null = null;
      try {
        keptTurnRow = findTurnAssistantRow(history);
      } catch (error) {
        logger.warn("agent_thread.turn_read_degraded", {
          organizationId: input.organizationId,
          threadId: input.threadId,
          ...(deps.correlationId ? { correlationId: deps.correlationId } : {}),
          errorCode: error instanceof Error ? error.name : "unknown",
        });
        keptTurnRow = null;
      }
      const appended = await deps.threads.appendMessageKeyed({
        organizationId: input.organizationId,
        actorId: input.actorId,
        threadId: input.threadId,
        role: "user",
        body: encodeQuestionnaireAnswerBody(input.spec, normalized),
        // One consumed answer per exact server card, independent of a
        // client's retry token. A changed answer conflicts rather than
        // authorizing a second creation from the same card.
        idempotencyKey: buildThreadIdempotencyKey(thread.id, `${messageDigestFor({
          threadId: thread.id, messageId: saved.sourceMessageId, body: JSON.stringify(saved.spec),
        })}:questionnaire-answer`),
      });
      const message = await deps.threads.getMessage({
        organizationId: input.organizationId,
        messageId: appended.messageId,
      });
      if (!message) {
        throw new DomainError("DOMAIN_ERROR", "This message could not be saved.");
      }
      if (!deps.questionnaireAuthority || !message.body) {
        throw new DomainError("INTEGRATION_ERROR", "This action card is temporarily unavailable.");
      }
      const answerDigest = messageDigestFor({ threadId: thread.id, messageId: message.id, body: message.body });
      const receipt = deps.questionnaireAuthority.sign({ organizationId: saved.organizationId, threadId: saved.threadId,
        sourceMessageId: saved.sourceMessageId, intent: saved.intent, spec: saved.spec,
        ...(saved.continuationAnswers ? { continuationAnswers: saved.continuationAnswers } : {}), issuedAt: message.createdAt,
        answerReceipt: { messageId: message.id, bodyDigest: answerDigest } });
      await deps.threads.appendMessageKeyed({ organizationId: input.organizationId, actorId: input.actorId,
        threadId: thread.id, role: "system_note", body: encodeQuestionnaireState(receipt),
        idempotencyKey: buildThreadIdempotencyKey(thread.id, `${answerDigest}:questionnaire-answer-receipt`) });
      if (!appended.replayed) {
        await publishAgentEvent(deps, {
          organizationId: input.organizationId,
          actorId: input.actorId,
          eventName: "agent_message.appended",
          payload: { threadId: thread.id, messageId: message.id },
        });
      }
      if (fixedTap) {
        // A submitted server card already fixes the action. Encoded form
        // values are data, never a new classification or research request.
        const routed = routeAgentMessage({ text: message.body!, page: input.page ?? "overview",
          role: input.role, permissions: permissionsForRole(input.role),
          contextDigest: routingContextDigest({ organizationId: input.organizationId, threadId: thread.id, messageId: message.id }),
          activeWatches: [], threadMode: thread.mode,
          model: { kind: "stub", intent: saved.intent, confidence: "high", missing: [] } });
        return { message, replayed: appended.replayed, answers: normalized,
          intent: routed.intent, confidence: routed.confidence, reasonCodes: routed.reasonCodes,
          questionnaire: null, answer: keptTurnRow ? reuseTurnAnswer(keptTurnRow) : null, research: null, sourceQuestion, continuationAnswers };
      }
      if (input.spec.kind === "duplicate_watch" && normalized.choice === "cancel") {
        // Terminal cancel: the persisted answers row above is the whole
        // effect, so the turn ends here with a classify-only routing —
        // real router values over the answers text, zero enrichment reads
        // (pack, advice, assessment), no second synthesis, no dispatch.
        // Anything else (view/update/fresh, missing fields, ideas) still
        // takes the full re-route below.
        const cancelPage = (input.page ?? "overview").trim();
        if (cancelPage.length < 1 || cancelPage.length > 120) {
          throw new DomainError("VALIDATION_ERROR", "Please check the submitted fields.");
        }
        if (!message.body) {
          throw new DomainError("DOMAIN_ERROR", "This chat has no readable message to route.");
        }
        const cancelDigest = routingContextDigest({
          organizationId: input.organizationId,
          threadId: thread.id,
          messageId: message.id,
        });
        const cancelProposal = await resolveProposal(deps, {
          text: message.body,
          page: cancelPage,
          contextDigest: cancelDigest,
        });
        const cancelled = routeAgentMessage({
          text: message.body,
          page: cancelPage,
          role: input.role,
          permissions: permissionsForRole(input.role),
          contextDigest: cancelDigest,
          activeWatches: [],
          threadMode: thread.mode,
          model:
            cancelProposal === null
              ? { kind: "live" }
              : {
                  kind: "stub",
                  intent: cancelProposal.intent,
                  confidence: cancelProposal.confidence,
                  missing: cancelProposal.missing,
                },
        });
        return {
          message,
          replayed: appended.replayed,
          answers: normalized,
          intent: cancelled.intent,
          confidence: cancelled.confidence,
          reasonCodes: cancelled.reasonCodes,
          questionnaire: cancelled.questionnaire,
          answer: keptTurnRow ? reuseTurnAnswer(keptTurnRow) : null,
          research: null,
          sourceQuestion,
          continuationAnswers,
        };
      }
      const routed = await this.routeLatest({
        organizationId: input.organizationId,
        actorId: input.actorId,
        role: input.role,
        threadId: input.threadId,
        ...(input.page ? { page: input.page } : {}),
        idempotencyKey: `${input.idempotencyKey}:reroute`,
        ...(keptTurnRow ? { reuseAnswer: keptTurnRow } : {}),
        ...(saved.intent === "campaign_advice" ? { questionnaireIntent: saved.intent } : {}),
      });
      return {
        message,
        replayed: appended.replayed,
        answers: normalized,
        sourceQuestion,
        continuationAnswers,
        intent: routed.intent,
        // Slice C F2/M6: the re-route's fresh codes travel with the
        // answers response, so the drawer renders this turn's codes
        // instead of carrying the previous classification forward.
        confidence: routed.confidence,
        reasonCodes: routed.reasonCodes,
        questionnaire: routed.questionnaire,
        answer: routed.answer,
        research: routed.research,
      };
    },

    /**
     * Governed dispatch (Slice B, Task B3 auto path). Enqueues the
     * research/watch Trigger tasks or admits one campaign draft through
     * `adviseCampaign`. Viewers are refused before persistence; grants are
     * rechecked from the role (never client claims); the manual path needs
     * explicit confirmation while the zero-click research path carries a
     * server-minted attestation verified against the turn's fingerprint;
     * the same token replays the kept outcome. Research/watch lanes emit
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
      // Task B3: the zero-click auto path carries a server-minted
      // attestation instead of a client click; the manual path still needs
      // the operator's explicit confirmation, validated exactly as before.
      const attestation = input.attestation ?? null;
      if (attestation === null && input.confirmation?.confirmed !== true) {
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
      // A presented attestation is verified against server-recomputed truth
      // for THIS turn — scope, action, and fingerprint must all match. A
      // forged or mis-scoped attestation is rejected even beside an
      // explicit confirmation: never trusted, nothing enqueued.
      if (attestation !== null) {
        const expected = mintResearchAutoAttestation({
          threadId: thread.id,
          messageId: message.id,
          body: message.body ?? "",
        }).fingerprint;
        if (
          attestation.scope !== "research_once" ||
          input.action !== "research_once" ||
          attestation.fingerprint !== expected
        ) {
          throw new DomainError(
            "VALIDATION_ERROR",
            "That confirmation was not issued for this turn. Nothing was enqueued.",
          );
        }
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
            question: message.body ?? "",
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
            ...(pointer.branchId ? { branchId: pointer.branchId } : {}),
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
