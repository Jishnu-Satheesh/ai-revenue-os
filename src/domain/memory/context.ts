import { z } from "zod";

/**
 * Governed context-pack vocabulary (Spec 023 §§7/9/10). Pure module: no I/O,
 * no clock, no randomness, no node imports. The migration
 * `business_memory_context_manifests` is the authority for every value below;
 * a value added here must be added there in the same change.
 *
 * Byte/count enforcement lives in BOTH the finalization RPC (SQL) and the TS
 * assembler in `src/modules/memory`. Either layer alone invites drift; the
 * constants below mirror the SQL checks exactly and both sides carry tests.
 */

/** SQL: schema_version default 1 check (=1). */
export const CONTEXT_SCHEMA_VERSION = 1 as const;

/** SQL: policy_version default 'shared-context-v1', 1–60 chars. */
export const CONTEXT_POLICY_VERSION_DEFAULT = "shared-context-v1" as const;

/** SQL: pack cap, 24 entries. */
export const CONTEXT_MAX_ENTRIES = 24 as const;

/** SQL: pack cap, 16384 UTF-8 bytes over raw summaries. */
export const CONTEXT_MAX_BYTES = 16_384 as const;

/** SQL: per-summary cap, 600 characters (not bytes). */
export const CONTEXT_SUMMARY_MAX_CHARS = 600 as const;

/** SQL: root_refs cardinality <= 100. */
export const CONTEXT_MAX_ROOTS = 100 as const;

/** Spec §7 step 5: at most 50 eligible candidates per memory section. */
export const CONTEXT_SECTION_CANDIDATE_LIMIT = 50 as const;

/** Spec §7 step 5: maximum slots per section. */
export const CONTEXT_SECTION_BUDGETS = {
  current: 6,
  intent: 6,
  observations: 8,
  lessons: 4,
} as const;

export type ContextSection = keyof typeof CONTEXT_SECTION_BUDGETS;

/** Spec §7 step 5: at most 3 unverified AI-generated entries in observations. */
export const CONTEXT_OBSERVATIONS_AI_CAP = 3 as const;

export const contextPurposes = [
  "channel_advice",
  "growth_research",
  "growth_synthesis",
  "campaign_generation",
  "campaign_revision",
  "subject_drafting",
] as const;

export type ContextPurpose = (typeof contextPurposes)[number];

export const contextStatuses = ["ready", "empty", "partial", "unavailable", "disabled"] as const;

export type ContextStatus = (typeof contextStatuses)[number];

export const contextManifestStates = ["prepared", "consumed", "abandoned"] as const;

export type ContextManifestState = (typeof contextManifestStates)[number];

/** Typed consumer binding. Exactly one is set per manifest (SQL check). */
export const contextConsumerKinds = [
  "analysis_run",
  "growth_request",
  "campaign_generation_run",
  "subject_operation",
] as const;

export type ContextConsumerKind = (typeof contextConsumerKinds)[number];

/** Typed source slots on entries. Exactly one primary slot is set (SQL check). */
export const contextSourceKinds = [
  "memory_item",
  "capture_event",
  "business_fact",
  "business_profile",
  "goal",
  "constraint",
  "campaign_version",
] as const;

export type ContextSourceKind = (typeof contextSourceKinds)[number];

/** Statement kinds permitted on entries. `legacy` never enters a pack. */
export const contextStatementKinds = [
  "observation",
  "recommendation",
  "operator_decision",
  "campaign_state",
  "measured_outcome",
  "lesson",
] as const;

export type ContextStatementKind = (typeof contextStatementKinds)[number];

/** Safe exclusion codes recorded in exclusion_counts, never raw reasons. */
export const contextExclusionCodes = [
  "RIGHTS_DENIED",
  "SENSITIVITY_BLOCKED",
  "EXPIRED",
  "SUPERSEDED",
  "WITHDRAWN",
  "SCOPE_BLOCKED",
  "DUPLICATE_ROOT",
  "OVER_BUDGET",
  "INVALID_SUMMARY",
  "UNKNOWN_SOURCE",
  "MANDATORY_OVERFLOW",
] as const;

export type ContextExclusionCode = (typeof contextExclusionCodes)[number];

/** Worker consumer kind must match its purpose (SQL enforces the same map). */
export const contextPurposeByConsumerKind: Readonly<Record<string, readonly ContextPurpose[]>> = {
  analysis_run: ["channel_advice"],
  growth_request: ["growth_research", "growth_synthesis"],
  campaign_generation_run: ["campaign_generation", "campaign_revision"],
  subject_operation: ["subject_drafting"],
};

export function purposesForConsumerKind(kind: ContextConsumerKind): readonly ContextPurpose[] {
  return contextPurposeByConsumerKind[kind] ?? [];
}

// Zod shapes (mirror the SQL vocabularies exactly) -------------------------------

export const contextPurposeSchema = z.enum(contextPurposes);
export const contextStatusSchema = z.enum(contextStatuses);
export const contextConsumerKindSchema = z.enum(contextConsumerKinds);
export const contextSourceKindSchema = z.enum(contextSourceKinds);
export const contextStatementKindSchema = z.enum(contextStatementKinds);
export const contextSectionSchema = z.enum(["current", "intent", "observations", "lessons"]);
export const contextExclusionCodeSchema = z.enum(contextExclusionCodes);

export const contextRequestSchema = z
  .object({
    organizationId: z.string().uuid(),
    branchId: z.string().uuid().optional(),
    channelId: z.string().uuid().optional(),
    campaignId: z.string().uuid().optional(),
    purpose: contextPurposeSchema,
    consumerKind: contextConsumerKindSchema,
    consumerId: z.string().uuid(),
    attemptKey: z.string().trim().min(1).max(200),
    correlationId: z.string().uuid(),
    query: z.string().trim().min(1).max(500),
    policyVersion: z.string().trim().min(1).max(60).default(CONTEXT_POLICY_VERSION_DEFAULT),
  })
  .strict()
  .refine(
    (request) => purposesForConsumerKind(request.consumerKind).includes(request.purpose),
    { message: "consumer kind does not serve that purpose" },
  );

export type ContextRequestInput = z.input<typeof contextRequestSchema>;
export type ContextRequest = z.output<typeof contextRequestSchema>;

export const contextEntrySchema = z
  .object({
    contextRef: z.string().trim().min(1).max(60),
    sourceKind: contextSourceKindSchema,
    sourceId: z.string().uuid(),
    sourceRevision: z.number().int().min(1).nullable(),
    sourceDigest: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    section: contextSectionSchema,
    statementKind: contextStatementKindSchema,
    title: z.string().trim().min(1).max(300),
    summary: z.string().max(4_096),
    scopeBranchId: z.string().uuid().nullable(),
    scopeChannelId: z.string().uuid().nullable(),
    trustRank: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    freshness: z.enum(["fresh", "aging", "stale", "superseded", "expired"]),
    sensitivity: z.enum(["public", "internal", "confidential", "customer_content"]),
    observedAt: z.string().nullable(),
    effectiveFrom: z.string().nullable(),
    effectiveTo: z.string().nullable(),
    rootRefs: z.array(z.string().uuid()).max(CONTEXT_MAX_ROOTS),
    useRestriction: z.string().trim().min(1).max(200).nullable(),
    priority: z.number().int(),
    optional: z.boolean(),
  })
  .strict();

export type ContextEntry = z.infer<typeof contextEntrySchema>;

export const contextPackSchema = z
  .object({
    schemaVersion: z.literal(CONTEXT_SCHEMA_VERSION),
    manifestId: z.string().uuid(),
    contextDigest: z.string().regex(/^[0-9a-f]{64}$/),
    policyVersion: z.string().min(1).max(60),
    serverTime: z.string(),
    status: contextStatusSchema,
    sections: z.object({
      current: z.array(contextEntrySchema),
      intent: z.array(contextEntrySchema),
      observations: z.array(contextEntrySchema),
      lessons: z.array(contextEntrySchema),
    }),
    exclusions: z.record(z.string(), z.number().int().nonnegative()),
    degradedReasons: z.array(z.string().min(1).max(120)),
    selectedCount: z.number().int().nonnegative(),
    selectedBytes: z.number().int().nonnegative(),
    retrievalLatencyMs: z.number().int().nonnegative().nullable(),
  })
  .strict();

export type ContextPack = z.infer<typeof contextPackSchema>;

// Canonical text + digest --------------------------------------------------------
// The SQL finalization RPC builds this exact text and hashes it with
// pg_catalog.encode(extensions.digest(text, 'sha256'), 'hex'). The TS
// assembler builds it with buildContextCanonicalText and hashes with
// node:crypto in the server-only context-service. Same text, same digest.

/**
 * One line per entry: contextRef|sourceKind|sourceId|revision|summary, lines
 * sorted by contextRef, joined with "\n", no trailing newline. The empty pack
 * canonicalizes to "" (sha256 e3b0c44...b855 on both sides).
 */
export function buildContextCanonicalText(
  entries: readonly {
    contextRef: string;
    sourceKind: string;
    sourceId: string;
    sourceRevision: number | null;
    summary: string;
  }[],
): string {
  return [...entries]
    .sort((left, right) => (left.contextRef < right.contextRef ? -1 : 1))
    .map((entry) =>
      [entry.contextRef, entry.sourceKind, entry.sourceId, entry.sourceRevision ?? "", entry.summary].join("|"),
    )
    .join("\n");
}

/** UTF-8 byte length, matching SQL octet_length. */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Character length, matching SQL char_length (Unicode code points). */
export function charLength(value: string): number {
  return Array.from(value).length;
}

/** Cap a summary at 600 characters without splitting a code point. */
export function capSummary(summary: string): string {
  if (charLength(summary) <= CONTEXT_SUMMARY_MAX_CHARS) return summary;
  return Array.from(summary).slice(0, CONTEXT_SUMMARY_MAX_CHARS).join("");
}

/**
 * Tag escaping for serialized context. Memory is untrusted data: summaries
 * are escaped at the serialization boundary, never relabeled safe by
 * truncation. Byte budgets apply to the raw summary, not the escaped form.
 */
export function escapeContextText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Canonical safe-summary builders. Each mirrors the same-named expression in
 * the `business_memory_context_manifests` migration, which recomputes the
 * summary inside the finalization RPC and refuses caller-invented text
 * (23514). The TS assembler predicts; the RPC decides. Keep both in sync.
 */

/** SQL: left(title || coalesce(chr(10) || body, ''), 600). */
export function buildMemoryItemSummary(input: { title: string; body: string | null }): string {
  return capSummary(`${input.title}${input.body ? `\n${input.body}` : ""}`);
}

/** SQL: left(projection_document::text, 600). Member is the pgJsonbText mirror. */
export function buildCaptureEventSummary(projectionDocument: unknown): string {
  return capSummary(pgJsonbText(projectionDocument));
}

/** SQL: left(fact_key || ' [' || status || '] ' || source || ' :: ' || left(value::text, 200), 600). */
export function buildBusinessFactSummary(input: {
  factKey: string;
  status: string;
  source: string;
  value: unknown;
}): string {
  const valueText = Array.from(pgJsonbText(input.value)).slice(0, 200).join("");
  return capSummary(`${input.factKey} [${input.status}] ${input.source} :: ${valueText}`);
}

/** SQL: left(coalesce(business_model,'') || chr(10) || coalesce(value_proposition,''), 600). */
export function buildBusinessProfileSummary(input: {
  businessModel: string | null;
  valueProposition: string | null;
}): string {
  return capSummary(`${input.businessModel ?? ""}\n${input.valueProposition ?? ""}`);
}

/** SQL: left(name || ' [' || metric || '] target ' || target_value::text || ' ' || unit, 600). */
export function buildGoalSummary(input: {
  name: string;
  metric: string;
  targetValue: string;
  unit: string;
}): string {
  return capSummary(`${input.name} [${input.metric}] target ${input.targetValue} ${input.unit}`);
}

/** SQL: left(name || ' [' || constraint_type || '/' || severity || '] ' || left(value::text, 200), 600). */
export function buildConstraintSummary(input: {
  name: string;
  constraintType: string;
  severity: string;
  value: unknown;
}): string {
  const valueText = Array.from(pgJsonbText(input.value)).slice(0, 200).join("");
  return capSummary(`${input.name} [${input.constraintType}/${input.severity}] ${valueText}`);
}

/** SQL: left('v' || version || ' ' || generation_profile || '/' || execution_mode || ' ' || campaign_id || ' ' || digest, 600). */
export function buildCampaignVersionSummary(input: {
  version: number;
  generationProfile: string;
  executionMode: string;
  campaignId: string;
  digest: string;
}): string {
  return capSummary(
    `v${input.version} ${input.generationProfile}/${input.executionMode} ${input.campaignId} ${input.digest}`,
  );
}
/**
 * Postgres jsonb text rendering for scalar-carrying summaries. Objects sort
 * keys by (byte length, bytewise) with ", " and ": " separators, matching
 * jsonb::text for the JSON subset the summary builders admit. The SQL side
 * uses value::text natively; this mirror exists so the TS assembler predicts
 * the same summary the RPC recomputes. Object fixtures stay scalar-heavy;
 * cross-layer equality is proven on staging after the migration lands.
 */
export function pgJsonbText(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("pgJsonbText does not admit non-finite numbers");
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return `[${value.map((entry) => pgJsonbText(entry)).join(", ")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort((left, right) => {
      const leftBytes = utf8ByteLength(left);
      const rightBytes = utf8ByteLength(right);
      if (leftBytes !== rightBytes) return leftBytes - rightBytes;
      return left < right ? -1 : left > right ? 1 : 0;
    });
    return `{${keys.map((key) => `${JSON.stringify(key)}: ${pgJsonbText(record[key])}`).join(", ")}}`;
  }
  throw new Error("pgJsonbText does not admit that value");
}
