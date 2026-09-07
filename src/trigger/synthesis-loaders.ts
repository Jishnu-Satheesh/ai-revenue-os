import type { SynthesisBusinessFinding } from "@/modules/growth-intelligence/application/synthesis-service";

/**
 * SDK-free compact mapping for synthesis business findings.
 *
 * This module depends on types only (erased at runtime): no
 * `@trigger.dev/sdk`, no Supabase client, no env access. It exists so the
 * findings row mapping is reachable from behavioral tests without importing
 * the Trigger wiring's side effects.
 */

export function safeLimitationCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is string => typeof entry === "string" && /^[A-Z][A-Z0-9_]{2,80}$/.test(entry),
  );
}

/**
 * Maps one `channel_findings` row to the compact finding identity the
 * synthesis provider accepts. Byte-identical to the previous inline mapping
 * in `src/trigger/growth-intelligence.ts`: same headline format, same
 * severity default, same limitation filtering.
 */
export function toCompactBusinessFinding(row: unknown): SynthesisBusinessFinding {
  const record = (row ?? {}) as Record<string, unknown>;
  return {
    id: record.id as string,
    digest: record.calculation_digest as string,
    code: record.code as string,
    severity: (record.severity ?? "low") as SynthesisBusinessFinding["severity"],
    headline: `${record.detector_key as string}: ${record.code as string}`.slice(0, 200),
    limitations: safeLimitationCodes(record.limitations),
  };
}
