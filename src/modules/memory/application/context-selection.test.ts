import { describe, expect, it } from "vitest";

import {
  selectContextCandidates,
  type ContextCandidate,
} from "@/modules/memory/application/context-selection";

let sequence = 0;

function candidate(overrides: Partial<ContextCandidate> = {}): ContextCandidate {
  sequence += 1;
  const id = overrides.id ?? `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
  return {
    id,
    section: "observations",
    trustRank: 2,
    scopeExact: false,
    relevance: 0.5,
    observedAt: "2026-09-01T00:00:00.000Z",
    targetKey: null,
    rootRefs: [],
    contradicts: false,
    aiGenerated: false,
    sourceBacked: true,
    optional: true,
    priority: 0,
    sourceKey: `memory_item:${id}`,
    ...overrides,
  };
}

describe("selectContextCandidates", () => {
  it("orders trust first: a low-trust high-relevance candidate never outranks verified knowledge", () => {
    const { selected } = selectContextCandidates([
      candidate({ id: "a", section: "current", trustRank: 4, relevance: 0.99 }),
      candidate({ id: "b", section: "current", trustRank: 0, relevance: 0.01 }),
    ]);
    expect(selected.map((entry) => entry.id)).toEqual(["b", "a"]);
  });

  it("prefers exact-branch scope over organization defaults inside a rank", () => {
    const { selected } = selectContextCandidates([
      candidate({ id: "org", section: "current", trustRank: 1, scopeExact: false, relevance: 0.9 }),
      candidate({ id: "branch", section: "current", trustRank: 1, scopeExact: true, relevance: 0.1 }),
    ]);
    expect(selected.map((entry) => entry.id)).toEqual(["branch", "org"]);
  });

  it("keeps current intent only: a later decision for the same target replaces the plan", () => {
    const { selected, excluded } = selectContextCandidates([
      candidate({
        id: "plan",
        section: "intent",
        trustRank: 1,
        targetKey: "rec-1",
        observedAt: "2026-09-01T00:00:00.000Z",
      }),
      candidate({
        id: "dismiss",
        section: "intent",
        trustRank: 1,
        targetKey: "rec-1",
        observedAt: "2026-09-05T00:00:00.000Z",
      }),
    ]);
    // Newer wins the trust tie-break (time orders inside a rank).
    expect(selected.map((entry) => entry.id)).toEqual(["dismiss"]);
    expect(excluded).toEqual([{ id: "plan", code: "SUPERSEDED" }]);
  });

  it("deduplicates one evidence family: same-root repeats add no strength", () => {
    const { selected, excluded } = selectContextCandidates([
      candidate({ id: "a-first", trustRank: 1, rootRefs: ["root-1"] }),
      candidate({ id: "b-echo", trustRank: 1, rootRefs: ["root-1"] }),
    ]);
    expect(selected.map((entry) => entry.id)).toEqual(["a-first"]);
    expect(excluded).toEqual([{ id: "b-echo", code: "DUPLICATE_ROOT" }]);
  });

  it("keeps explicitly opposing evidence with its label instead of merging it away", () => {
    const { selected } = selectContextCandidates([
      candidate({ id: "claim", trustRank: 1, rootRefs: ["root-1"] }),
      candidate({ id: "rebuttal", trustRank: 1, rootRefs: ["root-1"], contradicts: true }),
    ]);
    expect(selected.map((entry) => entry.id).sort()).toEqual(["claim", "rebuttal"]);
  });

  it("keeps conflicting equal-authority facts labeled, never merged", () => {
    const { selected } = selectContextCandidates([
      candidate({ id: "fact-a", section: "current", trustRank: 0, rootRefs: [] }),
      candidate({ id: "fact-b", section: "current", trustRank: 0, rootRefs: [] }),
    ]);
    expect(selected).toHaveLength(2);
  });

  it("caps unverified AI entries in observations at three", () => {
    const { selected, excluded } = selectContextCandidates(
      Array.from({ length: 5 }, (_, index) =>
        candidate({ id: `ai-${index}`, trustRank: 4, aiGenerated: true, sourceBacked: false }),
      ),
    );
    expect(selected).toHaveLength(3);
    expect(excluded).toHaveLength(2);
    expect(excluded.every((entry) => entry.code === "OVER_BUDGET")).toBe(true);
  });

  it("enforces section quotas, pools fifty candidates, and transfers free slots to source-backed observations", () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      candidate({ id: `obs-${index}`, trustRank: 2, relevance: index / 100 }),
    );
    const { selected, excluded } = selectContextCandidates(many);
    const observations = selected.filter((entry) => entry.section === "observations");
    // Quota takes 8; the 16 unused slots from the empty sections transfer to
    // source-backed observations. The global 24-entry cap is the renderer's job.
    expect(observations).toHaveLength(24);
    expect(excluded).toHaveLength(36);
  });

  it("transfers empty slots to current state without raising the AI cap", () => {
    const { selected } = selectContextCandidates([
      ...Array.from({ length: 8 }, (_, index) =>
        candidate({ id: `cur-${index}`, section: "current", trustRank: 1 }),
      ),
    ]);
    // Quota takes 6, 2 overflow; 18 unused slots (intent 6 + observations
    // 8 + lessons 4) rescue both overflowed current candidates.
    expect(selected).toHaveLength(8);
  });

  it("never rescues superseded intent through slot transfer", () => {
    const { selected } = selectContextCandidates([
      candidate({ id: "old", section: "intent", trustRank: 3, targetKey: "t" }),
      candidate({
        id: "new",
        section: "intent",
        trustRank: 0,
        targetKey: "t",
        observedAt: "2026-09-09T00:00:00.000Z",
      }),
    ]);
    expect(selected.map((entry) => entry.id)).toEqual(["new"]);
  });
});
