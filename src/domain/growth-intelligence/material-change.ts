import { createHash } from "node:crypto";

import { z } from "zod";

import type { MarketEvidenceMaterialSnapshot } from "@/domain/growth-intelligence/types";

export type { MarketEvidenceMaterialSnapshot } from "@/domain/growth-intelligence/types";

const digestSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Content identity must be a SHA-256 digest.");
const normalizedKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(160)
  .regex(/^[A-Za-z][A-Za-z0-9_.-]+$/);
const timestampSchema = z.string().datetime({ offset: false });

function sortedUniqueStrings(maximum: number, schema: z.ZodString = z.string()) {
  return z
    .array(schema)
    .max(maximum)
    .superRefine((values, context) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          message: "Material evidence references must be unique.",
        });
      }
    })
    .transform((values) => [...values].sort());
}

const materialSnapshotSchema: z.ZodType<MarketEvidenceMaterialSnapshot> = z
  .object({
    subjectKind: normalizedKeySchema,
    subjectRef: z.string().trim().min(1).max(300),
    claimKind: normalizedKeySchema,
    contentDigest: digestSchema,
    supportGrade: z.enum(["primary", "corroborated", "single_source", "contextual", "conflicted"]),
    freshness: z.enum(["current", "stale", "expired"]),
    sourceState: z.enum(["active", "withdrawn", "excluded"]),
    geography: z
      .object({
        layer: z.enum(["trade_area", "city", "country"]),
        locationRef: z.string().trim().min(2).max(160),
      })
      .strict(),
    sourceIds: sortedUniqueStrings(50, z.string().uuid()).pipe(z.array(z.string()).min(1)),
    corroboratingClaimIds: sortedUniqueStrings(50, z.string().uuid()),
    contradictingClaimIds: sortedUniqueStrings(50, z.string().uuid()),
    limitationCodes: sortedUniqueStrings(50, normalizedKeySchema),
    retrievedAt: timestampSchema,
    expiresAt: timestampSchema,
    narrativeDigest: digestSchema,
  })
  .strict();

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function materialIdentity(snapshot: MarketEvidenceMaterialSnapshot) {
  const parsed = materialSnapshotSchema.parse(snapshot);
  return {
    subjectKind: parsed.subjectKind,
    subjectRef: parsed.subjectRef,
    claimKind: parsed.claimKind,
    contentDigest: parsed.contentDigest,
    supportGrade: parsed.supportGrade,
    freshness: parsed.freshness,
    sourceState: parsed.sourceState,
    geography: parsed.geography,
    sourceIds: parsed.sourceIds,
    corroboratingClaimIds: parsed.corroboratingClaimIds,
    contradictingClaimIds: parsed.contradictingClaimIds,
    limitationCodes: parsed.limitationCodes,
  };
}

/** Excludes crawl time, expiry extension, and narration-only rewrites by design. */
export function createMarketEvidenceMaterialFingerprint(
  snapshot: MarketEvidenceMaterialSnapshot,
): string {
  return createHash("sha256")
    .update(canonicalize(materialIdentity(snapshot)), "utf8")
    .digest("hex");
}

export function hasMaterialMarketEvidenceChange(
  previous: MarketEvidenceMaterialSnapshot,
  current: MarketEvidenceMaterialSnapshot,
): boolean {
  return (
    createMarketEvidenceMaterialFingerprint(previous) !==
    createMarketEvidenceMaterialFingerprint(current)
  );
}
