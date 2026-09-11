/**
 * Consent-gated share mode for Channel narration (Spec 024).
 *
 * Pure module: no I/O, no clock, no randomness, no node imports. It decides
 * which mode a narration runs in and validates the worker's status read, so
 * the workflow and the Trigger wiring share one decision instead of each
 * re-deriving it from raw JSON.
 *
 * Sharing stays default-deny: anything unrecognized — a missing flag, a
 * malformed status payload, an unknown reason — resolves to internal-only.
 * A narration that cannot prove sharing is allowed does not share.
 */

export const shareModes = ["internal_only", "grounded_share"] as const;
export type ShareMode = (typeof shareModes)[number];

export const shareReasons = [
  "disabled",
  "status_unavailable",
  "corpus_unqualified",
  "ready",
] as const;
export type ShareReason = (typeof shareReasons)[number];

/** One bounded safe summary the worker may place in the prompt. */
export type SharePromptEntry = {
  title: string;
  summary: string;
};

export type ShareContext = {
  mode: ShareMode;
  entries: readonly SharePromptEntry[];
  excludedCount: number;
  reason: ShareReason;
};

export const INTERNAL_ONLY_CONTEXT: ShareContext = {
  mode: "internal_only",
  entries: [],
  excludedCount: 0,
  reason: "disabled",
};

/**
 * Reads the worker's `grounded_share_status` answer defensively. Only an
 * object with an explicit `shareActive: true` activates sharing; every other
 * shape — null, a bare boolean, a missing flag — is internal-only, so a
 * database or transport surprise can never widen disclosure.
 */
export function isShareActiveStatus(data: unknown): boolean {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  return (data as { shareActive?: unknown }).shareActive === true;
}

/**
 * Builds the narration's share context from a status answer and an already
 * allowlisted entry list. Entries arrive filtered by the domain allowlist, so
 * this function never re-judges eligibility — it only maps state to mode:
 * inactive means internal-only, active with entries means sharing, active
 * without entries means sharing was allowed but the corpus holds nothing
 * qualified yet (the expected state until Spec 023 capture lands).
 */
export function resolveShareContext(input: {
  shareActive: boolean;
  entries: readonly SharePromptEntry[];
  excludedCount: number;
}): ShareContext {
  if (!input.shareActive) {
    return { mode: "internal_only", entries: [], excludedCount: 0, reason: "disabled" };
  }
  if (input.entries.length === 0) {
    return {
      mode: "grounded_share",
      entries: [],
      excludedCount: input.excludedCount,
      reason: "corpus_unqualified",
    };
  }
  return {
    mode: "grounded_share",
    entries: input.entries,
    excludedCount: input.excludedCount,
    reason: "ready",
  };
}

/**
 * Identifiers and counts for structured logs. Bodies never travel to a log:
 * the entries' words stay in the prompt and the completion record, and here
 * only the mode, the counts, and the reason are named.
 */
export function shareLogFields(context: ShareContext): {
  shareMode: ShareMode;
  shareEntryCount: number;
  shareExcludedCount: number;
  shareReason: ShareReason;
} {
  return {
    shareMode: context.mode,
    shareEntryCount: context.entries.length,
    shareExcludedCount: context.excludedCount,
    shareReason: context.reason,
  };
}
