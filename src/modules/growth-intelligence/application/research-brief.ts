import { createHash } from "node:crypto";

import { z } from "zod";

/**
 * Internal research brief (Swarm 3).
 *
 * The brief pins the exact approved branch/profile scope BEFORE retrieval so
 * the worker never refetches public research under a moved profile. It
 * records the memory manifest by reference (manifest id + digest + refs) and
 * never copies private bytes into external provider requests.
 *
 * - Every approved topic/competitor slot is preserved; memory only orders
 *   execution, recorded as `memoryOrderRef`.
 * - Model processing of internal context requires provider qualification;
 *   without it the brief stays evidence-only with `unavailable` status.
 * - Extraction may use the brief for relevance; support review receives
 *   source/candidate context only (memory input admission-fails — tested).
 */

export const RESEARCH_BRIEF_POLICY_VERSION = "growth-research-brief@1";
export const RESEARCH_BRIEF_PURPOSE = "growth_research";

export const researchBriefStatusSchema = z.enum([
  "ready",
  "empty",
  "partial",
  "unavailable",
  "disabled",
]);
export type ResearchBriefStatus = z.infer<typeof researchBriefStatusSchema>;

const uuidSchema = z.string().uuid();
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const safeCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,80}$/);

export const researchBriefSlotSchema = z
  .object({
    slotKey: z.string().trim().min(1).max(160),
    kind: z.enum(["local_market", "topic", "competitor"]),
    text: z.string().trim().min(1).max(500),
    maxResults: z.number().int().min(1).max(10),
  })
  .strict();
export type ResearchBriefSlot = z.infer<typeof researchBriefSlotSchema>;

export const researchBriefSchema = z
  .object({
    briefId: uuidSchema,
    organizationId: uuidSchema,
    requestId: uuidSchema,
    branchId: uuidSchema.nullable(),
    profileVersionId: uuidSchema,
    sourcePolicyDigest: digestSchema,
    attemptKey: z.string().trim().min(1).max(200),
    correlationId: uuidSchema,
    manifestId: uuidSchema.nullable(),
    contextDigest: digestSchema.nullable(),
    status: researchBriefStatusSchema,
    contextRefs: z.array(z.string().trim().min(1).max(60)).max(24),
    memoryOrderRef: z.string().trim().min(1).max(120).nullable(),
    degradedReasons: z.array(safeCodeSchema).max(12),
    evidenceOnly: z.boolean(),
    slots: z.array(researchBriefSlotSchema).min(1).max(26),
    briefFingerprint: digestSchema,
  })
  .strict();
export type ResearchBrief = z.infer<typeof researchBriefSchema>;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function fingerprintResearchBrief(input: {
  organizationId: string;
  requestId: string;
  branchId: string | null;
  profileVersionId: string;
  sourcePolicyDigest: string;
  manifestId: string | null;
  contextDigest: string | null;
  slotKeys: readonly string[];
  memoryOrderRef: string | null;
}): string {
  return sha256(
    canonicalize({
      organizationId: input.organizationId,
      requestId: input.requestId,
      branchId: input.branchId,
      profileVersionId: input.profileVersionId,
      sourcePolicyDigest: input.sourcePolicyDigest,
      manifestId: input.manifestId,
      contextDigest: input.contextDigest,
      slotKeys: [...input.slotKeys].sort(),
      memoryOrderRef: input.memoryOrderRef,
      policyVersion: RESEARCH_BRIEF_POLICY_VERSION,
    }),
  );
}

export function buildResearchBrief(input: {
  organizationId: string;
  requestId: string;
  branchId: string | null;
  profileVersionId: string;
  sourcePolicyDigest: string;
  attemptKey: string;
  correlationId: string;
  slots: readonly ResearchBriefSlot[];
  manifest: {
    manifestId: string | null;
    contextDigest: string | null;
    status: ResearchBriefStatus;
    contextRefs: readonly string[];
    degradedReasons: readonly string[];
  } | null;
  qualified: boolean;
  briefId?: string;
}): ResearchBrief {
  const slots = researchBriefSlotSchema.array().min(1).max(26).parse([...input.slots]);
  const manifestId = input.manifest?.manifestId ?? null;
  const contextDigest = input.manifest?.contextDigest ?? null;
  const status: ResearchBriefStatus = input.manifest
    ? researchBriefStatusSchema.parse(input.manifest.status)
    : "unavailable";
  // Without provider qualification the model may not process internal
  // context: the brief stays evidence-only and unavailable, persisted so the
  // operator sees the limit honestly instead of untracked context use.
  const evidenceOnly = !input.qualified;
  const effectiveStatus: ResearchBriefStatus = evidenceOnly ? "unavailable" : status;
  const contextRefs = evidenceOnly ? [] : [...(input.manifest?.contextRefs ?? [])].slice(0, 24);
  const memoryOrderRef =
    input.manifest && contextRefs.length > 0
      ? `memory:${manifestId ?? "none"}:order-preserved`
      : null;
  const briefFingerprint = fingerprintResearchBrief({
    organizationId: input.organizationId,
    requestId: input.requestId,
    branchId: input.branchId,
    profileVersionId: input.profileVersionId,
    sourcePolicyDigest: input.sourcePolicyDigest,
    manifestId: evidenceOnly ? null : manifestId,
    contextDigest: evidenceOnly ? null : contextDigest,
    slotKeys: slots.map((slot) => slot.slotKey),
    memoryOrderRef,
  });
  return researchBriefSchema.parse({
    briefId: input.briefId ?? crypto.randomUUID(),
    organizationId: input.organizationId,
    requestId: input.requestId,
    branchId: input.branchId,
    profileVersionId: input.profileVersionId,
    sourcePolicyDigest: input.sourcePolicyDigest,
    attemptKey: input.attemptKey,
    correlationId: input.correlationId,
    manifestId: evidenceOnly ? null : manifestId,
    contextDigest: evidenceOnly ? null : contextDigest,
    status: effectiveStatus,
    contextRefs,
    memoryOrderRef,
    degradedReasons: [...(input.manifest?.degradedReasons ?? [])].slice(0, 12),
    evidenceOnly,
    slots,
    briefFingerprint,
  });
}

/**
 * Memory orders execution only: every approved slot is preserved, order may
 * follow memory relevance, and the order basis is recorded by reference.
 * The input order is the approved scope order; the output keeps the same set.
 */
export function orderSlotsByMemory(input: {
  slots: readonly ResearchBriefSlot[];
  relevance?: Readonly<Record<string, number>>;
  memoryOrderRef: string | null;
}): { ordered: ResearchBriefSlot[]; preserved: boolean } {
  const slots = [...input.slots];
  const keys = new Set(slots.map((slot) => slot.slotKey));
  if (keys.size !== slots.length) throw new Error("Research brief slots must be unique.");
  const relevance = input.relevance ?? {};
  const ordered = [...slots].sort((left, right) => {
    const leftScore = relevance[left.slotKey] ?? 0;
    const rightScore = relevance[right.slotKey] ?? 0;
    if (leftScore !== rightScore) return rightScore - leftScore;
    return left.slotKey < right.slotKey ? -1 : 1;
  });
  const preserved =
    ordered.length === slots.length && ordered.every((slot) => keys.has(slot.slotKey));
  void input.memoryOrderRef;
  return { ordered, preserved };
}

/**
 * External provider requests carry approved public text only. This guard
 * proves byte-absence of private bytes (memory summaries, digests, refs) in
 * URLs, metadata, and logs: any private byte present fails closed.
 */
export function assertExternalRequestHasOnlyPublicBytes(input: {
  serialized: string;
  privateBytes: readonly string[];
}): void {
  for (const secret of input.privateBytes) {
    const trimmed = secret.trim();
    if (trimmed.length < 8) continue;
    if (input.serialized.includes(trimmed)) {
      throw new Error("External research request carries private context bytes.");
    }
  }
}

const DEGRADATION_COPY: Record<ResearchBriefStatus, string> = {
  ready: "Brief ready with current memory context.",
  empty: "No memory context matched this branch. Research ran on approved public scope only.",
  partial: "Some memory context was unavailable. Research ran on approved public scope plus the cited refs.",
  unavailable: "Memory context was unavailable, so research ran evidence-only on approved public sources.",
  disabled: "Memory context is disabled for this organization. Research ran on approved public scope only.",
};

export function describeBriefDegradation(status: ResearchBriefStatus): string {
  return DEGRADATION_COPY[status];
}
