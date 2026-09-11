import type { Sensitivity } from "@/domain/memory/types";

/**
 * Narrow consent-gated share for Google-grounded Channel narration.
 *
 * Pure domain only: no I/O, no clock, no randomness, no node imports.
 * Hashing of the consent wording lives server-side so browser bundles
 * never reach node:crypto through this module.
 *
 * Spec: specs/024-business-memory-grounded-consent.md
 */

export const GROUNDED_SHARE_CONSENT_VERSION = "grounded-share-v1" as const;

export const GROUNDED_SHARE_CONSENT_TITLE =
  "Allow limited Business Memory in Google-grounded Channel advice." as const;

export const GROUNDED_SHARE_CONSENT_BODY =
  "I allow this organization’s Channel recommendations to send a small labeled subset of Business Memory to Google’s generative model together with Google Search grounding. Only entries marked public or internal, marked qualified for reuse, and free of customer details, contact data, and money amounts are eligible, at most 8 entries. Confidential and customer content never shares. Google processes this subset under our Google agreement and its retention rules, which are outside our 90-day erasure. Past shared calls cannot be recalled from Google. Future sharing stops when I revoke or when our Google qualification expires. History of what was shared stays auditable." as const;

export const GROUNDED_SHARE_REVOCATION_NOTE =
  "Revoking stops future sharing. It does not delete what Google already processed." as const;

export function canonicalGroundedShareConsentText(): string {
  return [
    GROUNDED_SHARE_CONSENT_VERSION,
    GROUNDED_SHARE_CONSENT_TITLE,
    GROUNDED_SHARE_CONSENT_BODY,
    GROUNDED_SHARE_REVOCATION_NOTE,
  ].join("\n");
}

export const MAX_GROUNDED_SHARE_ENTRIES = 8 as const;
export const MAX_GROUNDED_SHARE_BYTES = 4096 as const;

export const groundedShareSensitivities = ["public", "internal"] as const;
export type GroundedShareSensitivity = (typeof groundedShareSensitivities)[number];

export const groundedShareReuseClasses = ["qualified_reusable"] as const;
export type GroundedShareReuseClass = (typeof groundedShareReuseClasses)[number];

export type ReuseClass =
  | "internal_reusable"
  | "qualified_reusable"
  | "metadata_only"
  | "denied";

export const groundedShareKnowledgeKinds = [
  "observation",
  "recommendation",
  "operator_decision",
] as const;
export type GroundedShareKnowledgeKind = (typeof groundedShareKnowledgeKinds)[number];

export type KnowledgeKind =
  | GroundedShareKnowledgeKind
  | "campaign_state"
  | "measured_outcome"
  | "lesson"
  | "legacy";

export const groundedShareExclusionCodes = [
  "SENSITIVITY_BLOCKED",
  "REUSE_BLOCKED",
  "KIND_BLOCKED",
  "MONEY_BLOCKED",
  "PII_BLOCKED",
  "ROOT_NOT_LIVE",
  "SCOPE_BLOCKED",
  "LEGACY_UNQUALIFIED",
] as const;
export type GroundedShareExclusionCode = (typeof groundedShareExclusionCodes)[number];

export type GroundedShareCandidate = {
  id: string;
  sensitivity: Sensitivity;
  reuseClass: ReuseClass;
  knowledgeKind: KnowledgeKind;
  /** True when the summary carries a money amount, spend ceiling, budget, or margin figure. */
  hasMoneyAmount: boolean;
  /** True when the summary carries email, phone, ID pattern, or customer name list. */
  hasPii: boolean;
  /** All source roots live, unwithdrawn, unexpired, same organization. */
  rootsLive: boolean;
  /** Organization-wide or exact-branch scope that the consumer may see. */
  scopeOk: boolean;
  /** Legacy rows are never shareable until qualified, even if labeled internal. */
  isLegacyUnqualified: boolean;
  /** Bounded safe summary already capped at 600 chars by the pack contract. */
  summary: string;
  /** Lower runs first; ties break by stable id. */
  priority?: number;
};

export type GroundedShareDecision =
  | { eligible: true }
  | { eligible: false; code: GroundedShareExclusionCode };

export function decideGroundedShareEligibility(
  candidate: GroundedShareCandidate,
): GroundedShareDecision {
  if (candidate.isLegacyUnqualified) return { eligible: false, code: "LEGACY_UNQUALIFIED" };
  if (candidate.sensitivity !== "public" && candidate.sensitivity !== "internal") {
    return { eligible: false, code: "SENSITIVITY_BLOCKED" };
  }
  if (candidate.reuseClass !== "qualified_reusable") {
    return { eligible: false, code: "REUSE_BLOCKED" };
  }
  if (
    candidate.knowledgeKind !== "observation" &&
    candidate.knowledgeKind !== "recommendation" &&
    candidate.knowledgeKind !== "operator_decision"
  ) {
    return { eligible: false, code: "KIND_BLOCKED" };
  }
  if (candidate.hasMoneyAmount) return { eligible: false, code: "MONEY_BLOCKED" };
  if (candidate.hasPii) return { eligible: false, code: "PII_BLOCKED" };
  if (!candidate.rootsLive) return { eligible: false, code: "ROOT_NOT_LIVE" };
  if (!candidate.scopeOk) return { eligible: false, code: "SCOPE_BLOCKED" };
  return { eligible: true };
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export type GroundedShareSubset = {
  selected: GroundedShareCandidate[];
  excluded: { id: string; code: GroundedShareExclusionCode }[];
  totalBytes: number;
};

/**
 * Deterministic subset: eligible candidates ordered by priority then id,
 * capped at 8 entries and 4096 UTF-8 bytes. Ineligible candidates are
 * reported with their first blocking code, never silently dropped.
 * Byte overflow drops the lowest-priority tail first.
 */
export function selectGroundedShareSubset(
  candidates: readonly GroundedShareCandidate[],
): GroundedShareSubset {
  const excluded: GroundedShareSubset["excluded"] = [];
  const eligible: GroundedShareCandidate[] = [];

  for (const candidate of candidates) {
    const decision = decideGroundedShareEligibility(candidate);
    if (!decision.eligible) {
      excluded.push({ id: candidate.id, code: decision.code });
    } else {
      eligible.push(candidate);
    }
  }

  eligible.sort((left, right) => {
    const priority = (left.priority ?? 0) - (right.priority ?? 0);
    if (priority !== 0) return priority;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });

  const selected: GroundedShareCandidate[] = [];
  let totalBytes = 0;
  for (const candidate of eligible) {
    if (selected.length >= MAX_GROUNDED_SHARE_ENTRIES) break;
    const bytes = utf8ByteLength(candidate.summary);
    if (totalBytes + bytes > MAX_GROUNDED_SHARE_BYTES) continue;
    selected.push(candidate);
    totalBytes += bytes;
  }

  return { selected, excluded, totalBytes };
}
