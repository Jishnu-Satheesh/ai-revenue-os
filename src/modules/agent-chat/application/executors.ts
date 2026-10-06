import { z } from "zod";

import { questionnaireSpecSchema, type QuestionnaireSpec } from "@/domain/agent-router/contracts";
import {
  BRIEF_FREQUENCIES,
  BRIEF_INVESTIGATION_AREAS,
  briefCompetitorSchema,
  briefRevisionSchema,
  type BriefRevision,
} from "@/domain/growth-intelligence/brief";
import {
  RESEARCH_PROJECT_CADENCES,
  researchProjectScheduleSchema,
} from "@/domain/growth-intelligence/project";
import { marketProfileDocumentSchema } from "@/domain/growth-intelligence/schemas";
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
 * Thread-linked idempotency helpers live in the client-safe leaf
 * (`./thread-keys`) — the campaign handoff mints keys from there without
 * pulling this lane module into the client bundle. Re-exported here so
 * existing lane importers keep working.
 */
import {
  AGENT_THREAD_IDEMPOTENCY_PREFIX,
  buildThreadIdempotencyKey,
  messageDigestFor,
} from "@/modules/agent-chat/application/thread-keys";

export { AGENT_THREAD_IDEMPOTENCY_PREFIX, buildThreadIdempotencyKey, messageDigestFor };

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
  const parsed = marketProfileDocumentSchema.safeParse(document);
  if (!parsed.success) return [];
  const scope = parsed.data;
  const city = scope.geographies.find((geography) => geography.layer === "city");
  if (!city || city.layer !== "city") return [];
  const excludedCompetitors = new Set(scope.sourcePolicy.excludedCompetitorKeys);
  const candidates: string[] = [];
  const push = (query: string) => {
    const clean = query.trim().replace(/\s+/g, " ").slice(0, 160);
    if (clean.length > 0 && !candidates.includes(clean)) candidates.push(clean);
  };
  for (const topic of scope.topics.slice(0, 5)) {
    push(`${scope.publicIdentity.approvedName} ${city.name} ${topic.label}`);
  }
  for (const competitor of scope.competitors
    .filter((competitor) => !excludedCompetitors.has(competitor.key))
    .slice(0, 5)) {
    push(`${competitor.name} ${city.name} ${scope.nicheDescriptors[0] ?? ""}`);
  }
  if (scope.nicheDescriptors[0]) {
    push(`${scope.nicheDescriptors[0]} ${city.name} ${city.countryCode} market`);
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
  /**
   * Live fingerprint from the scope registry, or null when the project
   * holds none. Null never matches: twin comparison still applies, and
   * the keyed create stays the authoritative fence.
   */
  scopeFingerprint: string | null;
};

export type WatchKeyedCreateInput = Omit<ExecuteWatchInput, "title" | "businessContextSnapshotId"> & {
  title: string;
  businessContextSnapshotId: string;
  scopeFingerprint: string;
};

export type WatchProjectSeams = {
  listActive(input: {
    organizationId: string;
    branchId: string;
    limit: number;
  }): Promise<WatchCandidate[]>;
  /** Exact tenant/key source record only; a new key never inherits a prior choice. */
  findCreatedByKey?(input: WatchKeyedCreateInput): Promise<string | null>;
  createKeyed(input: WatchKeyedCreateInput): Promise<{ projectId: string; replayed: boolean }>;
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

  const createInput: WatchKeyedCreateInput = {
    organizationId: parsed.organizationId,
    branchId: parsed.branchId,
    title,
    question: parsed.question,
    mode: parsed.mode,
    ...(parsed.schedule ? { schedule: parsed.schedule } : {}),
    actorId: parsed.actorId,
    idempotencyKey: parsed.idempotencyKey,
    scopeFingerprint,
    researchArea: parsed.researchArea,
    competitors: parsed.competitors,
    investigationAreas: parsed.investigationAreas,
    businessContextSnapshotId:
      parsed.businessContextSnapshotId ?? "00000000-0000-0000-0000-000000000000",
  };
  const recordedProjectId = await seams.findCreatedByKey?.(createInput);
  const siblings = recordedProjectId ? [] : await seams.listActive({
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

  const created = await seams.createKeyed(createInput);
  if (recordedProjectId && created.projectId !== recordedProjectId) {
    throw new DomainError("INTEGRATION_ERROR", "The saved watch could not be resumed safely.");
  }
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
        key: "research_area",
        label: "Which research area should change?",
        kind: "text",
        required: false,
        helpText:
          "Only for Update fields. Changing the area proposes a Market Profile update instead of editing in place.",
      },
      {
        key: "competitors",
        label: "Which competitor should be added?",
        kind: "text",
        required: false,
        helpText:
          "Only for Update fields. One competitor name; adding a competitor proposes a Market Profile update instead of editing in place. A competitor website must be a valid public HTTP or HTTPS URL.",
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

const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "End date must be a real calendar date (YYYY-MM-DD).");

export const watchUpdateEditsSchema = z
  .object({
    frequency: z.enum(BRIEF_FREQUENCIES).optional(),
    branchId: z.string().uuid().optional(),
    researchArea: z.string().trim().min(1).max(160).optional(),
    competitors: z.array(watchCompetitorSchema).max(20).optional(),
    investigationAreas: z.array(z.enum(BRIEF_INVESTIGATION_AREAS)).min(1).max(5).optional(),
    /**
     * New monitoring end date; null clears it. An empty string keeps the
     * current value (the card submits empty for "no change").
     */
    endDate: calendarDateSchema.nullable().optional(),
    localTime: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Local time must be HH:MM.")
      .optional(),
    timeZone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((timeZone) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone }).format();
          return true;
        } catch {
          return false;
        }
      }, "Timezone must be a valid IANA timezone.")
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

export const watchUpdateProjectSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    question: z.string().trim().min(1).max(2000),
    mode: z.enum(["one-time", "recurring"]),
    branchId: z.string().uuid(),
    schedule: researchProjectScheduleSchema,
  })
  .strict();

export type WatchUpdateProject = z.infer<typeof watchUpdateProjectSchema>;

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
      outcome: "updated";
      projectId: string;
      revisionNumber: number | null;
      replayed: boolean;
      appliedFields: string[];
      scopeFingerprint: string;
    }
  | {
      outcome: "update_blocked";
      projectId: string;
      reasonCode: "WATCH_UPDATE_UNAVAILABLE";
      copy: string;
      validatedEdits: WatchUpdateEdits;
    };

export type WatchUpdateSeams = {
  /**
   * Applies the merged schedule through the fenced
   * `update_research_project_schedule_keyed` RPC: the project row and —
   * where the cadence or branch moved — a new brief revision move
   * atomically, and the scope registry follows the new fingerprint.
   */
  updateWatch?(input: {
    organizationId: string;
    actorId: string;
    projectId: string;
    schedule: z.infer<typeof researchProjectScheduleSchema>;
    branchId: string;
    idempotencyKey: string;
    scopeFingerprint: string;
  }): Promise<{ projectId: string; revisionNumber: number | null; replayed: boolean }>;
};

/**
 * Applies watch edits. New competitors/topics (or a moved research area)
 * never apply in place: they return the `profile_scope_change` proposal for
 * the Market Profile approve flow. Frequency/branch/end-date (plus
 * local-time/timezone) edits merge onto the current schedule and apply
 * through the fenced keyed schedule-update RPC, which moves the project
 * row and — where the cadence or branch moved — a new brief revision
 * atomically, and re-points the scope registry at the new fingerprint.
 * Recurring never silently widens scope.
 */
export async function executeWatchUpdate(
  input: {
    organizationId: string;
    actorId: string;
    projectId: string;
    project: WatchUpdateProject;
    brief: BriefRevision;
    edits: WatchUpdateEdits;
    idempotencyKey: string;
  },
  seams: WatchUpdateSeams = {},
): Promise<WatchUpdateOutcome> {
  const head = z
    .object({
      organizationId: z.string().uuid(),
      actorId: z.string().trim().min(1).max(200),
      projectId: z.string().uuid(),
      project: watchUpdateProjectSchema,
      brief: briefRevisionSchema,
      idempotencyKey: z.string().trim().min(16).max(200),
    })
    .strict()
    .parse({
      organizationId: input.organizationId,
      actorId: input.actorId,
      projectId: input.projectId,
      project: input.project,
      brief: input.brief,
      idempotencyKey: input.idempotencyKey,
    });
  const rawEdits = watchUpdateEditsSchema.parse(input.edits);
  // The card submits an empty end date for "no change"; only an explicit
  // null clears the date.
  const edits: WatchUpdateEdits = { ...rawEdits };
  if (edits.endDate === "") delete edits.endDate;
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

  const scheduleAffecting =
    edits.frequency !== undefined ||
    edits.endDate !== undefined ||
    edits.localTime !== undefined ||
    edits.timeZone !== undefined;
  if (head.project.mode !== "recurring" && (scheduleAffecting || edits.branchId !== undefined)) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "A one-time project runs on explicit starts and carries no schedule.",
    );
  }
  if (edits.frequency === "once") {
    throw new DomainError(
      "VALIDATION_ERROR",
      "A recurring watch cannot run once; archive it instead.",
    );
  }

  const current = head.project.schedule;
  const schedule: z.infer<typeof researchProjectScheduleSchema> = {
    cadence: edits.frequency ?? current.cadence,
    localTime: edits.localTime ?? current.localTime,
    timeZone: edits.timeZone ?? current.timeZone,
    ...(edits.endDate !== undefined
      ? edits.endDate === null
        ? {}
        : { endDate: edits.endDate }
      : current.endDate !== undefined
        ? { endDate: current.endDate }
        : {}),
  };
  const branchId = edits.branchId ?? head.project.branchId;
  const appliedFields: string[] = [];
  if (schedule.cadence !== current.cadence) appliedFields.push("frequency");
  if (schedule.localTime !== current.localTime) appliedFields.push("localTime");
  if (schedule.timeZone !== current.timeZone) appliedFields.push("timeZone");
  if ((schedule.endDate ?? null) !== (current.endDate ?? null)) appliedFields.push("endDate");
  if (branchId !== head.project.branchId) appliedFields.push("branch");

  const scopeFingerprint = fingerprintMonitoringScope({
    organizationId: head.organizationId,
    branchId,
    title: head.project.title,
    question: head.project.question,
    mode: head.project.mode,
    schedule,
    researchArea: head.brief.researchArea,
    competitors: head.brief.competitors,
    investigationAreas: head.brief.investigationAreas,
    businessContextSnapshotId: head.brief.businessContextSnapshotId,
    frequency: head.project.mode === "one-time" ? "once" : schedule.cadence,
  });

  if (appliedFields.length === 0) {
    return {
      outcome: "updated",
      projectId: head.projectId,
      revisionNumber: null,
      replayed: true,
      appliedFields,
      scopeFingerprint,
    };
  }
  if (!seams.updateWatch) {
    return {
      outcome: "update_blocked",
      projectId: head.projectId,
      reasonCode: "WATCH_UPDATE_UNAVAILABLE",
      copy: "Watch schedule changes need a project update that is not available yet; nothing was changed.",
      validatedEdits: edits,
    };
  }
  const updated = await seams.updateWatch({
    organizationId: head.organizationId,
    actorId: head.actorId,
    projectId: head.projectId,
    schedule,
    branchId,
    idempotencyKey: head.idempotencyKey,
    scopeFingerprint,
  });
  return {
    outcome: "updated",
    projectId: updated.projectId,
    revisionNumber: updated.revisionNumber,
    replayed: updated.replayed,
    appliedFields,
    scopeFingerprint,
  };
}

// ---------------------------------------------------------------------------
// Auto-prepared watches (Task B4: L3 one inline tap to create)
// ---------------------------------------------------------------------------

/**
 * Evidence window default for prepared watches. The watch cards carry no
 * window choice, so every prepared payload resolves against the last 30
 * days with the assumption stated inline on the envelope — the drawer
 * renders it beside the receipt, never silently.
 */
export const WATCH_EVIDENCE_WINDOW_DAYS = 30 as const;

export const WATCH_EVIDENCE_WINDOW_ASSUMPTION =
  "Evidence window: last 30 days (default — widen it in Market Intelligence if seasonality needs 60).";

/** Pre-fill defaults: every default lands in `assumptions`, never silently. */
export const WATCH_DEFAULT_MODE = "recurring" as const;
export const WATCH_DEFAULT_CADENCE = "weekly" as const;
export const WATCH_DEFAULT_LOCAL_TIME = "09:00";
export const WATCH_DEFAULT_TIME_ZONE = "UTC";
export const WATCH_DEFAULT_INVESTIGATION_AREAS = [
  "demand",
  "presence",
  "offers",
  "reviews",
  "observable_performance",
] as const;

const watchPrefillExplicitSchema = z
  .object({
    /** The operator's ask — the routing note's question, never invented. */
    question: z.string().trim().min(1).max(2000).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    mode: z.enum(["one-time", "recurring"]).optional(),
    cadence: z.enum(RESEARCH_PROJECT_CADENCES).optional(),
    /** Branch uuid or branch name from the card; resolved against live rows. */
    branch: z.string().trim().min(1).max(200).optional(),
    researchArea: z.string().trim().min(1).max(160).optional(),
    competitorName: z.string().trim().min(1).max(160).optional(),
    endDate: calendarDateSchema.optional(),
  })
  .strict();

const watchPrefillPackSchema = z
  .object({
    branchTimezone: z.string().trim().min(1).max(100).optional(),
    competitors: z.array(watchCompetitorSchema).max(20).optional(),
  })
  .strict();

const watchBranchRowSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
  })
  .strict();

/**
 * Deterministic branch binding (no invention, ever): a uuid answer binds
 * only a live row, a name answer binds only a unique case-insensitive
 * match, and silence binds only when the organization holds exactly one
 * branch — with the assumption stated. Anything else refuses, and
 * malformed rows are skipped, never papered over.
 */
export function resolveWatchBranchId(
  rows: unknown,
  answer?: string,
): { ok: true; branchId: string; assumption: string | null } | { ok: false } {
  const usable = (Array.isArray(rows) ? rows : []).flatMap((row) => {
    const parsed = watchBranchRowSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
  const trimmed = answer?.trim() ?? "";
  if (trimmed.length > 0) {
    if (z.string().uuid().safeParse(trimmed).success) {
      const hit = usable.find((row) => row.id.toLowerCase() === trimmed.toLowerCase());
      return hit ? { ok: true, branchId: hit.id, assumption: null } : { ok: false };
    }
    const named = usable.filter(
      (row) => row.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    return named.length === 1 && named[0]
      ? { ok: true, branchId: named[0].id, assumption: null }
      : { ok: false };
  }
  if (usable.length === 1 && usable[0]) {
    return {
      ok: true,
      branchId: usable[0].id,
      assumption: `Bound automatically — only one branch in this organization (“${usable[0].name}”).`,
    };
  }
  return { ok: false };
}

const preparedWatchPayloadSchema = z
  .object({
    branchId: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    question: z.string().trim().min(1).max(2000),
    mode: z.enum(["one-time", "recurring"]),
    schedule: researchProjectScheduleSchema.optional(),
    researchArea: z.string().trim().min(1).max(160),
    competitors: z.array(watchCompetitorSchema).max(20),
    investigationAreas: z.array(z.enum(BRIEF_INVESTIGATION_AREAS)).min(1).max(5),
  })
  .strict();

export type PreparedWatchPayload = z.infer<typeof preparedWatchPayloadSchema>;

export type PrepareWatchCreateResult =
  | {
      ok: true;
      payload: PreparedWatchPayload;
      assumptions: string[];
      evidenceWindowDays: typeof WATCH_EVIDENCE_WINDOW_DAYS;
    }
  | {
      ok: false;
      missing: Array<"question" | "branch" | "researchArea">;
      copy: string;
    };

const PREPARE_MISSING_LABEL: Record<"question" | "branch" | "researchArea", string> = {
  question: "the watch question",
  branch: "the branch",
  researchArea: "the research area",
};

/**
 * Merges card answers (explicit, wins) with pack context into a complete
 * watch-create payload behind the single confirm tap. Cadence, branch,
 * areas, and competitors pre-fill from the routing note plus the pack;
 * every default is stated in `assumptions`. The question, branch, and
 * research area are never invented: silence or ambiguity there returns
 * the named missing fields instead of a payload.
 */
export function prepareWatchCreate(
  explicitInput: unknown,
  contextInput: unknown,
): PrepareWatchCreateResult {
  const explicit = watchPrefillExplicitSchema.parse(explicitInput);
  const context = z
    .object({ branchRows: z.unknown(), pack: watchPrefillPackSchema.optional() })
    .strict()
    .parse(contextInput);

  const missing: Array<"question" | "branch" | "researchArea"> = [];
  const question = explicit.question?.trim() ? explicit.question.trim() : null;
  if (!question) missing.push("question");
  const branch = resolveWatchBranchId(context.branchRows, explicit.branch);
  if (!branch.ok) missing.push("branch");
  const researchArea = explicit.researchArea?.trim() ? explicit.researchArea.trim() : null;
  if (!researchArea) missing.push("researchArea");
  if (missing.length > 0 || !question || !branch.ok || !researchArea) {
    const labels = missing.map((field) => PREPARE_MISSING_LABEL[field]).join(", ");
    return {
      ok: false,
      missing,
      copy: `Still needed: ${labels}. Send them as a message — the next card creates the watch in one tap.`,
    };
  }

  const assumptions: string[] = [];
  const mode = explicit.mode ?? WATCH_DEFAULT_MODE;
  if (!explicit.mode) {
    assumptions.push("Recurring watch (default — keeps monitoring until the end date).");
  }
  const cadence = explicit.cadence ?? WATCH_DEFAULT_CADENCE;
  if (!explicit.cadence) {
    assumptions.push("Weekly cadence (default — change it on the card or in Market Intelligence).");
  }
  const localTime = WATCH_DEFAULT_LOCAL_TIME;
  assumptions.push("Runs at 09:00 branch time (default).");
  const packTimeZone = context.pack?.branchTimezone?.trim() || null;
  const timeZone = packTimeZone ?? WATCH_DEFAULT_TIME_ZONE;
  if (!packTimeZone) {
    assumptions.push("Times in UTC (default — no branch timezone on file).");
  }
  if (branch.assumption) assumptions.push(branch.assumption);

  const competitors = [...(context.pack?.competitors ?? [])];
  const cardCompetitor = explicit.competitorName?.trim() || null;
  if (
    cardCompetitor &&
    !competitors.some((entry) => normalizeCompetitorName(entry.name) === normalizeCompetitorName(cardCompetitor))
  ) {
    // The operator named it — the truthful source is `operator_lead`.
    competitors.push({ name: cardCompetitor, source: "operator_lead" });
  }
  if (competitors.length === 0) {
    assumptions.push("No competitors pre-filled — add them in Market Intelligence.");
  }
  assumptions.push("Watching all five investigation areas (default).");
  assumptions.push(WATCH_EVIDENCE_WINDOW_ASSUMPTION);

  return {
    ok: true,
    payload: {
      branchId: branch.branchId,
      title: explicit.title?.trim() ? explicit.title.trim() : deriveWatchTitle(question),
      question,
      mode,
      ...(mode === "recurring"
        ? {
            schedule: {
              cadence,
              localTime,
              timeZone,
              ...(explicit.endDate ? { endDate: explicit.endDate } : {}),
            },
          }
        : {}),
      researchArea,
      competitors,
      investigationAreas: [...WATCH_DEFAULT_INVESTIGATION_AREAS],
    },
    assumptions,
    evidenceWindowDays: WATCH_EVIDENCE_WINDOW_DAYS,
  };
}

/**
 * Deterministic fresh title: the same submit retried replays through its
 * idempotency key, while a new submit mints a distinct title — and
 * therefore a distinct scope fingerprint, as the spec requires for a
 * second watch. The salt hashes the whole key (a tail slice would repeat
 * the lane suffix, looping every later fresh tap back to duplicate). The
 * base truncates so the cap always holds.
 */
export function freshWatchTitleFor(title: string, idempotencyKey: string): string {
  const cleanTitle = z.string().trim().min(1).max(200).parse(title);
  const key = z.string().trim().min(1).max(200).parse(idempotencyKey);
  const salt = messageDigestFor({ threadId: "fresh-watch", messageId: title, body: key }).slice(
    0,
    6,
  );
  const suffix = ` (fresh ${salt})`;
  const base =
    cleanTitle.length + suffix.length > 200
      ? cleanTitle.slice(0, 200 - suffix.length).trimEnd()
      : cleanTitle;
  return `${base}${suffix}`;
}

const watchCandidateRowSchema = z
  .object({
    projectId: z.string().trim().min(1).max(200),
    question: z.string().trim().min(1).max(2000),
    branchId: z.string().trim().min(1).max(200).optional(),
  })
  .passthrough();

/**
 * Server-side candidate binding for the duplicate choice: the unique live
 * project asking the same question (narrowed by branch when resolved).
 * Exactly one binds — zero or several bind nothing, and malformed rows
 * are skipped. The card's echoed project id is never trusted.
 */
export function matchWatchCandidate(siblings: unknown, filters: unknown): string | null {
  const parsed = z
    .object({
      question: z.string().trim().min(1).max(2000),
      branchId: z.string().trim().min(1).max(200).optional(),
    })
    .strict()
    .parse(filters);
  const wanted = parsed.question.trim();
  const matches = (Array.isArray(siblings) ? siblings : []).flatMap((row) => {
    const candidate = watchCandidateRowSchema.safeParse(row);
    if (!candidate.success) return [];
    if (candidate.data.question.trim() !== wanted) return [];
    if (parsed.branchId && candidate.data.branchId !== parsed.branchId) return [];
    return [candidate.data.projectId];
  });
  return matches.length === 1 && matches[0] ? matches[0] : null;
}

// ---------------------------------------------------------------------------
// Choice to instant watch (the inverted executor, campaign mirror)
// ---------------------------------------------------------------------------

export const DUPLICATE_WATCH_CHOICE_VALUES = [
  "view_existing",
  "update_fields",
  "start_fresh",
  "cancel",
] as const;

export type DuplicateWatchChoice = (typeof DUPLICATE_WATCH_CHOICE_VALUES)[number];

const watchCardEditsSchema = z
  .object({
    frequency: z.enum(BRIEF_FREQUENCIES).optional(),
    endDate: calendarDateSchema.nullable().optional(),
    branchId: z.string().uuid().optional(),
    researchArea: z.string().trim().min(1).max(160).optional(),
    competitorName: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

export type WatchCardEdits = z.infer<typeof watchCardEditsSchema>;

const watchChoiceLinksSchema = z
  .object({
    projectId: z.string().trim().min(1).max(200).optional(),
    requestId: z.string().trim().min(1).max(200).optional(),
    draftRequestId: z.string().trim().min(1).max(200).optional(),
    campaignId: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

const requestWatchFromChoiceInputSchema = z
  .object({
    organizationId: z.string().uuid(),
    actorId: z.string().trim().min(1).max(200),
    threadId: z.string().trim().min(1).max(200),
    idempotencyKey: z.string().trim().min(16).max(200),
    choice: z.enum(DUPLICATE_WATCH_CHOICE_VALUES),
    /** Caller-derived grants, never client claims — the route recomputes these from the role. */
    permissions: z.array(z.string().trim().min(1).max(120)).default([]),
    /** Required for `start_fresh`; view/update/cancel never touch it. */
    prepared: preparedWatchPayloadSchema.optional(),
    assumptions: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
    /** Server-resolved candidate (question match or thread link), never client-carried. */
    candidateProjectId: z.string().uuid().nullable().default(null),
    cardEdits: watchCardEditsSchema.optional(),
    /**
     * Sibling link ids already on the thread. The `set_thread_links` RPC
     * overwrites all four columns, so these ride along with the new
     * project id — posting it alone would silently wipe the rest.
     */
    existingLinks: watchChoiceLinksSchema.optional(),
  })
  .strict();

export type RequestWatchFromChoiceInput = z.input<typeof requestWatchFromChoiceInputSchema>;

export type WatchChoiceSeams = {
  watchProjects?: {
    listActive?: WatchProjectSeams["listActive"];
    createKeyed?: WatchProjectSeams["createKeyed"];
    findCreatedByKey?: WatchProjectSeams["findCreatedByKey"];
    readProject?: (input: {
      organizationId: string;
      projectId: string;
    }) => Promise<WatchUpdateProject | null>;
    readBrief?: (input: {
      organizationId: string;
      projectId: string;
    }) => Promise<BriefRevision | null>;
    updateWatch?: (
      input: Parameters<NonNullable<WatchUpdateSeams["updateWatch"]>>[0],
    ) => Promise<{ projectId: string; revisionNumber: number | null; replayed: boolean }>;
  };
  links?: {
    setThreadLinks(input: {
      organizationId: string;
      actorId: string;
      threadId: string;
      projectId: string;
      requestId?: string;
      draftRequestId?: string;
      campaignId?: string;
    }): Promise<unknown>;
  };
};

export type WatchChoiceOutcome =
  | { outcome: "blocked"; reasonCode: "WATCH_REQUIRES_MANAGE"; copy: string }
  | { outcome: "cancelled" }
  | {
      outcome: "view_existing";
      projectId: string | null;
      link: ReturnType<typeof giResearchLink>;
    }
  | {
      outcome: "created" | "replayed";
      projectId: string;
      replayed: boolean;
      scopeFingerprint: string;
      link: ReturnType<typeof giResearchLink>;
      assumptions: string[];
      evidenceWindowDays: typeof WATCH_EVIDENCE_WINDOW_DAYS;
    }
  | {
      outcome: "duplicate";
      candidates: WatchCandidate[];
      card: QuestionnaireSpec;
      scopeFingerprint: string;
    }
  | {
      outcome: "updated";
      projectId: string;
      revisionNumber: number | null;
      replayed: boolean;
      appliedFields: string[];
      scopeFingerprint: string;
      link: ReturnType<typeof giResearchLink>;
    }
  | {
      outcome: "profile_scope_change";
      projectId: string;
      widening: ScopeWidening;
      proposal: { addedCompetitors: string[]; addedTopics: string[]; researchArea: string | null };
    }
  | {
      outcome: "update_blocked";
      projectId: string | null;
      reasonCode: "WATCH_UPDATE_NO_CANDIDATE" | "WATCH_UPDATE_UNREADABLE" | "WATCH_UPDATE_UNAVAILABLE";
      copy: string;
    };

/**
 * Duplicate choice to instant watch. The choice submit calls the watch
 * seams immediately — no form round-trip, no dispatch indirection — under
 * a deterministic thread-linked idempotency key, so retries replay
 * instead of double-posting. The choice itself stays human judgment:
 * view navigates, cancel drops, fresh mints a second project with a
 * distinct fingerprint, and update applies in-place edits (or proposes a
 * Market Profile change when the edits widen scope). Fences hold: there
 * is no approve seam, no publish seam, no spend seam anywhere in this
 * lane — a tap creates or re-points a watch, nothing more.
 */
export async function requestWatchFromChoice(
  input: RequestWatchFromChoiceInput,
  seams: WatchChoiceSeams = {},
): Promise<WatchChoiceOutcome> {
  const parsed = requestWatchFromChoiceInputSchema.parse(input);
  if (!parsed.permissions.includes("growth_intelligence.manage")) {
    return {
      outcome: "blocked",
      reasonCode: "WATCH_REQUIRES_MANAGE",
      copy: "Watch changes need the growth_intelligence.manage grant.",
    };
  }

  switch (parsed.choice) {
    case "cancel":
      return { outcome: "cancelled" };
    case "view_existing":
      return {
        outcome: "view_existing",
        projectId: parsed.candidateProjectId,
        link: giResearchLink(
          parsed.organizationId,
          parsed.candidateProjectId ? { projectId: parsed.candidateProjectId } : {},
        ),
      };
    case "start_fresh": {
      if (!parsed.prepared) {
        throw new DomainError("VALIDATION_ERROR", "Please check the submitted fields.");
      }
      const listActive = seams.watchProjects?.listActive;
      const createKeyed = seams.watchProjects?.createKeyed;
      if (!listActive || !createKeyed) {
        throw new DomainError("DOMAIN_ERROR", "Watch dispatch is not wired for this chat.");
      }
      const created = await executeWatchCreate(
        {
          organizationId: parsed.organizationId,
          actorId: parsed.actorId,
          branchId: parsed.prepared.branchId,
          title: freshWatchTitleFor(parsed.prepared.title, parsed.idempotencyKey),
          question: parsed.prepared.question,
          mode: parsed.prepared.mode,
          ...(parsed.prepared.schedule ? { schedule: parsed.prepared.schedule } : {}),
          researchArea: parsed.prepared.researchArea,
          competitors: parsed.prepared.competitors,
          investigationAreas: parsed.prepared.investigationAreas,
          idempotencyKey: parsed.idempotencyKey,
        },
        { listActive, createKeyed, findCreatedByKey: seams.watchProjects?.findCreatedByKey },
      );
      if (created.outcome === "duplicate") {
        return created;
      }
      if (seams.links) {
        const links = watchChoiceLinksSchema.parse(parsed.existingLinks ?? {});
        await seams.links.setThreadLinks({
          organizationId: parsed.organizationId,
          actorId: parsed.actorId,
          threadId: parsed.threadId,
          projectId: created.projectId,
          ...links,
        });
      }
      return {
        outcome: created.outcome,
        projectId: created.projectId,
        replayed: created.replayed,
        scopeFingerprint: created.scopeFingerprint,
        link: created.link,
        assumptions: parsed.assumptions,
        evidenceWindowDays: WATCH_EVIDENCE_WINDOW_DAYS,
      };
    }
    case "update_fields": {
      if (!parsed.candidateProjectId) {
        return {
          outcome: "update_blocked",
          projectId: null,
          reasonCode: "WATCH_UPDATE_NO_CANDIDATE",
          copy: "No matching active watch was found — it may have been archived.",
        };
      }
      const readProject = seams.watchProjects?.readProject;
      const readBrief = seams.watchProjects?.readBrief;
      const [project, brief] = await Promise.all([
        readProject?.({
          organizationId: parsed.organizationId,
          projectId: parsed.candidateProjectId,
        }) ?? null,
        readBrief?.({
          organizationId: parsed.organizationId,
          projectId: parsed.candidateProjectId,
        }) ?? null,
      ]);
      if (!project || !brief) {
        return {
          outcome: "update_blocked",
          projectId: parsed.candidateProjectId,
          reasonCode: "WATCH_UPDATE_UNREADABLE",
          copy: "This watch could not be loaded; nothing was changed.",
        };
      }
      const cardEdits = watchCardEditsSchema.parse(parsed.cardEdits ?? {});
      const edits: WatchUpdateEdits = {
        ...(cardEdits.frequency ? { frequency: cardEdits.frequency } : {}),
        ...(cardEdits.endDate !== undefined ? { endDate: cardEdits.endDate } : {}),
        ...(cardEdits.branchId ? { branchId: cardEdits.branchId } : {}),
        ...(cardEdits.researchArea ? { researchArea: cardEdits.researchArea } : {}),
        ...(cardEdits.competitorName
          ? { competitors: [{ name: cardEdits.competitorName, source: "operator_lead" as const }] }
          : {}),
      };
      const updateWatch = seams.watchProjects?.updateWatch;
      const result = await executeWatchUpdate(
        {
          organizationId: parsed.organizationId,
          actorId: parsed.actorId,
          projectId: parsed.candidateProjectId,
          project,
          brief,
          edits,
          idempotencyKey: parsed.idempotencyKey,
        },
        updateWatch ? { updateWatch } : {},
      );
      if (result.outcome === "profile_scope_change") {
        return result;
      }
      if (result.outcome === "update_blocked") {
        return {
          outcome: "update_blocked",
          projectId: result.projectId,
          reasonCode: result.reasonCode,
          copy: result.copy,
        };
      }
      if (seams.links) {
        const links = watchChoiceLinksSchema.parse(parsed.existingLinks ?? {});
        await seams.links.setThreadLinks({
          organizationId: parsed.organizationId,
          actorId: parsed.actorId,
          threadId: parsed.threadId,
          projectId: result.projectId,
          ...links,
        });
      }
      return {
        outcome: "updated",
        projectId: result.projectId,
        revisionNumber: result.revisionNumber,
        replayed: result.replayed,
        appliedFields: result.appliedFields,
        scopeFingerprint: result.scopeFingerprint,
        link: giResearchLink(parsed.organizationId, { projectId: result.projectId }),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Prepared create behind a missing-fields submit (no duplicate prelude)
// ---------------------------------------------------------------------------

const createPreparedWatchInputSchema = z
  .object({
    organizationId: z.string().uuid(),
    actorId: z.string().trim().min(1).max(200),
    threadId: z.string().trim().min(1).max(200),
    idempotencyKey: z.string().trim().min(16).max(200),
    /** Caller-derived grants, never client claims — the route recomputes these from the role. */
    permissions: z.array(z.string().trim().min(1).max(120)).default([]),
    prepared: preparedWatchPayloadSchema,
    assumptions: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
    existingLinks: watchChoiceLinksSchema.optional(),
  })
  .strict();

export type CreatePreparedWatchInput = z.input<typeof createPreparedWatchInputSchema>;

export type CreatePreparedWatchSeams = {
  watchProjects: Pick<NonNullable<WatchChoiceSeams["watchProjects"]>, "listActive" | "createKeyed" | "findCreatedByKey">;
  links?: WatchChoiceSeams["links"];
};

export type CreatePreparedWatchOutcome = Extract<
  WatchChoiceOutcome,
  { outcome: "blocked" | "created" | "replayed" | "duplicate" }
>;

/**
 * The tap needs more before anything can run: pre-fill could not bind the
 * question, branch, or research area, and none of the three is ever
 * invented. The drawer renders the copy and the missing fields; the
 * operator answers with a message and the next card taps through.
 */
export type WatchNeedsInput = {
  outcome: "needs_input";
  missing: Array<"question" | "branch" | "researchArea">;
  copy: string;
};

/** Everything the answers route may return behind a watch tap. */
export type WatchTapOutcome = WatchChoiceOutcome | WatchNeedsInput;

/**
 * Creates a prepared watch behind a single missing-fields submit. A twin
 * (or same-fingerprint sibling) converges to the duplicate card instead
 * of forking — the drawer's tap surface stays the duplicate choice, and
 * the returned card carries the live candidates.
 */
export async function createPreparedWatch(
  input: CreatePreparedWatchInput,
  seams: CreatePreparedWatchSeams,
): Promise<CreatePreparedWatchOutcome> {
  const parsed = createPreparedWatchInputSchema.parse(input);
  if (!parsed.permissions.includes("growth_intelligence.manage")) {
    return {
      outcome: "blocked",
      reasonCode: "WATCH_REQUIRES_MANAGE",
      copy: "Watch changes need the growth_intelligence.manage grant.",
    };
  }
  const listActive = seams.watchProjects.listActive;
  const createKeyed = seams.watchProjects.createKeyed;
  if (!listActive || !createKeyed) {
    throw new DomainError("DOMAIN_ERROR", "Watch dispatch is not wired for this chat.");
  }
  const created = await executeWatchCreate(
    {
      organizationId: parsed.organizationId,
      actorId: parsed.actorId,
      branchId: parsed.prepared.branchId,
      title: parsed.prepared.title,
      question: parsed.prepared.question,
      mode: parsed.prepared.mode,
      ...(parsed.prepared.schedule ? { schedule: parsed.prepared.schedule } : {}),
      researchArea: parsed.prepared.researchArea,
      competitors: parsed.prepared.competitors,
      investigationAreas: parsed.prepared.investigationAreas,
      idempotencyKey: parsed.idempotencyKey,
    },
    { listActive, createKeyed, findCreatedByKey: seams.watchProjects.findCreatedByKey },
  );
  if (created.outcome === "duplicate") {
    return created;
  }
  if (seams.links) {
    const links = watchChoiceLinksSchema.parse(parsed.existingLinks ?? {});
    await seams.links.setThreadLinks({
      organizationId: parsed.organizationId,
      actorId: parsed.actorId,
      threadId: parsed.threadId,
      projectId: created.projectId,
      ...links,
    });
  }
  return {
    outcome: created.outcome,
    projectId: created.projectId,
    replayed: created.replayed,
    scopeFingerprint: created.scopeFingerprint,
    link: created.link,
    assumptions: parsed.assumptions,
    evidenceWindowDays: WATCH_EVIDENCE_WINDOW_DAYS,
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
