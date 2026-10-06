import {
  buildContextCanonicalText,
  capSummary,
  CONTEXT_MAX_BYTES,
  CONTEXT_MAX_ENTRIES,
  escapeContextText,
  utf8ByteLength,
  type ContextEntry,
  type ContextExclusionCode,
  type ContextSection,
  type ContextStatus,
} from "@/domain/memory/context";

/**
 * Bounded pack serialization (Spec 023 §7 steps 7–8). Pure: no I/O, no clock,
 * no randomness. Caps each summary at 600 characters, the pack at 24 entries
 * and 16384 UTF-8 bytes over raw summaries. Overflow deterministically drops
 * the lowest-priority optional entries first; dropping (or initially
 * overflowing) a mandatory entry yields `partial` with a safe reason instead
 * of silently truncating meaning. Budgets apply to raw summaries; tag
 * escaping happens only on the serialized copy the model receives.
 */

export type RenderedPack = {
  status: ContextStatus;
  entries: ContextEntry[];
  exclusions: Record<string, number>;
  degradedReasons: string[];
  selectedBytes: number;
  canonicalText: string;
};

export function renderContextPack(input: {
  entries: readonly ContextEntry[];
  retrievalLatencyMs: number | null;
}): RenderedPack {
  const exclusions: Record<string, number> = {};
  const degradedReasons: string[] = [];
  const capped: ContextEntry[] = input.entries.map((entry, index) => ({
    ...entry,
    contextRef: entry.contextRef || `ctx-${String(index + 1).padStart(4, "0")}`,
    summary: capSummary(entry.summary),
  }));

  const countCode = (code: ContextExclusionCode, count = 1): void => {
    // Zero-count keys are noise downstream (manifest exclusion_counts,
    // health panels): a code appears only when something was actually cut.
    if (count <= 0) return;
    exclusions[code] = (exclusions[code] ?? 0) + count;
  };

  // Entry-count budget first: deterministic drop of lowest-priority optionals.
  const byDropOrder = [...capped].sort((left, right) => {
    if (left.optional !== right.optional) return left.optional ? -1 : 1;
    if (left.priority !== right.priority) return left.priority - right.priority;
    return left.contextRef < right.contextRef ? 1 : -1;
  });
  let kept = [...capped];
  if (kept.length > CONTEXT_MAX_ENTRIES) {
    const dropped = byDropOrder.slice(0, kept.length - CONTEXT_MAX_ENTRIES);
    const droppedIds = new Set(dropped.map((entry) => entry.contextRef));
    if (dropped.some((entry) => !entry.optional)) {
      degradedReasons.push("MANDATORY_OVERFLOW");
      countCode("MANDATORY_OVERFLOW", dropped.filter((entry) => !entry.optional).length);
    }
    countCode("OVER_BUDGET", dropped.filter((entry) => entry.optional).length);
    kept = kept.filter((entry) => !droppedIds.has(entry.contextRef));
  }

  // Byte budget over raw summaries: same deterministic drop order.
  const bytesOf = (entry: ContextEntry): number => utf8ByteLength(entry.summary);
  let selectedBytes = kept.reduce((total, entry) => total + bytesOf(entry), 0);
  if (selectedBytes > CONTEXT_MAX_BYTES) {
    const dropOrder = [...kept].sort((left, right) => {
      if (left.optional !== right.optional) return left.optional ? -1 : 1;
      if (left.priority !== right.priority) return left.priority - right.priority;
      return left.contextRef < right.contextRef ? 1 : -1;
    });
    const droppedRefs = new Set<string>();
    for (const entry of dropOrder) {
      if (selectedBytes <= CONTEXT_MAX_BYTES) break;
      if (!entry.optional && kept.length - droppedRefs.size <= 1) break;
      droppedRefs.add(entry.contextRef);
      selectedBytes -= bytesOf(entry);
    }
    const dropped = kept.filter((entry) => droppedRefs.has(entry.contextRef));
    if (dropped.some((entry) => !entry.optional) || selectedBytes > CONTEXT_MAX_BYTES) {
      if (!degradedReasons.includes("MANDATORY_OVERFLOW"))
        degradedReasons.push("MANDATORY_OVERFLOW");
      countCode("MANDATORY_OVERFLOW", dropped.filter((entry) => !entry.optional).length || 1);
    }
    countCode("OVER_BUDGET", dropped.filter((entry) => entry.optional).length);
    kept = kept.filter((entry) => !droppedRefs.has(entry.contextRef));
  }

  kept.sort((left, right) => (left.contextRef < right.contextRef ? -1 : 1));

  const canonicalText = buildContextCanonicalText(
    kept.map((entry) => ({
      contextRef: entry.contextRef,
      sourceKind: entry.sourceKind,
      sourceId: entry.sourceId,
      sourceRevision: entry.sourceRevision,
      summary: entry.summary,
    })),
  );

  const partial = degradedReasons.length > 0;
  return {
    status: partial ? "partial" : "ready",
    entries: kept,
    exclusions,
    degradedReasons,
    selectedBytes,
    canonicalText,
  };
}

/** Sections in pack order. */
export function groupBySection(
  entries: readonly ContextEntry[],
): Record<ContextSection, ContextEntry[]> {
  return {
    current: entries.filter((entry) => entry.section === "current"),
    intent: entries.filter((entry) => entry.section === "intent"),
    observations: entries.filter((entry) => entry.section === "observations"),
    lessons: entries.filter((entry) => entry.section === "lessons"),
  };
}

/**
 * The serialized copy the model receives: escaped summaries with section
 * labels, stable entry references, and the pack status stated up front so a
 * partial pack is never mistaken for complete context.
 */
export function serializeForModel(input: {
  status: ContextStatus;
  entries: readonly ContextEntry[];
  degradedReasons: readonly string[];
}): string {
  const lines = [`[context status=${input.status}]`];
  if (input.degradedReasons.length > 0) {
    lines.push(`[degraded ${input.degradedReasons.join(",")}]`);
  }
  for (const entry of input.entries) {
    lines.push(
      `[${entry.contextRef} ${entry.section} ${entry.statementKind}] ${escapeContextText(entry.title)}`,
    );
    lines.push(escapeContextText(entry.summary));
  }
  return lines.join("\n");
}
