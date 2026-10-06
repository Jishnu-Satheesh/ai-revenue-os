import { createHash } from "node:crypto";

import { z } from "zod";

import { compareCanonicalText } from "@/domain/growth-intelligence/schemas";
import type { GrowthIntelligenceRequestFingerprintInput } from "@/domain/growth-intelligence/types";

export type { GrowthIntelligenceRequestFingerprintInput } from "@/domain/growth-intelligence/types";

const digestSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Evidence and policy digests must be lowercase SHA-256 values.");
const versionSchema = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .regex(/^[a-z][a-z0-9_.-]*@[1-9]\d*$/);

const requestFingerprintInputSchema: z.ZodType<GrowthIntelligenceRequestFingerprintInput> = z
  .object({
    organizationId: z.string().uuid(),
    branchId: z.string().uuid().nullable(),
    channelId: z.string().uuid().nullable(),
    kind: z.enum([
      "profile_discovery",
      "market_research",
      "market_evidence_changed",
      "weekly_synthesis",
      "business_evidence_changed",
      "evidence_reassessment",
    ]),
    triggerReason: z.enum([
      "profile_confirmed",
      "profile_revised",
      "daily_due",
      "weekly_due",
      "business_evidence_current",
      "market_research_completed",
      "source_policy_changed",
      "evidence_expired",
      "source_changed",
      "manual_retry",
    ]),
    businessEvidenceDigest: digestSchema.nullable(),
    marketProfileVersionId: z.string().uuid(),
    sourcePolicyDigest: digestSchema,
    researchRuleVersion: versionSchema,
    localTimeBucket: z
      .string()
      .regex(
        /^(?:daily|weekly):\d{4}-\d{2}-\d{2}$|^immediate$/,
        "Local time bucket must be a daily date, weekly start date, or immediate.",
      ),
    synthesisVersionTuple: versionSchema.nullable(),
    playbookVersionTuple: versionSchema.nullable(),
  })
  .strict();

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCanonicalText(left, right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Identifies durable work independently of upload, scheduler, or Trigger replay. */
export function createGrowthIntelligenceRequestFingerprint(
  input: GrowthIntelligenceRequestFingerprintInput,
): string {
  const parsed = requestFingerprintInputSchema.parse(input);
  return createHash("sha256").update(canonicalize(parsed), "utf8").digest("hex");
}
