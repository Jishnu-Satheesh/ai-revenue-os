import { createHash } from "node:crypto";

import { z } from "zod";

import type { MarketGeographicLayer } from "@/domain/growth-intelligence/types";

/**
 * Synthesized item identity.
 *
 * One fingerprint binds the material narrative and the evidence identity:
 * the item kind, the exact narration, every cited claim digest, every bound
 * business finding digest, the geography, the limitation set, and the
 * synthesis version that produced it. Byte-identical repeats share the
 * fingerprint; evidence-identical rewrites share the evidence fingerprint in
 * lineage. Anything else is a new item.
 */

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const safeCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,80}$/);
const versionSchema = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .regex(/^[a-z][a-z0-9_.-]*@[1-9]\d*$/);

function sortedUniqueDigests(maximum: number) {
  return z
    .array(digestSchema)
    .max(maximum)
    .superRefine((values, context) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: "custom", message: "Evidence digests must be unique." });
      }
    })
    .transform((values) => [...values].sort());
}

const itemInputSchema = z
  .object({
    kind: z.enum(["insight", "recommendation", "data_gap"]),
    narrative: z.string().trim().min(1).max(2_000),
    claimDigests: sortedUniqueDigests(50),
    businessFindingDigests: sortedUniqueDigests(50),
    geographicLayer: z.enum(["trade_area", "city", "country"]),
    geographyRef: z.string().trim().min(2).max(160),
    limitationCodes: z
      .array(safeCodeSchema)
      .max(20)
      .superRefine((values, context) => {
        if (new Set(values).size !== values.length) {
          context.addIssue({ code: "custom", message: "Limitation codes must be unique." });
        }
      })
      .transform((values) => [...values].sort()),
    synthesisVersion: versionSchema,
  })
  .strict();

export type GrowthIntelligenceItemInput = z.infer<typeof itemInputSchema>;

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

export type GrowthIntelligenceItemIdentity = {
  itemFingerprint: string;
  evidenceFingerprint: string;
};

export function createGrowthIntelligenceItemFingerprint(
  input: GrowthIntelligenceItemInput,
): string {
  return createGrowthIntelligenceItemIdentity(input).itemFingerprint;
}

export function createGrowthIntelligenceItemIdentity(
  input: GrowthIntelligenceItemInput,
): GrowthIntelligenceItemIdentity {
  const parsed = itemInputSchema.parse(input);
  // Limitation codes ride with the evidence: a new limitation changes what the
  // item means even when the narration and digests repeat.
  const evidence = {
    claimDigests: parsed.claimDigests,
    businessFindingDigests: parsed.businessFindingDigests,
    geographicLayer: parsed.geographicLayer as MarketGeographicLayer,
    geographyRef: parsed.geographyRef,
    limitationCodes: parsed.limitationCodes,
    synthesisVersion: parsed.synthesisVersion,
  };
  const evidenceFingerprint = createHash("sha256")
    .update(canonicalize(evidence), "utf8")
    .digest("hex");
  const itemFingerprint = createHash("sha256")
    .update(
      canonicalize({
        ...evidence,
        kind: parsed.kind,
        narrative: parsed.narrative,
      }),
      "utf8",
    )
    .digest("hex");
  return { itemFingerprint, evidenceFingerprint };
}
