import "server-only";

import { createHash } from "node:crypto";

import {
  buildContextCanonicalText,
  CONTEXT_SCHEMA_VERSION,
  contextRequestSchema,
  type ContextEntry,
  type ContextRequest,
  type ContextRequestInput,
  type ContextStatus,
} from "@/domain/memory/context";
import {
  selectContextCandidates,
  type ContextCandidate,
} from "@/modules/memory/application/context-selection";
import { renderContextPack } from "@/modules/memory/application/context-renderer";

/**
 * Governed pack assembly (Spec 023 §7). Server-only: digest computation needs
 * node:crypto, and assembled packs must never be built in the browser.
 *
 * The service composes selection (quotas, trust order, dedup) and rendering
 * (600-char/24-entry/16384-byte budgets, deterministic drop). Persistence —
 * manifest rows, attempt-key idempotency, the server-side digest — belongs to
 * the finalization RPC through the context repository; this layer never
 * writes. Nothing here logs entry bodies, queries, or prompts: only
 * identifiers, counts, and safe codes leave this module.
 */

export function computeContextDigest(
  entries: readonly {
    contextRef: string;
    sourceKind: string;
    sourceId: string;
    sourceRevision: number | null;
    summary: string;
  }[],
): string {
  return createHash("sha256").update(buildContextCanonicalText(entries), "utf8").digest("hex");
}

export type AssembledPack = {
  request: ContextRequest;
  status: ContextStatus;
  entries: ContextEntry[];
  exclusions: Record<string, number>;
  degradedReasons: string[];
  selectedBytes: number;
  contextDigest: string;
};

export function assembleContextPack(input: {
  request: ContextRequestInput;
  candidates: readonly (ContextCandidate & {
    entry: Omit<ContextEntry, "contextRef">;
  })[];
  retrievalLatencyMs: number | null;
}): AssembledPack {
  const request = contextRequestSchema.parse(input.request);
  const { selected, excluded } = selectContextCandidates(input.candidates);

  const candidateById = new Map(input.candidates.map((candidate) => [candidate.id, candidate]));

  const entries: ContextEntry[] = selected.map((candidate, index) => {
    const found = candidateById.get(candidate.id);
    if (!found) throw new Error("context selection returned an unknown candidate");
    return { ...found.entry, contextRef: `ctx-${String(index + 1).padStart(4, "0")}` };
  });

  const rendered = renderContextPack({ entries, retrievalLatencyMs: input.retrievalLatencyMs });

  const exclusions: Record<string, number> = {};
  for (const entry of excluded) exclusions[entry.code] = (exclusions[entry.code] ?? 0) + 1;
  for (const [code, count] of Object.entries(rendered.exclusions)) {
    exclusions[code] = (exclusions[code] ?? 0) + count;
  }

  // A status the assembler derives on its own (empty here: no candidates
  // survived selection) stays distinct from the RPC-side disabled and
  // unavailable states, which only the finalization RPC may assign.
  const status: ContextStatus =
    rendered.status === "partial" ? "partial" : rendered.entries.length === 0 ? "empty" : "ready";

  return {
    request,
    status,
    entries: rendered.entries,
    exclusions,
    degradedReasons: rendered.degradedReasons,
    selectedBytes: rendered.selectedBytes,
    contextDigest: computeContextDigest(
      rendered.entries.map((entry) => ({
        contextRef: entry.contextRef,
        sourceKind: entry.sourceKind,
        sourceId: entry.sourceId,
        sourceRevision: entry.sourceRevision,
        summary: entry.summary,
      })),
    ),
  };
}

export { CONTEXT_SCHEMA_VERSION };
