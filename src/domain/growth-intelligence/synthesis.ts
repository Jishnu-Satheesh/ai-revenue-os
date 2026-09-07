import { z } from "zod";

import type {
  MarketEvidenceFreshness,
  MarketEvidenceSupportGrade,
  MarketGeographicLayer,
} from "@/domain/growth-intelligence/types";

/**
 * Deterministic synthesis candidate validation.
 *
 * The model may propose connections and narratives, but deterministic code
 * owns every verdict that reaches persistence: citations resolve to eligible
 * claims, geography compatibility is proven or declared, stale evidence
 * travels with its limitation, and no narrative may utter causal,
 * financial, or execution conclusions the model is forbidden to choose.
 */

const uuidSchema = z.string().uuid();
const safeCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,80}$/);

const candidateSchema = z
  .object({
    kind: z.enum(["insight", "recommendation", "data_gap"]),
    narrative: z.string().trim().min(1).max(2_000),
    claimIds: z.array(uuidSchema).max(50),
    businessFindingIds: z.array(uuidSchema).max(50),
    geographicLayer: z.enum(["trade_area", "city", "country"]),
    geographyRef: z.string().trim().min(2).max(160),
    limitations: z.array(safeCodeSchema).max(20),
    staleBusinessEvidence: z.boolean(),
    missingInput: z.string().trim().min(1).max(160).nullable(),
  })
  .strict()
  .superRefine((candidate, context) => {
    if (new Set(candidate.claimIds).size !== candidate.claimIds.length) {
      context.addIssue({ code: "custom", message: "Cited claims must be unique." });
    }
    if (new Set(candidate.businessFindingIds).size !== candidate.businessFindingIds.length) {
      context.addIssue({ code: "custom", message: "Business findings must be unique." });
    }
    if (new Set(candidate.limitations).size !== candidate.limitations.length) {
      context.addIssue({ code: "custom", message: "Limitations must be unique." });
    }
  });

export type SynthesisCandidate = z.infer<typeof candidateSchema>;

export type EligibleSynthesisClaim = {
  id: string;
  supportGrade: MarketEvidenceSupportGrade;
  freshness: MarketEvidenceFreshness;
  excluded: boolean;
  geographicLayer: MarketGeographicLayer;
  geographyRef: string;
};

export type SynthesisValidationContext = {
  eligibleClaims: readonly EligibleSynthesisClaim[];
  businessEvidenceFresh: boolean;
};

export type SynthesisValidationReason =
  | "INVALID_KIND"
  | "MALFORMED_CANDIDATE"
  | "MISSING_CITATION"
  | "MISSING_BUSINESS_FINDING"
  | "MISSING_INPUT_UNSPECIFIED"
  | "MISPLACED_MISSING_INPUT"
  | "CLAIM_UNKNOWN"
  | "CLAIM_EXCLUDED"
  | "CLAIM_EXPIRED"
  | "CLAIM_CONFLICTED"
  | "GEOGRAPHY_INCOMPATIBLE"
  | "BROADER_INFERENCE_UNDECLARED"
  | "STALE_EVIDENCE_UNDECLARED"
  | "UNSUPPORTED_CAUSAL_LANGUAGE"
  | "UNSUPPORTED_EXECUTION_LANGUAGE";

export type SynthesisValidationResult =
  | { outcome: "valid" }
  | { outcome: "invalid"; reasonCode: SynthesisValidationReason };

// Unsupported causal conclusions. A narration may describe what was recorded;
// it may not assert what the evidence causes, proves, or guarantees.
const CAUSAL_PATTERNS = [
  /\bcauses?\b/i,
  /\bproves?\b/i,
  /\bguarantee[sd]?\b/i,
  /\bwill (increase|decrease|boost|lift|grow|decline)\b/i,
  /\bdrives? (demand|revenue|growth|sales)\b/i,
  /\bproven\b/i,
];

// Execution verbs no synthesis output may utter. Synthesis proposes cited
// advice; approval, publishing, spend, and provider actions live elsewhere.
const EXECUTION_PATTERNS = [
  /\bapprove[sd]?\b/i,
  /\bpublish(?:ed|ing)?\b/i,
  /\bexecutes?\b/i,
  /\bspend(?:s|ing)?\b/i,
  /\btransfer(?:s|red|ring)?\b/i,
  /\bdeploys?\b/i,
  /\bdeletes?\b/i,
];

const LAYER_RANK: Record<MarketGeographicLayer, number> = {
  country: 0,
  city: 1,
  trade_area: 2,
};

function invalid(reasonCode: SynthesisValidationReason): SynthesisValidationResult {
  return { outcome: "invalid", reasonCode };
}

export function validateSynthesisCandidate(
  candidate: unknown,
  context: SynthesisValidationContext,
): SynthesisValidationResult {
  const parsed = candidateSchema.safeParse(candidate);
  if (!parsed.success) {
    // A structurally unknown kind is a contract breach, not a shape typo.
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      "kind" in candidate &&
      typeof (candidate as { kind?: unknown }).kind === "string" &&
      !["insight", "recommendation", "data_gap"].includes((candidate as { kind: string }).kind)
    ) {
      return invalid("INVALID_KIND");
    }
    return invalid("MALFORMED_CANDIDATE");
  }
  const valid = parsed.data;

  if (valid.kind === "data_gap") {
    if (!valid.missingInput) return invalid("MISSING_INPUT_UNSPECIFIED");
  } else if (valid.missingInput !== null) {
    return invalid("MISPLACED_MISSING_INPUT");
  }

  if (valid.kind !== "data_gap" && valid.claimIds.length === 0) {
    return invalid("MISSING_CITATION");
  }
  if (valid.kind === "recommendation" && valid.businessFindingIds.length === 0) {
    return invalid("MISSING_BUSINESS_FINDING");
  }

  for (const pattern of EXECUTION_PATTERNS) {
    if (pattern.test(valid.narrative)) return invalid("UNSUPPORTED_EXECUTION_LANGUAGE");
  }
  for (const pattern of CAUSAL_PATTERNS) {
    if (pattern.test(valid.narrative)) return invalid("UNSUPPORTED_CAUSAL_LANGUAGE");
  }

  const eligible = new Map(context.eligibleClaims.map((claim) => [claim.id, claim]));
  let broaderEvidence = false;
  for (const claimId of valid.claimIds) {
    const claim = eligible.get(claimId);
    if (!claim) return invalid("CLAIM_UNKNOWN");
    if (claim.excluded) return invalid("CLAIM_EXCLUDED");
    if (claim.freshness === "expired") return invalid("CLAIM_EXPIRED");
    if (claim.supportGrade === "conflicted") return invalid("CLAIM_CONFLICTED");
    if (
      claim.geographicLayer === valid.geographicLayer &&
      claim.geographyRef === valid.geographyRef
    ) {
      continue;
    }
    // Broader evidence may support a narrower item only when the synthesis
    // states that inference as a limitation. Narrower evidence can never
    // prove a broader scope. Country outranks city outranks trade area.
    if (LAYER_RANK[claim.geographicLayer] < LAYER_RANK[valid.geographicLayer]) {
      broaderEvidence = true;
      continue;
    }
    return invalid("GEOGRAPHY_INCOMPATIBLE");
  }
  if (broaderEvidence && !valid.limitations.includes("BROADER_MARKET_INFERENCE")) {
    return invalid("BROADER_INFERENCE_UNDECLARED");
  }

  const staleEvidence =
    valid.staleBusinessEvidence ||
    !context.businessEvidenceFresh ||
    [...eligible.values()]
      .filter((claim) => valid.claimIds.includes(claim.id))
      .some((claim) => claim.freshness === "stale");
  if (staleEvidence && !valid.limitations.includes("STALE_BUSINESS_EVIDENCE")) {
    return invalid("STALE_EVIDENCE_UNDECLARED");
  }

  return { outcome: "valid" };
}
