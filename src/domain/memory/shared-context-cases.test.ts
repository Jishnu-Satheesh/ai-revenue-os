import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildMemoryItemSummary } from "@/domain/memory/context";
import {
  SHARED_CONTEXT_CASES,
  type SharedContextCase,
} from "@/domain/memory/__fixtures__/shared-context-cases";
import { assembleContextPack } from "@/modules/memory/application/context-service";
import {
  renderContextPack,
  serializeForModel,
} from "@/modules/memory/application/context-renderer";

/**
 * Frozen corpus runner (Spec 023 Task 13). Each case asserts independently
 * hand-computed expectations, so a failure names the behavior that moved.
 * Digest pairs prove stability and sensitivity without golden files that a
 * change could silently regenerate.
 */

const packDigests = new Map<string, string>();

function sourceKeysOf(pack: { entries: { sourceKind: string; sourceId: string }[] }): string[] {
  return pack.entries.map((entry) => `${entry.sourceKind}:${entry.sourceId}`);
}

function runAssemble(case_: SharedContextCase) {
  return assembleContextPack({
    request: case_.request,
    candidates: case_.candidates,
    retrievalLatencyMs: null,
  });
}

describe("frozen shared-context corpus", () => {
  it("holds forty cases plus five digest mates", () => {
    expect(SHARED_CONTEXT_CASES).toHaveLength(45);
    expect(new Set(SHARED_CONTEXT_CASES.map((c) => c.id)).size).toBe(45);
  });

  it.each(SHARED_CONTEXT_CASES.filter((c) => c.expect.kind === "assemble").map((c) => [c.id, c]))(
    "%s",
    (_id, case_) => {
      const pack = runAssemble(case_);
      packDigests.set(case_.id, pack.contextDigest);
      const expect_ = case_.expect;
      if (expect_.kind !== "assemble") throw new Error("unreachable");
      if (expect_.status !== undefined) expect(pack.status).toBe(expect_.status);
      if (expect_.sourceKeys !== undefined) expect(sourceKeysOf(pack)).toEqual(expect_.sourceKeys);
      if (expect_.exclusions !== undefined) expect(pack.exclusions).toEqual(expect_.exclusions);
      if (expect_.maxBytes !== undefined) {
        expect(pack.selectedBytes).toBeLessThanOrEqual(expect_.maxBytes);
        expect(pack.entries.length).toBeLessThanOrEqual(24);
      }
      if (expect_.digest !== undefined) expect(pack.contextDigest).toBe(expect_.digest);
      if (expect_.summaryChars !== undefined) {
        const found = pack.entries.find((e) => e.contextRef === expect_.summaryChars?.ref);
        expect(found).toBeDefined();
        expect(Array.from(found?.summary ?? "")).toHaveLength(expect_.summaryChars?.chars ?? -1);
      }
      if (expect_.entryFields !== undefined) {
        for (const [sourceKey, fields] of Object.entries(expect_.entryFields)) {
          const found = pack.entries.find((e) => `${e.sourceKind}:${e.sourceId}` === sourceKey);
          expect(found).toBeDefined();
          expect(found).toMatchObject(fields);
        }
      }
      const serialized =
        expect_.serializedContains !== undefined || expect_.serializedAbsent !== undefined
          ? serializeForModel({
              status: pack.status,
              entries: pack.entries,
              degradedReasons: pack.degradedReasons,
            })
          : "";
      for (const needle of expect_.serializedContains ?? []) expect(serialized).toContain(needle);
      for (const needle of expect_.serializedAbsent ?? []) expect(serialized).not.toContain(needle);
    },
  );

  it.each(SHARED_CONTEXT_CASES.filter((c) => c.expect.kind === "render").map((c) => [c.id, c]))(
    "%s",
    (_id, case_) => {
      const expect_ = case_.expect;
      if (expect_.kind !== "render" || !case_.rawEntries) throw new Error("unreachable");
      const rendered = renderContextPack({ entries: case_.rawEntries, retrievalLatencyMs: null });
      if (expect_.status !== undefined) expect(rendered.status).toBe(expect_.status);
      if (expect_.keptRefs !== undefined) {
        expect(rendered.entries.map((e) => e.contextRef)).toEqual(expect_.keptRefs);
      }
      if (expect_.exclusions !== undefined) expect(rendered.exclusions).toEqual(expect_.exclusions);
      if (expect_.maxBytes !== undefined)
        expect(rendered.selectedBytes).toBeLessThanOrEqual(expect_.maxBytes);
      if (expect_.degradedContains !== undefined) {
        for (const needle of expect_.degradedContains)
          expect(rendered.degradedReasons).toContain(needle);
      }
    },
  );

  it.each(SHARED_CONTEXT_CASES.filter((c) => c.expect.kind === "throws").map((c) => [c.id, c]))(
    "%s",
    (_id, case_) => {
      expect(() => runAssemble(case_)).toThrow();
    },
  );

  it.each(SHARED_CONTEXT_CASES.filter((c) => c.expect.kind === "unit").map((c) => [c.id, c]))(
    "%s",
    (_id, case_) => {
      const expect_ = case_.expect;
      if (expect_.kind !== "unit") throw new Error("unreachable");
      expect(buildMemoryItemSummary(expect_.input)).toBe(expect_.expected);
    },
  );

  it("keeps digests stable across input order and sensitive to content", () => {
    for (const case_ of SHARED_CONTEXT_CASES) {
      if (case_.digestEquals) {
        expect(packDigests.get(case_.id)).toBe(packDigests.get(case_.digestEquals));
      }
      if (case_.digestDiffers) {
        expect(packDigests.get(case_.id)).not.toBe(packDigests.get(case_.digestDiffers));
      }
    }
    expect(packDigests.size).toBeGreaterThan(30);
  });
});
