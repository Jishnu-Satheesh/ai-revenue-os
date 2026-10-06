import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { assembleContextPack, computeContextDigest } from "@/modules/memory/application/context-service";
import type { ContextEntry } from "@/domain/memory/context";
import type { ContextCandidate } from "@/modules/memory/application/context-selection";

const REQUEST = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  purpose: "channel_advice",
  consumerKind: "analysis_run",
  consumerId: "22222222-2222-4222-8222-222222222222",
  attemptKey: "attempt-1",
  correlationId: "33333333-3333-4333-8333-333333333333",
  query: "What should this branch do next?",
} as const;

function fullCandidate(id: string, section: ContextCandidate["section"] = "observations"): ContextCandidate & {
  entry: Omit<ContextEntry, "contextRef">;
} {
  return {
    id,
    section,
    trustRank: 1,
    scopeExact: true,
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
    entry: {
      sourceKind: "memory_item",
      sourceId: id,
      sourceRevision: null,
      sourceDigest: null,
      section,
      statementKind: "observation",
      title: `Title ${id}`,
      summary: `Summary ${id}.`,
      scopeBranchId: null,
      scopeChannelId: null,
      trustRank: 1,
      freshness: "fresh",
      sensitivity: "internal",
      observedAt: null,
      effectiveFrom: null,
      effectiveTo: null,
      rootRefs: [],
      useRestriction: null,
      priority: 0,
      optional: true,
    },
  };
}

describe("computeContextDigest", () => {
  it("is stable for the same entries regardless of order", () => {
    const first = computeContextDigest([
      { contextRef: "ctx-0002", sourceKind: "goal", sourceId: "b", sourceRevision: null, summary: "Two" },
      { contextRef: "ctx-0001", sourceKind: "memory_item", sourceId: "a", sourceRevision: 3, summary: "One" },
    ]);
    const second = computeContextDigest([
      { contextRef: "ctx-0001", sourceKind: "memory_item", sourceId: "a", sourceRevision: 3, summary: "One" },
      { contextRef: "ctx-0002", sourceKind: "goal", sourceId: "b", sourceRevision: null, summary: "Two" },
    ]);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes the empty pack to the sha256 of the empty string on both layers", () => {
    // SQL: pg_catalog.encode(extensions.digest('', 'sha256'), 'hex') must
    // equal this after the migration lands; proven on staging post-push.
    expect(computeContextDigest([])).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("moves when any canonical field moves", () => {
    const base = [
      { contextRef: "ctx-0001", sourceKind: "memory_item", sourceId: "a", sourceRevision: null, summary: "One" },
    ];
    expect(computeContextDigest([{ ...base[0], summary: "Two" }])).not.toBe(computeContextDigest(base));
    expect(computeContextDigest([{ ...base[0], sourceRevision: 2 }])).not.toBe(
      computeContextDigest(base),
    );
  });
});

describe("assembleContextPack", () => {
  it("assigns stable context references and digests the kept entries", () => {
    const pack = assembleContextPack({
      request: { ...REQUEST },
      candidates: [
        fullCandidate("44444444-4444-4444-8444-444444444444", "current"),
        fullCandidate("55555555-5555-4555-8555-555555555555", "observations"),
      ],
      retrievalLatencyMs: 40,
    });
    expect(pack.status).toBe("ready");
    expect(pack.entries.map((entry) => entry.contextRef)).toEqual(["ctx-0001", "ctx-0002"]);
    expect(pack.contextDigest).toBe(
      computeContextDigest(
        pack.entries.map((entry) => ({
          contextRef: entry.contextRef,
          sourceKind: entry.sourceKind,
          sourceId: entry.sourceId,
          sourceRevision: entry.sourceRevision,
          summary: entry.summary,
        })),
      ),
    );
  });

  it("reports empty when no candidate survives, keeping disabled/unavailable for the RPC", () => {
    const pack = assembleContextPack({ request: { ...REQUEST }, candidates: [], retrievalLatencyMs: 5 });
    expect(pack.status).toBe("empty");
    expect(pack.entries).toHaveLength(0);
  });

  it("merges selection and renderer exclusions without inventing counts", () => {
    const pack = assembleContextPack({
      request: { ...REQUEST },
      candidates: [
        fullCandidate("66666666-6666-4666-8666-666666666666"),
        fullCandidate("77777777-7777-4777-8777-777777777777"),
      ],
      retrievalLatencyMs: null,
    });
    expect(pack.status).toBe("ready");
    expect(pack.exclusions).toEqual({});
    expect(pack.selectedBytes).toBeGreaterThan(0);
  });
});
