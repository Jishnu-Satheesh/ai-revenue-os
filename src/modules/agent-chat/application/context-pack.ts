import { z } from "zod";

import { DomainError } from "@/lib/errors";

/**
 * Deterministic HEAVY organization context pack (spec section 9).
 *
 * Pure assembly over injected readers — no provider calls, no live web
 * calls, no randomness, no `node:crypto` (this module stays
 * client-importable, like Task 3's placeholder). The readers are the seam
 * where the real services plug in:
 *
 * - identity lane: Digital Twin / organization module profile + confirmed
 *   facts (see `src/modules/memory/application/fact-projection.ts` and
 *   `src/modules/organizations/`).
 * - goals lane: goals / constraints / policies routes.
 * - evidence lane: governed ledger readers (`src/modules/economics/`
 *   ledger + growth-progress) over exact 30/60-day ranges.
 * - marketProfile lane: Market Profile current version + digest
 *   (`src/modules/growth-intelligence/application/profile-service.ts`,
 *   `profile-repository`, `profile-digest`).
 * - memory lane: memory search / timeline routes
 *   (`src/modules/memory/application/api-schemas.ts` search + timeline).
 * - economics lane: economics-readiness route
 *   (`src/modules/economics/application/readiness-service.ts`).
 * - timeline lane: GI read-service / market-watch
 *   (`src/modules/growth-intelligence/application/read-service.ts`).
 *
 * Rules honored here: oversized input refuses with a safe code and is never
 * silently trimmed; missing evidence periods are gaps, never zeros; identity
 * facts sort verified-first; economics carries an availability/quality tier
 * only (never workbook amounts); timeline entries keep activity vs evidence
 * dates distinct; windows are exact ranges labeled in the branch timezone;
 * every reader call carries the server-owned organization id.
 */

/** Refusal budget: packs (or probed inputs) above this refuse, never trim. */
export const MAX_CONTEXT_PACK_BYTES = 1_000_000;

/** Safe reason code for oversize refusal (matches router reason-code shape). */
export const CONTEXT_PACK_OVERSIZED = "CONTEXT_PACK_OVERSIZED";

const WINDOW_DAYS = [30, 60] as const;

export const contextPackInputSchema = z
  .object({
    organizationId: z.string().trim().min(1).max(200),
    userId: z.string().trim().min(1).max(200),
    branchId: z.string().trim().min(1).max(200).optional(),
    windowDays: z.union([z.literal(30), z.literal(60)]),
    page: z.preprocess(
      (value) => (typeof value === "string" ? value.trim() : value),
      z.string().min(1).max(120),
    ),
  })
  .passthrough();

const identityFactSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    statement: z.string().trim().min(1).max(2000),
    verified: z.boolean(),
    source: z.string().trim().min(1).max(200),
  })
  .strict();

const goalRowSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(280),
    status: z.string().trim().min(1).max(80),
  })
  .strict();

const evidencePeriodSchema = z
  .object({
    periodStartUtc: z.string().trim().min(1).max(80),
    periodEndUtc: z.string().trim().min(1).max(80),
    status: z.enum(["covered", "gap"]),
    /** Minor units with ISO currency when covered; null when gap — never 0. */
    valueMinorUnits: z.number().int().nullable(),
    currency: z.string().trim().min(1).max(8).optional(),
  })
  .strict();

const marketProfileSchema = z.union([
  z
    .object({
      status: z.literal("current"),
      versionId: z.string().trim().min(1).max(200),
      digest: z.string().trim().min(1).max(256),
      niche: z.string().trim().max(280).optional(),
    })
    .strict(),
  z.object({ status: z.literal("missing") }).strict(),
]);

const memoryHitSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    provenance: z.string().trim().min(1).max(200),
    recordedAt: z.string().trim().min(1).max(80),
  })
  .strict();

const economicsSchema = z.object({
  availability: z.enum(["ready", "partial", "unavailable", "unknown"]),
  quality: z.enum(["high", "medium", "low", "unknown"]),
});

const timelineEntrySchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    kind: z.enum(["decision", "approval", "execution", "outcome"]),
    activityAt: z.string().trim().min(1).max(80),
    evidenceAt: z.string().trim().min(1).max(80),
  })
  .strict();

const evidenceWindowSchema = z
  .object({
    windowDays: z.union([z.literal(30), z.literal(60)]),
    startUtc: z.string().trim().min(1).max(80),
    endUtc: z.string().trim().min(1).max(80),
    branchTimezone: z.string().trim().min(1).max(120),
    branchStartLabel: z.string().trim().min(1).max(120),
    branchEndLabel: z.string().trim().min(1).max(120),
  })
  .strict();

export const contextPackSchema = z
  .object({
    organizationId: z.string().trim().min(1).max(200),
    userId: z.string().trim().min(1).max(200),
    branchId: z.string().trim().min(1).max(200).optional(),
    windowDays: z.union([z.literal(30), z.literal(60)]),
    page: z.string().trim().min(1).max(120),
    /** 16-hex stable digest; same format as Task 3's placeholder. */
    digest: z.string().regex(/^[0-9a-f]{16}$/),
    /** Cited ids only — never customer data. */
    sources: z.array(z.string().trim().min(1).max(200)).max(400),
    limitations: z.array(z.string().trim().min(1).max(280)).max(60),
    refused: z.boolean(),
    reasonCode: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9_]{2,80}$/)
      .optional(),
    window: evidenceWindowSchema,
    lanes: z
      .object({
        identity: z.object({ facts: z.array(identityFactSchema).max(200) }).strict(),
        goals: z
          .object({
            goals: z.array(goalRowSchema).max(100),
            constraints: z.array(z.string().trim().min(1).max(280)).max(100),
            policies: z.array(z.string().trim().min(1).max(280)).max(100),
            capabilityBlocks: z.array(z.string().trim().min(1).max(280)).max(100),
          })
          .strict(),
        evidence: z.object({ periods: z.array(evidencePeriodSchema).max(120) }).strict(),
        marketProfile: marketProfileSchema,
        memory: z.object({ hits: z.array(memoryHitSchema).max(100) }).strict(),
        economics: economicsSchema,
        timeline: z.object({ entries: z.array(timelineEntrySchema).max(200) }).strict(),
        page: z
          .object({
            key: z.string().trim().min(1).max(120),
            organizationId: z.string().trim().min(1).max(200),
            branchId: z.string().trim().min(1).max(200).optional(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type ContextPack = z.infer<typeof contextPackSchema>;

export type ContextPackScope = {
  organizationId: string;
  userId: string;
  branchId?: string;
  windowDays: 30 | 60;
  page: string;
};

/**
 * Reader seam. Every function receives the server-owned organization id —
 * tenant scope is never inferred from user-controlled input. All entries
 * are optional: an unbound lane reports an honest gap with a limitation
 * instead of inventing data. `load` is the oversize probe the brief's
 * refusal test exercises.
 */
export type ContextPackReaders = {
  load?: (scope: ContextPackScope) => Promise<unknown>;
  resolveBranchTimezone?: (scope: {
    organizationId: string;
    branchId?: string;
  }) => Promise<string | null | undefined> | string | null | undefined;
  getIdentityFacts?: (scope: { organizationId: string }) => Promise<unknown>;
  getGoals?: (scope: { organizationId: string }) => Promise<unknown>;
  getEvidence?: (scope: {
    organizationId: string;
    branchId?: string;
    startUtc: string;
    endUtc: string;
    windowDays: 30 | 60;
  }) => Promise<unknown>;
  getMarketProfile?: (scope: { organizationId: string }) => Promise<unknown>;
  searchMemory?: (scope: { organizationId: string; userId: string }) => Promise<unknown>;
  getEconomicsReadiness?: (scope: { organizationId: string }) => Promise<unknown>;
  getTimeline?: (scope: {
    organizationId: string;
    startUtc: string;
    endUtc: string;
  }) => Promise<unknown>;
};

export type BuildAgentContextPackInput = ContextPackScope & {
  readers?: ContextPackReaders;
  /** Injectable clock for deterministic windows; defaults to now (UTC). */
  now?: Date | string;
};

/**
 * Same pure-arithmetic 16-hex digest as Task 3's `routingContextDigest`
 * (copied, not imported, so this module stays client-importable and avoids
 * a thread-service cycle). Format-compatible by construction:
 * `/^[0-9a-f]{16}$/`.
 */
function stable16Hex(text: string): string {
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

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function probeBytes(probe: unknown): number | null {
  if (typeof probe !== "object" || probe === null) return null;
  const record = probe as Record<string, unknown>;
  for (const key of ["bytes", "byteLength", "size"]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function resolveNow(now: Date | string | undefined): Date {
  if (now === undefined) return new Date();
  const resolved = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(resolved.getTime())) {
    throw new DomainError("VALIDATION_ERROR", "Please check the submitted fields.");
  }
  return resolved;
}

function resolveBranchTimezone(raw: string | null | undefined): {
  timezone: string;
  fallback: boolean;
} {
  if (typeof raw === "string" && raw.trim().length > 0) {
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: raw.trim() }).format(new Date());
      return { timezone: raw.trim(), fallback: false };
    } catch {
      return { timezone: "UTC", fallback: true };
    }
  }
  return { timezone: "UTC", fallback: raw !== undefined && raw !== null };
}

function branchLabel(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (
    value !== null &&
    typeof value === "object" &&
    Array.isArray((value as { rows?: unknown }).rows)
  ) {
    return (value as { rows: unknown[] }).rows;
  }
  if (
    value !== null &&
    typeof value === "object" &&
    Array.isArray((value as { items?: unknown }).items)
  ) {
    return (value as { items: unknown[] }).items;
  }
  return [];
}

async function settle<T>(run: () => Promise<T> | T): Promise<{ value: T | null }> {
  try {
    return { value: await run() };
  } catch {
    return { value: null };
  }
}

type LaneFacts = z.infer<typeof identityFactSchema>;
type LaneGoal = z.infer<typeof goalRowSchema>;
type LanePeriod = z.infer<typeof evidencePeriodSchema>;
type LaneHit = z.infer<typeof memoryHitSchema>;
type LaneEntry = z.infer<typeof timelineEntrySchema>;

function emptyLanes(): ContextPack["lanes"] {
  return {
    identity: { facts: [] },
    goals: { goals: [], constraints: [], policies: [], capabilityBlocks: [] },
    evidence: { periods: [] },
    marketProfile: { status: "missing" },
    memory: { hits: [] },
    economics: { availability: "unknown", quality: "unknown" },
    timeline: { entries: [] },
    page: { key: "overview", organizationId: "" },
  };
}

function refusedPack(args: {
  scope: ContextPackScope;
  window: ContextPack["window"];
  limitations: string[];
}): ContextPack {
  const lanes = emptyLanes();
  lanes.page = {
    key: args.scope.page,
    organizationId: args.scope.organizationId,
    ...(args.scope.branchId ? { branchId: args.scope.branchId } : {}),
  };
  const unsigned = {
    organizationId: args.scope.organizationId,
    userId: args.scope.userId,
    ...(args.scope.branchId ? { branchId: args.scope.branchId } : {}),
    windowDays: args.scope.windowDays,
    page: args.scope.page,
    digest: "0000000000000000",
    sources: [],
    limitations: args.limitations.slice(0, 60),
    refused: true,
    reasonCode: CONTEXT_PACK_OVERSIZED,
    window: args.window,
    lanes,
  };
  const digest = stable16Hex(canonicalize({ ...unsigned, digest: undefined }));
  return contextPackSchema.parse({ ...unsigned, digest });
}

/**
 * Builds the deterministic HEAVY organization context pack: seven evidence
 * lanes plus page context, digested for the router note and answer
 * citations. Read-only; never a live web call. Oversized packs refuse with
 * `CONTEXT_PACK_OVERSIZED` instead of trimming.
 */
export async function buildAgentContextPack(
  input: BuildAgentContextPackInput,
): Promise<ContextPack> {
  let scope: ContextPackScope;
  try {
    const parsed = contextPackInputSchema.parse(input);
    scope = {
      organizationId: parsed.organizationId,
      userId: parsed.userId,
      ...(parsed.branchId ? { branchId: parsed.branchId } : {}),
      windowDays: parsed.windowDays,
      page: parsed.page,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new DomainError("VALIDATION_ERROR", "Please check the submitted fields.", error);
    }
    throw error;
  }
  if (!WINDOW_DAYS.includes(scope.windowDays)) {
    throw new DomainError("VALIDATION_ERROR", "Please check the submitted fields.");
  }

  const readers = input.readers ?? {};
  const now = resolveNow(input.now);
  const endUtc = now.toISOString();
  const startUtc = new Date(now.getTime() - scope.windowDays * 86_400_000).toISOString();

  const timezoneScope = {
    organizationId: scope.organizationId,
    ...(scope.branchId ? { branchId: scope.branchId } : {}),
  };
  const rawTimezone = readers.resolveBranchTimezone
    ? await (async () => {
        try {
          return { value: await readers.resolveBranchTimezone!(timezoneScope), failed: false };
        } catch {
          // A throwing timezone reader is a failure, not an absence: the
          // flag below preserves it through normalization so the pack still
          // reports the UTC fallback honestly (Task 6 ruling).
          return { value: null, failed: true };
        }
      })()
    : { value: "UTC", failed: false };
  const { timezone, fallback } = resolveBranchTimezone(rawTimezone.value ?? "UTC");
  const timezoneFallback = fallback || rawTimezone.failed;
  const window: ContextPack["window"] = {
    windowDays: scope.windowDays,
    startUtc,
    endUtc,
    branchTimezone: timezone,
    branchStartLabel: branchLabel(new Date(startUtc), timezone),
    branchEndLabel: branchLabel(new Date(endUtc), timezone),
  };

  // Oversize probe first: the caller (or a size-aware reader) can refuse
  // before any lane work happens. Refuse — never trim.
  if (readers.load) {
    try {
      const probe = await readers.load(scope);
      const bytes = probeBytes(probe);
      if (bytes !== null && bytes > MAX_CONTEXT_PACK_BYTES) {
        return refusedPack({
          scope,
          window,
          limitations: [
            `Context pack refused: input measures ${bytes} bytes, above the ${MAX_CONTEXT_PACK_BYTES}-byte budget (${CONTEXT_PACK_OVERSIZED}). Narrow the evidence window and retry.`,
          ],
        });
      }
    } catch {
      // A failing probe must not refuse the pack on its own; lanes below
      // still report their own honest gaps.
    }
  }

  const limitations: string[] = [];
  if (timezoneFallback) {
    limitations.push("Branch timezone unavailable; evidence window labels render in UTC.");
  }

  const lanes = emptyLanes();
  lanes.page = {
    key: scope.page,
    organizationId: scope.organizationId,
    ...(scope.branchId ? { branchId: scope.branchId } : {}),
  };
  const sources: string[] = [];
  const cite = (id: string) => {
    const trimmed = id.trim();
    if (trimmed.length > 0 && !sources.includes(trimmed)) sources.push(trimmed);
  };

  // Lane 1 — business identity: verified facts first, stable id order after.
  if (readers.getIdentityFacts) {
    const getIdentityFacts = readers.getIdentityFacts;
    const { value } = await settle(() =>
      getIdentityFacts({ organizationId: scope.organizationId }),
    );
    if (value === null) {
      limitations.push("Business identity unavailable; answers carry no confirmed facts.");
    } else {
      const rows = toArray(value);
      const facts: LaneFacts[] = [];
      let dropped = 0;
      for (const row of rows) {
        const parsed = identityFactSchema.safeParse(row);
        if (parsed.success) facts.push(parsed.data);
        else dropped += 1;
      }
      facts.sort((left, right) => {
        if (left.verified !== right.verified) return left.verified ? -1 : 1;
        return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
      });
      lanes.identity = { facts };
      for (const fact of facts) cite(fact.id);
      if (dropped > 0) limitations.push(`Business identity skipped ${dropped} invalid fact(s).`);
      if (facts.length === 0)
        limitations.push("No confirmed business facts; answers stay generic.");
    }
  } else {
    limitations.push("No confirmed business facts; answers stay generic.");
  }

  // Lane 2 — goals / constraints / policies.
  if (readers.getGoals) {
    const getGoals = readers.getGoals;
    const { value } = await settle(() => getGoals({ organizationId: scope.organizationId }));
    if (value === null) {
      limitations.push("Goals unavailable; advice cannot weigh active targets.");
    } else {
      const record = (value ?? {}) as Record<string, unknown>;
      const goals: LaneGoal[] = [];
      let dropped = 0;
      for (const row of toArray(record["goals"] ?? value)) {
        const parsed = goalRowSchema.safeParse(row);
        if (parsed.success) goals.push(parsed.data);
        else dropped += 1;
      }
      const strings = (key: string): string[] => {
        const raw = toArray(record[key]);
        return raw
          .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
          .map((entry) => entry.trim().slice(0, 280));
      };
      lanes.goals = {
        goals,
        constraints: strings("constraints"),
        policies: strings("policies"),
        capabilityBlocks: strings("capabilityBlocks"),
      };
      for (const goal of goals) cite(goal.id);
      if (dropped > 0) limitations.push(`Goals skipped ${dropped} invalid row(s).`);
      if (goals.length === 0) limitations.push("No active goals; advice cannot weigh targets.");
    }
  } else {
    limitations.push("No active goals; advice cannot weigh targets.");
  }

  // Lane 3 — governed evidence over the exact window. Missing coverage is a
  // gap entry (value null), never a zero.
  if (readers.getEvidence) {
    const getEvidence = readers.getEvidence;
    const { value } = await settle(() =>
      getEvidence({
        organizationId: scope.organizationId,
        ...(scope.branchId ? { branchId: scope.branchId } : {}),
        startUtc,
        endUtc,
        windowDays: scope.windowDays,
      }),
    );
    if (value === null) {
      limitations.push("Governed evidence unavailable for this window; the period is a gap.");
      lanes.evidence = {
        periods: [
          { periodStartUtc: startUtc, periodEndUtc: endUtc, status: "gap", valueMinorUnits: null },
        ],
      };
    } else {
      const periods: LanePeriod[] = [];
      let dropped = 0;
      for (const row of toArray(value)) {
        const parsed = evidencePeriodSchema.safeParse(row);
        if (!parsed.success) {
          dropped += 1;
          continue;
        }
        if (parsed.data.status === "gap" && parsed.data.valueMinorUnits !== null) {
          dropped += 1;
          continue;
        }
        periods.push(parsed.data);
      }
      periods.sort((left, right) =>
        left.periodStartUtc < right.periodStartUtc
          ? -1
          : left.periodStartUtc > right.periodStartUtc
            ? 1
            : 0,
      );
      lanes.evidence = {
        periods:
          periods.length > 0
            ? periods
            : [
                {
                  periodStartUtc: startUtc,
                  periodEndUtc: endUtc,
                  status: "gap",
                  valueMinorUnits: null,
                },
              ],
      };
      if (dropped > 0) limitations.push(`Evidence skipped ${dropped} invalid period(s).`);
      if (periods.length === 0) {
        limitations.push("Governed evidence unavailable for this window; the period is a gap.");
      } else if (periods.some((period) => period.status === "gap")) {
        limitations.push(
          "Evidence has uncovered periods; gaps are shown, never filled with zeros.",
        );
      }
    }
  } else {
    lanes.evidence = {
      periods: [
        { periodStartUtc: startUtc, periodEndUtc: endUtc, status: "gap", valueMinorUnits: null },
      ],
    };
    limitations.push("Governed evidence unavailable for this window; the period is a gap.");
  }

  // Lane 4 — Market Profile current version + digest.
  if (readers.getMarketProfile) {
    const getMarketProfile = readers.getMarketProfile;
    const { value } = await settle(() =>
      getMarketProfile({ organizationId: scope.organizationId }),
    );
    if (value === null) {
      limitations.push("Market Profile unavailable; scoped research cannot bind a version.");
    } else {
      const parsed = marketProfileSchema.safeParse(value);
      if (!parsed.success) {
        limitations.push("Market Profile unavailable; scoped research cannot bind a version.");
        lanes.marketProfile = { status: "missing" };
      } else {
        lanes.marketProfile = parsed.data;
        if (parsed.data.status === "current") {
          cite(parsed.data.versionId);
        } else {
          limitations.push(
            "No current Market Profile version; scoped research cannot bind a version.",
          );
        }
      }
    }
  } else {
    limitations.push("No current Market Profile version; scoped research cannot bind a version.");
  }

  // Lane 5 — memory hits with provenance + freshness.
  if (readers.searchMemory) {
    const searchMemory = readers.searchMemory;
    const { value } = await settle(() =>
      searchMemory({ organizationId: scope.organizationId, userId: scope.userId }),
    );
    if (value === null) {
      limitations.push("Memory search unavailable; answers use pack facts only.");
    } else {
      const hits: LaneHit[] = [];
      let dropped = 0;
      for (const row of toArray(value)) {
        const parsed = memoryHitSchema.safeParse(row);
        if (parsed.success) hits.push(parsed.data);
        else dropped += 1;
      }
      hits.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
      lanes.memory = { hits };
      for (const hit of hits) cite(hit.id);
      if (dropped > 0) limitations.push(`Memory skipped ${dropped} invalid hit(s).`);
      if (hits.length === 0) limitations.push("No memory hits; answers use pack facts only.");
    }
  } else {
    limitations.push("No memory hits; answers use pack facts only.");
  }

  // Lane 6 — economics readiness: availability/quality tier only. Workbook
  // amounts never enter the pack, even if a reader returns them.
  if (readers.getEconomicsReadiness) {
    const getEconomicsReadiness = readers.getEconomicsReadiness;
    const { value } = await settle(() =>
      getEconomicsReadiness({ organizationId: scope.organizationId }),
    );
    if (value === null) {
      limitations.push("Economics readiness unknown; cost claims stay withheld.");
    } else {
      const parsed = economicsSchema.safeParse(
        value !== null &&
          typeof value === "object" &&
          "readiness" in (value as Record<string, unknown>)
          ? (value as Record<string, unknown>)["readiness"]
          : value,
      );
      if (!parsed.success) {
        limitations.push("Economics readiness unknown; cost claims stay withheld.");
        lanes.economics = { availability: "unknown", quality: "unknown" };
      } else {
        lanes.economics = parsed.data;
        if (parsed.data.availability !== "ready") {
          limitations.push("Economics data not ready; cost claims stay withheld.");
        }
      }
    }
  } else {
    limitations.push("Economics data not ready; cost claims stay withheld.");
  }

  // Lane 7 — recent timeline: activity vs evidence dates stay distinct.
  if (readers.getTimeline) {
    const getTimeline = readers.getTimeline;
    const { value } = await settle(() =>
      getTimeline({ organizationId: scope.organizationId, startUtc, endUtc }),
    );
    if (value === null) {
      limitations.push("Recent timeline unavailable; lineage notes stay partial.");
    } else {
      const entries: LaneEntry[] = [];
      let dropped = 0;
      for (const row of toArray(value)) {
        const parsed = timelineEntrySchema.safeParse(row);
        if (parsed.success) entries.push(parsed.data);
        else dropped += 1;
      }
      entries.sort((left, right) =>
        left.activityAt < right.activityAt ? -1 : left.activityAt > right.activityAt ? 1 : 0,
      );
      lanes.timeline = { entries };
      for (const entry of entries) cite(entry.id);
      if (dropped > 0) limitations.push(`Timeline skipped ${dropped} invalid row(s).`);
      if (entries.length === 0) limitations.push("No timeline entries in this window.");
    }
  } else {
    limitations.push("No timeline entries in this window.");
  }

  // Lane overflow refuses like byte overflow: caps mirror
  // `contextPackSchema`, and breaching one means the reader returned more
  // than the pack may carry. Refuse — never trim.
  const laneOverflow =
    lanes.identity.facts.length > 200 ||
    lanes.goals.goals.length > 100 ||
    lanes.goals.constraints.length > 100 ||
    lanes.goals.policies.length > 100 ||
    lanes.goals.capabilityBlocks.length > 100 ||
    lanes.evidence.periods.length > 120 ||
    lanes.memory.hits.length > 100 ||
    lanes.timeline.entries.length > 200;
  if (laneOverflow || sources.length > 400 || limitations.length > 60) {
    return refusedPack({
      scope,
      window,
      limitations: [
        `Context pack refused: lane output exceeds the pack budget (${CONTEXT_PACK_OVERSIZED}). Narrow the evidence window and retry.`,
      ],
    });
  }

  const unsigned = {
    organizationId: scope.organizationId,
    userId: scope.userId,
    ...(scope.branchId ? { branchId: scope.branchId } : {}),
    windowDays: scope.windowDays,
    page: scope.page,
    digest: "0000000000000000",
    sources: [...sources].sort(),
    limitations: [...limitations],
    refused: false,
    window,
    lanes,
  };

  // Final budget check on the assembled pack: refuse, never trim.
  const canonical = canonicalize({ ...unsigned, digest: undefined });
  if (byteLength(canonical) > MAX_CONTEXT_PACK_BYTES) {
    return refusedPack({
      scope,
      window,
      limitations: [
        `Context pack refused: assembled pack exceeds the ${MAX_CONTEXT_PACK_BYTES}-byte budget (${CONTEXT_PACK_OVERSIZED}). Narrow the evidence window and retry.`,
      ],
    });
  }

  const digest = stable16Hex(canonical);
  return contextPackSchema.parse({ ...unsigned, digest });
}
