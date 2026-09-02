import { createHash } from "node:crypto";

import type {
  ReportContractDocument,
  ReportSchemaFingerprintInput,
} from "@/domain/reports/contracts";
import type {
  ExactRangeProjectionOutput,
  PeriodGrainObservation,
} from "@/domain/reports/projection";

/**
 * Every digest the report path records, in the one module that needs Node.
 *
 * `createHash` comes from `node:crypto`, which a browser bundle cannot load at
 * all — not slowly, not partially, it fails the build. The schemas next to
 * these functions, meanwhile, are exactly what the upload screen needs in order
 * to tell an operator what a declaration will record. Keeping both in one file
 * made the whole projection engine a browser dependency and broke the build the
 * moment intake started reading a declaration.
 *
 * So the hashing lives here, on its own, imported only by workers. The document
 * types above are type-only imports and vanish at compile time, so nothing
 * server-side is dragged back the other way.
 *
 * The canonical form is shared rather than duplicated because these digests are
 * recorded against rows that outlive the code: two copies of this function that
 * drift by a space would silently repartition every digest ever written.
 */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createReportSchemaFingerprint(input: ReportSchemaFingerprintInput): string {
  return createHash("sha256").update(canonicalize(input)).digest("hex");
}

export function createReportContractDocumentDigest(document: ReportContractDocument): string {
  return createHash("sha256").update(canonicalize(document)).digest("hex");
}

/**
 * Identifies the projected figures, and only those.
 *
 * A reconciled control total is a check that passed, not a figure, so it stays
 * out: including it would change the digest of every existing declaration and
 * make an unchanged import look like a correction.
 */
export function createReportProjectionResultDigest(result: {
  outputs: readonly ExactRangeProjectionOutput[];
}): string {
  return createHash("sha256").update(canonicalize(result)).digest("hex");
}

/**
 * Identifies a projected series.
 *
 * The count of blank periods is part of the identity, because a file the
 * provider left more gaps in is different evidence about the same days, and an
 * import that quietly gained eleven gaps should not carry the digest of the one
 * that had none. A reconciled control total stays out for the same reason it
 * does above.
 */
export function createReportPeriodGrainResultDigest(result: {
  observations: readonly PeriodGrainObservation[];
  absentRowCount: number;
}): string {
  return createHash("sha256").update(canonicalize(result)).digest("hex");
}
