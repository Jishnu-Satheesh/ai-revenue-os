import { z } from "zod";

import { questionnaireSpecSchema, type QuestionnaireSpec } from "@/domain/agent-router/contracts";
import {
  BRIEF_FREQUENCIES,
  BRIEF_INVESTIGATION_AREAS,
  briefCompetitorSchema,
  briefRevisionSchema,
  type BriefRevision,
} from "@/domain/growth-intelligence/brief";
import { researchProjectScheduleSchema } from "@/domain/growth-intelligence/project";
import { DomainError } from "@/lib/errors";
import {
  buildAgentContextPack,
  type ContextPack,
  type ContextPackReaders,
  type ContextPackScope,
} from "@/modules/agent-chat/application/context-pack";
import type { ThreadRepository } from "@/modules/agent-chat/infrastructure/thread-repository";
import { fingerprintMonitoringScope } from "@/modules/growth-intelligence/application/market-monitoring-update";

/**
 * Research-once + watch executors on the TinyFish lane (spec section 10).
 *
 * Pure orchestration over injected seams — no provider code, no live web
 * calls, no `node:` imports (this module stays client-importable, like the
 * context pack). The router never executes and these executors never invent
 * scope: every outbound query is built from the bound Market Profile version
 * only (public name, domains, niche, city, country, topics), and every
 * spend passes reserve-before-call through the injected budget seam.
 *
 * Idempotency is thread-linked everywhere:
 * `agent_thread:<threadId>:<messageDigest>`. Identical re-dispatch returns
 * the kept rows (`replayed: true`); terminal rows never reopen; blocked
 * lanes fail closed with zero spend and internal-only synthesis.
 */

// ---------------------------------------------------------------------------
// Thread-linked idempotency + message digests
// ---------------------------------------------------------------------------

/** Idempotency namespace for every agent-dispatched unit of work. */
export const AGENT_THREAD_IDEMPOTENCY_PREFIX = "agent_thread";

const idempotencyTokenSchema = z.string().trim().min(1).max(200);

/**
 * Thread-linked idempotency key (spec 10.1):
 * `agent_thread:<threadId>:<messageDigest>`.
 */
export function buildThreadIdempotencyKey(threadId: string, messageDigest: string): string {
  const thread = idempotencyTokenSchema.parse(threadId);
  const digest = idempotencyTokenSchema.parse(messageDigest);
  return `${AGENT_THREAD_IDEMPOTENCY_PREFIX}:${thread}:${digest}`;
}

/**
 * Stable 16-hex digest over one thread message. Pure arithmetic (the same
 * mixing as the Task 3 placeholder and the pack digest, copied so this
 * module stays client-importable): the same thread + message + body always
 * yields the same key, so an identical re-click replays instead of
 * re-spending.
 */
export function messageDigestFor(input: {
  threadId: string;
  messageId: string;
  body: string;
}): string {
  const text = `${input.threadId}:${input.messageId}:${input.body}`;
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

// ---------------------------------------------------------------------------
// Lane gating (TinyFish only; Brave stays ephemeral-preview, Exa stays out)
// ---------------------------------------------------------------------------

export const researchLaneGateSchema = z
  .object({
    /** `TINYFISH_SEARCH_API_KEY` present and non-blank. */
    keyPresent: z.boolean(),
    /** `TINYFISH_MARKET_RESEARCH_ENABLED === "true"`. */
    enabled: z.boolean(),
    /** Staged `check_research_provider_qualification_for` tinyfish pass. */
    qualified: z.boolean(),
  })
  .strict();

export type ResearchLaneGates = z.infer<typeof researchLaneGateSchema>;

export const RESEARCH_LANE_BLOCKED_CODES = [
  "CREDENTIAL_MISSING",
  "LANE_DISABLED",
  "PROVIDER_NOT_QUALIFIED",
] as const;

export type ResearchLaneBlockedCode = (typeof RESEARCH_LANE_BLOCKED_CODES)[number];

export type ResearchLaneGateDecision =
  | { open: true }
  | { open: false; reasonCode: ResearchLaneBlockedCode; copy: string };

const GATE_BLOCKER_COPY: Record<ResearchLaneBlockedCode, string> = {
  CREDENTIAL_MISSING: "Market research credentials are not configured.",
  LANE_DISABLED: "Market research is switched off for this workspace.",
  PROVIDER_NOT_QUALIFIED: "No provider agreement is on file for market research.",
};

/**
 * Gate order is credential → kill-switch → qualification, so the first
 * missing requirement names the operator's next step. A shut gate fails
 * closed before any identifier validation or budget touch: the blocked path
 * provably spends nothing.
 */
export function resolveResearchLaneGate(gates: ResearchLaneGates): ResearchLaneGateDecision {
  const parsed = researchLaneGateSchema.parse(gates);
  if (!parsed.keyPresent) {
    return {
      open: false,
      reasonCode: "CREDENTIAL_MISSING",
      copy: GATE_BLOCKER_COPY.CREDENTIAL_MISSING,
    };
  }
  if (!parsed.enabled) {
    return { open: false, reasonCode: "LANE_DISABLED", copy: GATE_BLOCKER_COPY.LANE_DISABLED };
  }
  if (!parsed.qualified) {
    return {
      open: false,
      reasonCode: "PROVIDER_NOT_QUALIFIED",
      copy: GATE_BLOCKER_COPY.PROVIDER_NOT_QUALIFIED,
    };
  }
  return { open: true };
}

// ---------------------------------------------------------------------------
// Marker step receipts + GI hyperlink
// ---------------------------------------------------------------------------

/**
 * Drawer Marker stages for a one-time run (spec 10.1): queued → claimed →
 * searching (per-dimension honest status) → grading → synthesis →
 * done/blocked. Receipts are data only; the drawer renders them.
 */
export const RESEARCH_MARKER_STAGES = [
  "queued",
  "claimed",
  "searching",
  "grading",
  "synthesis",
  "done",
] as const;

export type ResearchMarkerStage = (typeof RESEARCH_MARKER_STAGES)[number];

export type MarkerReceipt = {
  stage: ResearchMarkerStage | "blocked";
  state: "done" | "active" | "pending" | "blocked";
  label: string;
};

const MARKER_LABELS: Record<ResearchMarkerStage | "blocked", string> = {
  queued: "Queued",
  claimed: "Claimed",
  searching: "Searching",
  grading: "Grading",
  synthesis: "Synthesis",
  done: "Done",
  blocked: "Blocked",
};

function markerReceiptsThrough(current: ResearchMarkerStage | "blocked"): MarkerReceipt[] {
  if (current === "blocked") {
    return [
      { stage: "queued", state: "done", label: MARKER_LABELS.queued },
      { stage: "blocked", state: "blocked", label: MARKER_LABELS.blocked },
    ];
  }
  const currentIndex = RESEARCH_MARKER_STAGES.indexOf(current);
  return RESEARCH_MARKER_STAGES.map((stage, index) => ({
    stage,
    state: index < currentIndex ? "done" : index === currentIndex ? "active" : "pending",
    label: MARKER_LABELS[stage],
  }));
}

export function buildMarkerReceipts(current: ResearchMarkerStage | "blocked"): MarkerReceipt[] {
  if (current !== "blocked" && !RESEARCH_MARKER_STAGES.includes(current)) {
    throw new DomainError("VALIDATION_ERROR", "Please check the submitted fields.");
  }
  return markerReceiptsThrough(current);
}

/**
 * Hyperlink target for a Marker receipt: the organization's Market
 * Intelligence page, which exists in this tree at
 * `src/app/(platform)/organizations/[organizationId]/growth-intelligence`.
 * The exact request/project/report row id travels in the receipt payload
 * beside the href — no deep-link query params are invented, because the
 * page does not define focus params today.
 */
export function giResearchLink(
  organizationId: string,
  ref?: { requestId?: string; projectId?: string; reportId?: string },
): {
  href: string;
  ref: { requestId: string | null; projectId: string | null; reportId: string | null };
} {
  const org = z.string().trim().min(1).max(200).parse(organizationId);
  return {
    href: `/organizations/${org}/growth-intelligence`,
    ref: {
      requestId: ref?.requestId ?? null,
      projectId: ref?.projectId ?? null,
      reportId: ref?.reportId ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Bounded profile-scope queries (allowlist, never tenant/customer data)
// ---------------------------------------------------------------------------

/**
 * Pointer the pack carries for the Market Profile lane: version id plus
 * digest only. The executor fetches the full document by `versionId`
 * through the injected profiles seam — it never expects the document
 * inline in the pack.
 */
export const profileScopePointerSchema = z
  .object({
    versionId: z.string().trim().min(1).max(200),
    digest: z.string().trim().min(1).max(256),
  })
  .strict();

export type ProfileScopePointer = z.infer<typeof profileScopePointerSchema>;

const profileScopeQuerySourceSchema = z
  .object({
    publicBusinessName: z.string().trim().min(1).max(160),
    approvedDomains: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
    niches: z.array(z.string().trim().min(1).max(120)).min(1).max(12),
    city: z.string().trim().min(1).max(160),
    countryCode: z.string().trim().min(1).max(8),
    topics: z.array(z.string().trim().min(1).max(160)).min(1).max(20),
    competitors: z
      .array(z.object({ name: z.string().trim().min(1).max(160) }).passthrough())
      .max(20)
      .default([]),
  })
  .strict();

/** Hard bound on executor-built candidate queries per dispatch. */
export const MAX_PROFILE_SCOPE_QUERIES = 8;

/**
 * Builds bounded research queries from the approved profile document and
 * nothing else. Only profile-scope fields are read (public name, domains,
 * niche, city, country, topics, competitor names); organization/branch ids,
 * customer data, report values, source text, and model instructions can
 * never enter because they are never selected. Queries are capped and
 * de-duplicated; an empty scope yields zero queries, never a guess.
 */
export function buildProfileScopeQueries(document: unknown): string[] {
  const parsed = profileScopeQuerySourceSchema.safeParse(document);
  if (!parsed.success) return [];
  const scope = parsed.data;
  const candidates: string[] = [];
  const push = (query: string) => {
    const clean = query.trim().replace(/\s+/g, " ").slice(0, 160);
    if (clean.length > 0 && !candidates.includes(clean)) candidates.push(clean);
  };
  for (const topic of scope.topics.slice(0, 5)) {
    push(`${scope.publicBusinessName} ${scope.city} ${topic}`);
  }
  for (const competitor of scope.competitors.slice(0, 5)) {
    push(`${competitor.name} ${scope.city} ${scope.niches[0] ?? ""}`);
  }
  if (scope.niches[0]) {
    push(`${scope.niches[0]} ${scope.city} ${scope.countryCode} market`);
  }
  return candidates.slice(0, MAX_PROFILE_SCOPE_QUERIES);
}

// ---------------------------------------------------------------------------
// Coverage honesty: every requested dimension reports exactly one status
// ---------------------------------------------------------------------------

/**
 * Coverage vocabulary mirrors
 * `MONITORING_COVERAGE_STATUSES` in
 * `src/modules/growth-intelligence/application/market-monitoring-update.ts`
 * (compared in tests so the two can never drift apart silently).
 */
export const COVERAGE_STATUSES = [
  "supported",
  "unavailable",
  "not-found",
  "not-researched",
] as const;

export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

export const coverageDimensionSchema = z
  .object({
    kind: z.enum(["investigation_area", "competitor"]),
    key: z.string().trim().min(1).max(160),
    label: z.string().trim().min(1).max(240),
  })
  .strict();

export type CoverageDimension = z.infer<typeof coverageDimensionSchema>;

export const coverageEntrySchema = coverageDimensionSchema
  .extend({ status: z.enum(COVERAGE_STATUSES) })
  .strict();

export type CoverageEntry = z.infer<typeof coverageEntrySchema>;

/**
 * Every requested dimension reports exactly one status. Unknown outcomes
 * stay `not-researched` (never upgraded to `supported`); call
 * `backfillCoverageUnavailable` on the failure path so research failure
 * settles `unavailable` with its safe reason instead of leaving gaps.
 */
export function buildCoverageReport(
  dimensions: readonly unknown[],
  outcomes?: Readonly<Record<string, CoverageStatus>>,
): CoverageEntry[] {
  return dimensions.map((dimension) => {
    const parsed = coverageDimensionSchema.parse(dimension);
    const status = outcomes?.[parsed.key];
    return {
      ...parsed,
      status:
        status && (COVERAGE_STATUSES as readonly string[]).includes(status)
          ? status
          : "not-researched",
    };
  });
}

export function backfillCoverageUnavailable(entries: readonly CoverageEntry[]): CoverageEntry[] {
  return entries.map((entry) =>
    entry.status === "not-researched" || entry.status === "not-found"
      ? { ...entry, status: "unavailable" as const }
      : entry,
  );
}

// ---------------------------------------------------------------------------
// Research once
// ---------------------------------------------------------------------------

const TERMINAL_REQUEST_STATUSES = ["succeeded", "failed", "cancelled"] as const;

export function isTerminalRequestStatus(status: string): boolean {
  return (TERMINAL_REQUEST_STATUSES as readonly string[]).includes(status);
}

export const executeResearchOnceInputSchema = z
  .object({
    organizationId: z.string().trim().min(1).max(200).optional(),
    actorId: z.string().trim().min(1).max(200).optional(),
    threadId: z.string().trim().min(1).max(200).optional(),
    messageId: z.string().trim().min(1).max(200).optional(),
    messageBody: z.string().max(20000).optional(),
    /** Precomputed digest; derived from thread/message/body when absent. */
    messageDigest: z.string().trim().min(1).max(200).optional(),
    branchId: z.string().trim().min(1).max(200).optional(),
    /** Pack pointer only — the full document is fetched by versionId. */
    profileVersion: profileScopePointerSchema.nullable().optional(),
    correlationId: z.string().trim().min(1).max(200).optional(),
    gates: researchLaneGateSchema,
  })
  .passthrough();

export type ExecuteResearchOnceInput = z.infer<typeof executeResearchOnceInputSchema>;

/**
 * Injected seams. All optional so the blocked path (gates shut) runs with
 * no seams at all — the zero-spend proof. The durable trigger wrapper
 * injects the real budget ledger, request store, profile reader, and
 * dispatcher; tests inject fakes.
 */
export type ResearchOnceSeams = {
  budget?: {
    /**
     * Admits the request's worst-case quote before the worker runs. The
     * canonical TinyFish quote and price version live with the caller
     * (the durable trigger wrapper); the executor only orders the call
     * before dispatch.
     */
    reserveRequestBudget(input: {
      organizationId: string;
      requestId: string;
    }): Promise<{ quoteMicrosUsd: number } | null>;
  };
  requests?: {
    /** Kept row for this idempotency key, if a previous dispatch survived. */
    findKept?(input: { organizationId: string; idempotencyKey: string }): Promise<{
      requestId: string;
      status: string;
    } | null>;
    getStatus(input: { organizationId: string; requestId: string }): Promise<string | null>;
    /** Creates (or replays) the market_research request bound to the profile pointer. */
    enqueue(input: {
      organizationId: string;
      branchId?: string | null;
      profileVersion: ProfileScopePointer;
      correlationId: string;
      idempotencyKey: string;
    }): Promise<{ requestId: string; replayed: boolean }>;
  };
  profiles?: {
    /** Full approved document fetched by versionId — never inline in the pack. */
    readVersion(input: {
      organizationId: string;
      versionId: string;
    }): Promise<{ versionId: string; digest: string; document: unknown; enabled: boolean } | null>;
  };
  dispatch?: (input: {
    organizationId: string;
    requestId: string;
    correlationId: string;
    idempotencyKey: string;
  }) => Promise<{ requestId: string; replayed: boolean }>;
  now?: () => Date;
};

export type ResearchOnceOutcome =
  | {
      outcome: "blocked";
      reasonCode: ResearchLaneBlockedCode;
      copy: string;
      spentMicrosUsd: 0;
      /** Internal-evidence-only synthesis, labeled with limitations. Zero external claims. */
      synthesis: { mode: "internal-only"; limitations: string[] };
      markers: MarkerReceipt[];
      link: ReturnType<typeof giResearchLink>;
    }
  | {
      outcome: "dispatched" | "replayed" | "kept";
      requestId: string;
      replayed: boolean;
      idempotencyKey: string;
      reservedMicrosUsd: number | null;
      queries: string[];
      coverage: CoverageEntry[];
      markers: MarkerReceipt[];
      link: ReturnType<typeof giResearchLink>;
    };

/**
 * Executes one bounded research task on the TinyFish lane.
 *
 * Order: validate gates first (fail closed, zero seams touched) →
 * identifiers → idempotency key → terminal/replay checks (kept rows return,
 * terminal rows never reopen) → profile bind → reserve-before-call →
 * dispatch. Unknown costs stay reserved, never zeroed.
 */
export async function executeResearchOnce(
  input: ExecuteResearchOnceInput,
  seams: ResearchOnceSeams = {},
): Promise<ResearchOnceOutcome> {
  const parsed = executeResearchOnceInputSchema.parse(input);
  const gate = resolveResearchLaneGate(parsed.gates);
  const fallbackOrg = parsed.organizationId ?? "unknown";
  if (!gate.open) {
    return {
      outcome: "blocked",
      reasonCode: gate.reasonCode,
      copy: gate.copy,
      spentMicrosUsd: 0,
      synthesis: {
        mode: "internal-only",
        limitations: [
          `Research is blocked (${gate.reasonCode}); this answer uses internal evidence only.`,
        ],
      },
      markers: buildMarkerReceipts("blocked"),
      link: giResearchLink(fallbackOrg),
    };
  }

  const organizationId = z.string().trim().min(1).max(200).parse(parsed.organizationId);
  const threadId = z.string().trim().min(1).max(200).parse(parsed.threadId);
  const digest =
    parsed.messageDigest ??
    messageDigestFor({
      threadId,
      messageId: parsed.messageId ?? threadId,
      body: parsed.messageBody ?? "",
    });
  const idempotencyKey = buildThreadIdempotencyKey(threadId, digest);
  const correlationId = parsed.correlationId ?? `${organizationId}:${threadId}:${digest}`;

  // Replay before spend: an identical re-click returns the kept row.
  if (seams.requests?.findKept) {
    const kept = await seams.requests.findKept({ organizationId, idempotencyKey });
    if (kept) {
      if (isTerminalRequestStatus(kept.status)) {
        return {
          outcome: "kept",
          requestId: kept.requestId,
          replayed: true,
          idempotencyKey,
          reservedMicrosUsd: null,
          queries: [],
          coverage: [],
          markers: buildMarkerReceipts("done"),
          link: giResearchLink(organizationId, { requestId: kept.requestId }),
        };
      }
      if (seams.dispatch) {
        const redispatched = await seams.dispatch({
          organizationId,
          requestId: kept.requestId,
          correlationId,
          idempotencyKey,
        });
        return {
          outcome: "replayed",
          requestId: redispatched.requestId,
          replayed: true,
          idempotencyKey,
          reservedMicrosUsd: null,
          queries: [],
          coverage: [],
          markers: buildMarkerReceipts("queued"),
          link: giResearchLink(organizationId, { requestId: redispatched.requestId }),
        };
      }
      return {
        outcome: "kept",
        requestId: kept.requestId,
        replayed: true,
        idempotencyKey,
        reservedMicrosUsd: null,
        queries: [],
        coverage: [],
        markers: buildMarkerReceipts("queued"),
        link: giResearchLink(organizationId, { requestId: kept.requestId }),
      };
    }
  }

  // Bind the current approved profile version + digest; the full document
  // arrives by versionId (the pack carries the pointer only). No pointer —
  // no bind — no run: unscoped research never dispatches.
  const pointer = parsed.profileVersion ?? null;
  if (!pointer) {
    return {
      outcome: "blocked",
      reasonCode: "PROVIDER_NOT_QUALIFIED",
      copy: "No current Market Profile version is bound to this chat; scoped research cannot start.",
      spentMicrosUsd: 0,
      synthesis: {
        mode: "internal-only",
        limitations: [
          "No current Market Profile version; this answer uses internal evidence only.",
        ],
      },
      markers: buildMarkerReceipts("blocked"),
      link: giResearchLink(organizationId),
    };
  }
  let queries: string[] = [];
  if (seams.profiles) {
    const profile = await seams.profiles.readVersion({
      organizationId,
      versionId: pointer.versionId,
    });
    if (!profile || !profile.enabled || profile.digest !== pointer.digest) {
      return {
        outcome: "blocked",
        reasonCode: "PROVIDER_NOT_QUALIFIED",
        copy: "The Market Profile changed while this research was queued; re-route to rebind.",
        spentMicrosUsd: 0,
        synthesis: {
          mode: "internal-only",
          limitations: ["Market Profile version moved; this answer uses internal evidence only."],
        },
        markers: buildMarkerReceipts("blocked"),
        link: giResearchLink(organizationId),
      };
    }
    queries = buildProfileScopeQueries(profile.document);
  }

  if (!seams.requests || !seams.dispatch) {
    // No durable seams wired (unit scope): report the bound, gated plan
    // without spending or dispatching.
    return {
      outcome: "dispatched",
      requestId: "pending",
      replayed: false,
      idempotencyKey,
      reservedMicrosUsd: null,
      queries,
      coverage: [],
      markers: buildMarkerReceipts("queued"),
      link: giResearchLink(organizationId),
    };
  }

  const enqueued = await seams.requests.enqueue({
    organizationId,
    ...(parsed.branchId ? { branchId: parsed.branchId } : { branchId: null }),
    ...(pointer ? { profileVersion: pointer } : {}),
    correlationId,
    idempotencyKey,
  } as {
    organizationId: string;
    branchId?: string | null;
    profileVersion: ProfileScopePointer;
    correlationId: string;
    idempotencyKey: string;
  });
  if (enqueued.replayed) {
    const status = await seams.requests.getStatus({
      organizationId,
      requestId: enqueued.requestId,
    });
    if (status && isTerminalRequestStatus(status)) {
      // Terminal rows never reopen: return the kept row, dispatch nothing.
      return {
        outcome: "kept",
        requestId: enqueued.requestId,
        replayed: true,
        idempotencyKey,
        reservedMicrosUsd: null,
        queries,
        coverage: [],
        markers: buildMarkerReceipts("done"),
        link: giResearchLink(organizationId, { requestId: enqueued.requestId }),
      };
    }
  }

  // Reserve-before-call: the worst case is admitted before the worker runs.
  let reservedMicrosUsd: number | null = null;
  if (seams.budget) {
    const reservation = await seams.budget.reserveRequestBudget({
      organizationId,
      requestId: enqueued.requestId,
    });
    reservedMicrosUsd =
      reservation && typeof reservation.quoteMicrosUsd === "number"
        ? reservation.quoteMicrosUsd
        : null;
  }

  const dispatched = await seams.dispatch({
    organizationId,
    requestId: enqueued.requestId,
    correlationId,
    idempotencyKey,
  });
  return {
    outcome: enqueued.replayed || dispatched.replayed ? "replayed" : "dispatched",
    requestId: dispatched.requestId,
    replayed: enqueued.replayed || dispatched.replayed,
    idempotencyKey,
    reservedMicrosUsd,
    queries,
    coverage: [],
    markers: buildMarkerReceipts("queued"),
    link: giResearchLink(organizationId, { requestId: dispatched.requestId }),
  };
}

// ---------------------------------------------------------------------------
// Watch: duplicate check, create, update, scope rule
// ---------------------------------------------------------------------------

export const watchCompetitorSchema = briefCompetitorSchema;

export const executeWatchInputSchema = z
  .object({
    organizationId: z.string().uuid(),
    actorId: z.string().trim().min(1).max(200),
    branchId: z.string().uuid(),
    title: z.string().trim().min(1).max(200).optional(),
    question: z.string().trim().min(1).max(2000),
    mode: z.enum(["one-time", "recurring"]),
    schedule: researchProjectScheduleSchema.optional(),
    researchArea: z.string().trim().min(1).max(160),
    competitors: z.array(watchCompetitorSchema).max(20).default([]),
    investigationAreas: z
      .array(z.enum(BRIEF_INVESTIGATION_AREAS))
      .min(1)
      .max(5)
      .default(["demand", "presence", "offers", "reviews", "observable_performance"]),
    businessContextSnapshotId: z.string().uuid().optional(),
    /** Client per-press key (min 16), replayed on redelivery. */
    idempotencyKey: z.string().trim().min(16).max(200),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.mode === "recurring" && !input.schedule) {
      context.addIssue({
        code: "custom",
        path: ["schedule"],
        message: "A recurring project needs a schedule.",
      });
    }
    if (input.mode === "one-time" && input.schedule) {
      context.addIssue({
        code: "custom",
        path: ["schedule"],
        message: "A one-time project runs on explicit starts and carries no schedule.",
      });
    }
    const normalized = input.competitors.map((competitor) =>
      competitor.name.trim().replace(/\s+/g, " ").toLowerCase(),
    );
    if (new Set(normalized).size !== normalized.length) {
      context.addIssue({
        code: "custom",
        path: ["competitors"],
        message: "Competitor names must be unique.",
      });
    }
  });

export type ExecuteWatchInput = z.infer<typeof executeWatchInputSchema>;

export type WatchCandidate = {
  projectId: string;
  title: string;
  question: string;
  mode: "one-time" | "recurring";
  scopeFingerprint: string;
};

export type WatchProjectSeams = {
  listActive(input: {
    organizationId: string;
    branchId: string;
    limit: number;
  }): Promise<WatchCandidate[]>;
  createKeyed(input: {
    organizationId: string;
    branchId: string;
    title: string;
    question: string;
    mode: "one-time" | "recurring";
    schedule?: z.infer<typeof researchProjectScheduleSchema>;
    actorId: string;
    idempotencyKey: string;
    scopeFingerprint: string;
  }): Promise<{ projectId: string; replayed: boolean }>;
};

function frequencyForWatchMode(mode: "one-time" | "recurring", cadence?: string): string {
  if (mode === "one-time") return "once";
  return cadence ?? "weekly";
}

function deriveWatchTitle(question: string): string {
  const trimmed = question.trim();
  if (trimmed.length <= 80) return trimmed;
  return `${trimmed.slice(0, 80).trimEnd()}…`;
}

export type WatchCreateOutcome =
  | {
      outcome: "created" | "replayed";
      projectId: string;
      replayed: boolean;
      scopeFingerprint: string;
      link: ReturnType<typeof giResearchLink>;
    }
  | {
      outcome: "duplicate";
      candidates: WatchCandidate[];
      card: QuestionnaireSpec;
      scopeFingerprint: string;
    };

/**
 * Creates a monitoring watch (spec 10.2). A similar active scope pauses
 * creation and returns the duplicate-watch card instead: View existing /
 * Update fields / Start fresh (explicit confirm) / Cancel. Twin reuse
 * (same title + question + mode) joins the live project; fingerprint
 * equality converges retries and double submits.
 */
export async function executeWatchCreate(
  input: ExecuteWatchInput,
  seams: WatchProjectSeams,
): Promise<WatchCreateOutcome> {
  const parsed = executeWatchInputSchema.parse(input);
  const title = parsed.title ?? deriveWatchTitle(parsed.question);
  const frequency = frequencyForWatchMode(parsed.mode, parsed.schedule?.cadence);
  const scopeFingerprint = fingerprintMonitoringScope({
    organizationId: parsed.organizationId,
    branchId: parsed.branchId,
    title,
    question: parsed.question,
    mode: parsed.mode,
    ...(parsed.schedule ? { schedule: parsed.schedule } : {}),
    researchArea: parsed.researchArea,
    competitors: parsed.competitors,
    investigationAreas: parsed.investigationAreas,
    businessContextSnapshotId:
      parsed.businessContextSnapshotId ?? "00000000-0000-0000-0000-000000000000",
    frequency,
  });

  const siblings = await seams.listActive({
    organizationId: parsed.organizationId,
    branchId: parsed.branchId,
    limit: 50,
  });
  const twin = siblings.find(
    (project) =>
      project.title === title &&
      project.question === parsed.question &&
      project.mode === parsed.mode,
  );
  const similar = twin ?? siblings.find((project) => project.scopeFingerprint === scopeFingerprint);
  if (similar) {
    const candidates = siblings.filter(
      (project) =>
        project.projectId === similar.projectId || project.scopeFingerprint === scopeFingerprint,
    );
    return {
      outcome: "duplicate",
      candidates: candidates.length > 0 ? candidates : [similar],
      card: buildDuplicateWatchCard({
        intent: "watch",
        page: "overview",
        contextDigest: scopeFingerprint.slice(0, 16),
        projectId: similar.projectId,
      }),
      scopeFingerprint,
    };
  }

  const created = await seams.createKeyed({
    organizationId: parsed.organizationId,
    branchId: parsed.branchId,
    title,
    question: parsed.question,
    mode: parsed.mode,
    ...(parsed.schedule ? { schedule: parsed.schedule } : {}),
    actorId: parsed.actorId,
    idempotencyKey: parsed.idempotencyKey,
    scopeFingerprint,
  });
  return {
    outcome: created.replayed ? "replayed" : "created",
    projectId: created.projectId,
    replayed: created.replayed,
    scopeFingerprint,
    link: giResearchLink(parsed.organizationId, { projectId: created.projectId }),
  };
}

/**
 * Duplicate-watch Questionnaire card (spec 10.2): View existing (link
 * Marker to the GI project) / Update fields (Frequency, Branch, research
 * area, Competitors, end date) / Start fresh anyway (explicit confirm —
 * mints a second project with a distinct fingerprint) / Cancel.
 */
export function buildDuplicateWatchCard(input: {
  intent: "watch";
  page: string;
  contextDigest: string;
  projectId: string;
}): QuestionnaireSpec {
  const digestPart = input.contextDigest
    .trim()
    .slice(0, 16)
    .replace(/[^a-z0-9]/gi, "x")
    .toLowerCase();
  const pagePart = input.page
    .trim()
    .slice(0, 60)
    .replace(/[^a-z0-9]/gi, "x")
    .toLowerCase();
  return questionnaireSpecSchema.parse({
    kind: "duplicate_watch",
    title: "Watch already running",
    resumeKey: `router:watch:${pagePart}:${digestPart}`,
    items: [
      {
        key: "choice",
        label: "A similar watch already exists. What should happen?",
        kind: "single_select",
        required: true,
        options: [
          { value: "view_existing", label: "View existing" },
          { value: "update_fields", label: "Update fields" },
          { value: "start_fresh", label: "Start fresh anyway" },
          { value: "cancel", label: "Cancel" },
        ],
        helpText: `Existing watch ${input.projectId}.`,
      },
      {
        key: "frequency",
        label: "How often should this run?",
        kind: "single_select",
        required: false,
        options: [
          { value: "daily", label: "Daily" },
          { value: "weekly", label: "Weekly" },
          { value: "monthly", label: "Monthly" },
        ],
        helpText: "Only for Update fields.",
      },
      {
        key: "branch",
        label: "Which branch is this for?",
        kind: "text",
        required: false,
        helpText: "Only for Update fields.",
      },
      {
        key: "end_date",
        label: "When should monitoring stop?",
        kind: "date",
        required: false,
        helpText: "Leave empty for no end date. Only for Update fields.",
      },
      {
        key: "confirm_start_fresh",
        label: "Start a second watch anyway?",
        kind: "confirm",
        required: false,
        helpText: "Starting fresh mints a second project with a distinct fingerprint.",
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Watch update + scope rule
// ---------------------------------------------------------------------------

export const watchUpdateEditsSchema = z
  .object({
    frequency: z.enum(BRIEF_FREQUENCIES).optional(),
    branchId: z.string().uuid().optional(),
    researchArea: z.string().trim().min(1).max(160).optional(),
    competitors: z.array(watchCompetitorSchema).max(20).optional(),
    investigationAreas: z.array(z.enum(BRIEF_INVESTIGATION_AREAS)).min(1).max(5).optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => {
        const parsed = new Date(`${value}T00:00:00.000Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
      }, "End date must be a real calendar date (YYYY-MM-DD).")
      .optional(),
  })
  .strict();

export type WatchUpdateEdits = z.infer<typeof watchUpdateEditsSchema>;

export type ScopeWidening = {
  widened: boolean;
  addedCompetitors: string[];
  addedTopics: string[];
  researchAreaChanged: boolean;
};

function normalizeCompetitorName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Scope rule (spec 10.2): adding a new competitor or topic (or moving the
 * research area) is `profile_scope_change` — recurring runs on the widened
 * scope start only after operator approval of a Market Profile proposal.
 * Frequency/branch/end-date edits stay in place. Recurring never silently
 * widens scope.
 */
export function detectScopeWidening(
  current: Pick<BriefRevision, "researchArea" | "competitors" | "investigationAreas">,
  edits: WatchUpdateEdits,
): ScopeWidening {
  const currentNames = new Set(current.competitors.map((c) => normalizeCompetitorName(c.name)));
  const requestedNames = new Set(
    (edits.competitors ?? []).map((c) => normalizeCompetitorName(c.name)),
  );
  const addedCompetitors = [...requestedNames].filter((name) => !currentNames.has(name));
  const currentAreas = new Set(current.investigationAreas);
  const addedTopics = (edits.investigationAreas ?? []).filter((area) => !currentAreas.has(area));
  const researchAreaChanged =
    edits.researchArea !== undefined &&
    edits.researchArea.trim().toLowerCase() !== current.researchArea.trim().toLowerCase();
  const widened = addedCompetitors.length > 0 || addedTopics.length > 0 || researchAreaChanged;
  return { widened, addedCompetitors, addedTopics, researchAreaChanged };
}

export type WatchUpdateOutcome =
  | {
      outcome: "profile_scope_change";
      projectId: string;
      widening: ScopeWidening;
      /** Proposal payload for the `market-profile/proposals` approve flow. */
      proposal: {
        addedCompetitors: string[];
        addedTopics: string[];
        researchArea: string | null;
      };
    }
  | {
      outcome: "update_blocked";
      projectId: string;
      reasonCode: "WATCH_UPDATE_UNAVAILABLE";
      copy: string;
      validatedEdits: WatchUpdateEdits;
    };

/**
 * Applies watch edits. New competitors/topics (or a moved research area)
 * never apply in place: they return the `profile_scope_change` proposal for
 * the Market Profile approve flow. Frequency/branch/end-date edits are
 * validated here, but this tree has no fenced project-schedule update RPC
 * yet (the schedule lives on the project row, written only at create), so
 * in-place application fails closed with `WATCH_UPDATE_UNAVAILABLE` rather
 * than diverging the brief from the project row. The validated edits travel
 * in the outcome so the future fenced update can apply them unchanged.
 */
export async function executeWatchUpdate(input: {
  organizationId: string;
  actorId: string;
  projectId: string;
  brief: BriefRevision;
  edits: WatchUpdateEdits;
  idempotencyKey: string;
}): Promise<WatchUpdateOutcome> {
  const head = z
    .object({
      organizationId: z.string().uuid(),
      actorId: z.string().trim().min(1).max(200),
      projectId: z.string().uuid(),
      brief: briefRevisionSchema,
      idempotencyKey: z.string().trim().min(16).max(200),
    })
    .strict()
    .parse({
      organizationId: input.organizationId,
      actorId: input.actorId,
      projectId: input.projectId,
      brief: input.brief,
      idempotencyKey: input.idempotencyKey,
    });
  const edits = watchUpdateEditsSchema.parse(input.edits);
  if (
    head.brief.organizationId !== head.organizationId ||
    head.brief.projectId !== head.projectId
  ) {
    throw new DomainError("TENANT_SCOPE_ERROR", "This chat was not found in your organization.");
  }

  const widening = detectScopeWidening(head.brief, edits);
  if (widening.widened) {
    return {
      outcome: "profile_scope_change",
      projectId: head.projectId,
      widening,
      proposal: {
        addedCompetitors: widening.addedCompetitors,
        addedTopics: widening.addedTopics,
        researchArea: edits.researchArea ?? null,
      },
    };
  }
  return {
    outcome: "update_blocked",
    projectId: head.projectId,
    reasonCode: "WATCH_UPDATE_UNAVAILABLE",
    copy: "Watch schedule changes need a project update that is not available yet; nothing was changed.",
    validatedEdits: edits,
  };
}

// ---------------------------------------------------------------------------
// Questionnaire answers: persistence + re-route (ruling F2)
// ---------------------------------------------------------------------------

export const questionnaireAnswersSchema = z.record(z.string(), z.unknown());

/**
 * Validates submitted answers against the spec that asked them: required
 * items must arrive non-blank, single-select values must be live options,
 * dates must be real calendar dates, confirms must read as yes/no.
 * Returns the trimmed, normalized answer record. Failures throw
 * VALIDATION_ERROR naming the first invalid item (mirrors the drawer's
 * first-invalid-focus behavior).
 */
export function validateQuestionnaireAnswers(
  spec: QuestionnaireSpec,
  answers: unknown,
): Record<string, string> {
  const parsedSpec = questionnaireSpecSchema.parse(spec);
  const parsedAnswers = questionnaireAnswersSchema.parse(answers);
  const normalized: Record<string, string> = {};
  for (const item of parsedSpec.items) {
    const raw = parsedAnswers[item.key];
    const text = typeof raw === "boolean" ? (raw ? "yes" : "no") : String(raw ?? "").trim();
    if (item.required && text.length === 0) {
      throw new DomainError("VALIDATION_ERROR", `Answer the "${item.label}" step to continue.`);
    }
    if (text.length === 0) continue;
    if (item.kind === "single_select") {
      const values = (item.options ?? []).map((option) => option.value);
      if (!values.includes(text)) {
        throw new DomainError("VALIDATION_ERROR", `Answer the "${item.label}" step to continue.`);
      }
    }
    if (item.kind === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      throw new DomainError("VALIDATION_ERROR", `Answer the "${item.label}" step to continue.`);
    }
    normalized[item.key] = text;
  }
  return normalized;
}

/**
 * Deterministic body encoding for an answers message: the answers reach
 * the server by appending to thread messages (the fenced keyed RPC owns
 * persistence), and the fixed `[answers <kind>]` header lets re-route and
 * history reopen recognize the row without a schema change.
 */
export function encodeQuestionnaireAnswerBody(
  spec: QuestionnaireSpec,
  answers: Record<string, string>,
): string {
  const parsedSpec = questionnaireSpecSchema.parse(spec);
  const lines = [`[answers ${parsedSpec.kind}]`];
  for (const item of parsedSpec.items) {
    const value = answers[item.key];
    if (value !== undefined) lines.push(`${item.key}: ${value}`);
  }
  return lines.join("\n").slice(0, 20000);
}

export type AnswerSubmitSeams = {
  threads: Pick<ThreadRepository, "getThread" | "appendMessageKeyed" | "getMessage">;
  reroute: (input: {
    organizationId: string;
    actorId: string;
    role: "viewer" | "operator" | "admin" | "owner";
    threadId: string;
    page?: string;
    idempotencyKey?: string;
  }) => Promise<{ intent: string; questionnaire: QuestionnaireSpec | null; routingNote: string }>;
};

/**
 * Questionnaire-answer persistence + re-route (ruling F2). Submitted
 * answers reach the server — appended to thread messages through the
 * fenced keyed RPC — and re-trigger routing in the same call. The path is
 * explicit and server-side, never local-only: viewers are refused before
 * persistence, foreign threads read as not-found, and the reroute carries
 * a derived key (`<answersKey>:reroute`) so answer submission never
 * collides with the original route token (ruling L4).
 */
export async function submitQuestionnaireAnswers(
  input: {
    organizationId: string;
    actorId: string;
    role: "viewer" | "operator" | "admin" | "owner";
    threadId: string;
    spec: QuestionnaireSpec;
    answers: unknown;
    idempotencyKey: string;
    page?: string;
  },
  seams: AnswerSubmitSeams,
): Promise<{
  messageId: string;
  replayed: boolean;
  answers: Record<string, string>;
  intent: string;
  questionnaire: QuestionnaireSpec | null;
}> {
  if (input.role === "viewer") {
    throw new DomainError("AUTHORIZATION_ERROR", "Viewers cannot change this chat.");
  }
  const idempotencyKey = z.string().trim().min(16).max(200).parse(input.idempotencyKey);
  const normalized = validateQuestionnaireAnswers(input.spec, input.answers);
  const thread = await seams.threads.getThread({
    organizationId: input.organizationId,
    threadId: input.threadId,
  });
  if (!thread) {
    throw new DomainError("TENANT_SCOPE_ERROR", "This chat was not found in your organization.");
  }
  const appended = await seams.threads.appendMessageKeyed({
    organizationId: input.organizationId,
    actorId: input.actorId,
    threadId: input.threadId,
    role: "user",
    body: encodeQuestionnaireAnswerBody(input.spec, normalized),
    idempotencyKey,
  });
  const routed = await seams.reroute({
    organizationId: input.organizationId,
    actorId: input.actorId,
    role: input.role,
    threadId: input.threadId,
    ...(input.page ? { page: input.page } : {}),
    idempotencyKey: `${idempotencyKey}:reroute`,
  });
  return {
    messageId: appended.messageId,
    replayed: appended.replayed,
    answers: normalized,
    intent: routed.intent,
    questionnaire: routed.questionnaire,
  };
}

// ---------------------------------------------------------------------------
// Context-pack digest resolver (routeLatest swap off the V1 placeholder)
// ---------------------------------------------------------------------------

/**
 * Builds the real HEAVY pack through the injected readers and returns its
 * stable digest for the router note. Refused packs still carry a stable
 * digest, so oversize never breaks routing — it routes on the refusal
 * digest with honest limitations. Shape-compatible with the Task 3
 * placeholder (`/^[0-9a-f]{16}$/`); only the values shift, because the
 * digest now means something (Task 5 report).
 */
export async function resolvePackContextDigest(input: {
  organizationId: string;
  userId: string;
  branchId?: string;
  windowDays?: 30 | 60;
  page: string;
  readers?: ContextPackReaders;
  now?: Date | string;
}): Promise<{ digest: string; pack: ContextPack }> {
  const scope: ContextPackScope = {
    organizationId: input.organizationId,
    userId: input.userId,
    ...(input.branchId ? { branchId: input.branchId } : {}),
    windowDays: input.windowDays ?? 30,
    page: input.page,
  };
  const pack = await buildAgentContextPack({
    ...scope,
    ...(input.readers ? { readers: input.readers } : {}),
    ...(input.now !== undefined ? { now: input.now } : {}),
  });
  return { digest: pack.digest, pack };
}
