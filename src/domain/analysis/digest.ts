import { createHash } from "node:crypto";

import type { AnalysisWindow, DetectorOutcome } from "@/domain/analysis/types";

/**
 * Key order in a hashed object is not incidental. Two runs over identical
 * evidence must produce identical digests, and `JSON.stringify` preserves
 * insertion order, so an object built by a different code path would hash
 * differently while meaning the same thing.
 */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Identifies one finding: its inputs, and the version of the arithmetic that
 * produced it.
 *
 * The cited evidence ids are part of the identity, which is the point. The same
 * window analysed again after a correction lands cites different rows and
 * therefore digests differently, so an operator can tell a re-run that changed
 * nothing from one that changed the answer.
 */
export function createFindingCalculationDigest(input: {
  detectorKey: string;
  calculationVersion: number;
  window: AnalysisWindow;
  outcome: DetectorOutcome;
}): string {
  return createHash("sha256")
    .update(
      canonicalize({
        detectorKey: input.detectorKey,
        calculationVersion: input.calculationVersion,
        window: {
          organizationId: input.window.organizationId,
          channelId: input.window.channelId,
          branchId: input.window.branchId,
          windowStart: input.window.windowStart,
          windowEnd: input.window.windowEnd,
          grain: input.window.grain,
          timeZone: input.window.timeZone,
        },
        outcome: input.outcome,
      }),
    )
    .digest("hex");
}

/** Identifies the whole pass, so a replayed run is recognisably the same answer. */
export function createAnalysisResultDigest(input: {
  registryVersion: number;
  findings: readonly { calculationDigest: string }[];
}): string {
  return createHash("sha256")
    .update(
      canonicalize({
        registryVersion: input.registryVersion,
        calculationDigests: input.findings.map((finding) => finding.calculationDigest),
      }),
    )
    .digest("hex");
}
