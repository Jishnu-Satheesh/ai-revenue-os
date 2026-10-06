import { describe, expect, it } from "vitest";

import {
  CONTEXT_MAX_BYTES,
  type ContextEntry,
} from "@/domain/memory/context";
import {
  groupBySection,
  renderContextPack,
  serializeForModel,
} from "@/modules/memory/application/context-renderer";

let sequence = 0;

function entry(overrides: Partial<ContextEntry> = {}): ContextEntry {
  sequence += 1;
  const ref = overrides.contextRef ?? `ctx-${String(sequence).padStart(4, "0")}`;
  return {
    contextRef: ref,
    sourceKind: "memory_item",
    sourceId: `11111111-1111-4111-8111-${String(sequence).padStart(12, "0")}`,
    sourceRevision: null,
    sourceDigest: null,
    section: "observations",
    statementKind: "observation",
    title: `Entry ${ref}`,
    summary: `Summary ${ref}.`,
    scopeBranchId: null,
    scopeChannelId: null,
    trustRank: 2,
    freshness: "fresh",
    sensitivity: "internal",
    observedAt: null,
    effectiveFrom: null,
    effectiveTo: null,
    rootRefs: [],
    useRestriction: null,
    priority: 0,
    optional: true,
    ...overrides,
  };
}

describe("renderContextPack", () => {
  it("caps a 601-character summary at 600 without touching shorter ones", () => {
    const rendered = renderContextPack({
      entries: [entry({ summary: "a".repeat(601) }), entry({ summary: "short" })],
      retrievalLatencyMs: 12,
    });
    expect(rendered.status).toBe("ready");
    expect([...rendered.entries[0].summary].length).toBeLessThanOrEqual(600);
    expect(rendered.entries.find((item) => item.summary === "short")).toBeDefined();
  });

  it("drops the lowest-priority optional entries first when bytes overflow", () => {
    // Summaries cap at 600 chars, so byte overflow needs multibyte text:
    // one 𐀀 is 4 bytes, 600 of them 2400 bytes.
    const big = "𐀀".repeat(600);
    const rendered = renderContextPack({
      entries: [
        entry({ contextRef: "ctx-0001", summary: big, priority: 10 }),
        entry({ contextRef: "ctx-0002", summary: big, priority: 1 }),
        ...[3, 4, 5, 6, 7, 8].map((slot) =>
          entry({ contextRef: `ctx-000${slot}`, summary: big, priority: slot }),
        ),
        entry({ contextRef: "ctx-0009", summary: "small", priority: 20 }),
      ],
      retrievalLatencyMs: null,
    });
    // 8 × 2400 + 5 overflows 16384 twice over: priorities 1 and 3 drop, the rest fits.
    expect(rendered.entries.map((item) => item.contextRef).sort()).toEqual([
      "ctx-0001",
      "ctx-0004",
      "ctx-0005",
      "ctx-0006",
      "ctx-0007",
      "ctx-0008",
      "ctx-0009",
    ]);
    expect(rendered.exclusions["OVER_BUDGET"]).toBe(2);
    expect(rendered.selectedBytes).toBeLessThanOrEqual(CONTEXT_MAX_BYTES);
  });

  it("returns partial with a safe reason when mandatory context cannot fit", () => {
    const big = "𐀀".repeat(600);
    const rendered = renderContextPack({
      entries: Array.from({ length: 8 }, (_, index) =>
        entry({ contextRef: `ctx-000${index + 1}`, summary: big, optional: false, priority: 0 }),
      ),
      retrievalLatencyMs: null,
    });
    expect(rendered.status).toBe("partial");
    expect(rendered.degradedReasons).toContain("MANDATORY_OVERFLOW");
  });

  it("enforces the 24-entry cap deterministically", () => {
    const rendered = renderContextPack({
      entries: Array.from({ length: 30 }, (_, index) =>
        entry({ contextRef: `ctx-${String(index).padStart(4, "0")}`, priority: index }),
      ),
      retrievalLatencyMs: null,
    });
    expect(rendered.entries).toHaveLength(24);
    // Lowest priority (0–5) drops first.
    expect(rendered.entries.some((item) => item.contextRef === "ctx-0000")).toBe(false);
    expect(rendered.entries.some((item) => item.contextRef === "ctx-0029")).toBe(true);
  });

  it("builds canonical text over the kept entries only", () => {
    const rendered = renderContextPack({ entries: [entry({ contextRef: "ctx-0001", summary: " kept " })], retrievalLatencyMs: null });
    expect(rendered.canonicalText).toContain("ctx-0001|memory_item");
    expect(rendered.canonicalText).toContain(" kept ");
  });
});

describe("serializeForModel", () => {
  it("escapes malicious text instead of executing it", () => {
    const output = serializeForModel({
      status: "ready",
      entries: [
        entry({
          title: "<img src=x onerror=alert(1)>",
          summary: "Use <b>this</b> & that.",
        }),
      ],
      degradedReasons: [],
    });
    expect(output).not.toContain("<img");
    expect(output).not.toContain("<b>");
    expect(output).toContain("&lt;img");
    expect(output).toContain("status=ready");
  });

  it("states partial status up front so a partial pack is never mistaken for complete context", () => {
    const output = serializeForModel({ status: "partial", entries: [], degradedReasons: ["MANDATORY_OVERFLOW"] });
    expect(output).toContain("[context status=partial]");
    expect(output).toContain("MANDATORY_OVERFLOW");
  });
});

describe("groupBySection", () => {
  it("splits entries into the four pack sections", () => {
    const grouped = groupBySection([
      entry({ section: "current" }),
      entry({ section: "lessons" }),
    ]);
    expect(grouped.current).toHaveLength(1);
    expect(grouped.lessons).toHaveLength(1);
    expect(grouped.intent).toHaveLength(0);
    expect(grouped.observations).toHaveLength(0);
  });
});
