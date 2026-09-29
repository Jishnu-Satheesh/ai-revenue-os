import { describe, expect, it } from "vitest";

import {
  buildAgentContextPack,
  CONTEXT_PACK_OVERSIZED,
  MAX_CONTEXT_PACK_BYTES,
} from "@/modules/agent-chat/application/context-pack";

describe("context pack", () => {
  it("refuses oversized input instead of trimming", async () => {
    const out = await buildAgentContextPack({
      organizationId: "o",
      userId: "u",
      windowDays: 30,
      page: "overview",
      readers: { load: async () => ({ bytes: 9_999_999 }) },
    });
    expect(out.refused).toBe(true);
  });

  it("refusal carries the safe code, a 16-hex digest, and no sources", async () => {
    const out = await buildAgentContextPack({
      organizationId: "o",
      userId: "u",
      windowDays: 30,
      page: "overview",
      readers: { load: async () => ({ bytes: 9_999_999 }) },
    });
    expect(out.refused).toBe(true);
    expect(out.reasonCode).toBe(CONTEXT_PACK_OVERSIZED);
    expect(out.digest).toMatch(/^[0-9a-f]{16}$/);
    expect(out.sources).toEqual([]);
    expect(out.limitations.length).toBeGreaterThan(0);
    expect(MAX_CONTEXT_PACK_BYTES).toBeLessThan(9_999_999);
  });

  it("mints a stable 16-hex digest for the same pack", async () => {
    const readers = {
      getIdentityFacts: async () => [
        { id: "f1", statement: "Confirmed trading name.", verified: true, source: "profile" },
      ],
    };
    const first = await buildAgentContextPack({
      organizationId: "o",
      userId: "u",
      windowDays: 30,
      page: "overview",
      readers,
      now: "2026-09-20T12:00:00.000Z",
    });
    const second = await buildAgentContextPack({
      organizationId: "o",
      userId: "u",
      windowDays: 30,
      page: "overview",
      readers,
      now: "2026-09-20T12:00:00.000Z",
    });
    expect(first.refused).toBe(false);
    expect(first.digest).toBe(second.digest);
    expect(first.digest).toMatch(/^[0-9a-f]{16}$/);
  });

  it("sorts identity facts verified-first with stable id order", async () => {
    const out = await buildAgentContextPack({
      organizationId: "o",
      userId: "u",
      windowDays: 30,
      page: "overview",
      now: "2026-09-20T12:00:00.000Z",
      readers: {
        getIdentityFacts: async () => [
          { id: "b-unverified", statement: "Draft tagline.", verified: false, source: "draft" },
          { id: "b-verified", statement: "Confirmed name.", verified: true, source: "profile" },
          { id: "a-verified", statement: "Confirmed city.", verified: true, source: "profile" },
        ],
      },
    });
    expect(out.lanes.identity.facts.map((fact) => fact.id)).toEqual([
      "a-verified",
      "b-verified",
      "b-unverified",
    ]);
  });

  it("reports missing evidence as gaps, never zeros", async () => {
    const out = await buildAgentContextPack({
      organizationId: "o",
      userId: "u",
      windowDays: 30,
      page: "overview",
      now: "2026-09-20T12:00:00.000Z",
    });
    expect(out.refused).toBe(false);
    expect(out.lanes.evidence.periods.length).toBeGreaterThan(0);
    for (const period of out.lanes.evidence.periods) {
      expect(period.status).toBe("gap");
      expect(period.valueMinorUnits).toBeNull();
    }
  });

  it("uses an exact-range window labeled in the branch timezone", async () => {
    const out = await buildAgentContextPack({
      organizationId: "o",
      userId: "u",
      branchId: "b1",
      windowDays: 60,
      page: "overview",
      now: "2026-09-20T12:00:00.000Z",
      readers: { resolveBranchTimezone: async () => "Asia/Dubai" },
    });
    expect(out.window.windowDays).toBe(60);
    expect(out.window.startUtc).toBe("2026-07-22T12:00:00.000Z");
    expect(out.window.endUtc).toBe("2026-09-20T12:00:00.000Z");
    expect(out.window.branchTimezone).toBe("Asia/Dubai");
    expect(out.lanes.page.branchId).toBe("b1");
  });

  it("preserves the branch-timezone failure flag when the reader throws", async () => {
    const out = await buildAgentContextPack({
      organizationId: "o",
      userId: "u",
      branchId: "b1",
      windowDays: 30,
      page: "overview",
      now: "2026-09-20T12:00:00.000Z",
      readers: {
        resolveBranchTimezone: async () => {
          throw new Error("timezone store down");
        },
      },
    });
    expect(out.window.branchTimezone).toBe("UTC");
    expect(out.limitations).toContain(
      "Branch timezone unavailable; evidence window labels render in UTC.",
    );
  });

  it("keeps economics to an availability tier and timeline dates distinct", async () => {
    const out = await buildAgentContextPack({
      organizationId: "o",
      userId: "u",
      windowDays: 30,
      page: "overview",
      now: "2026-09-20T12:00:00.000Z",
      readers: {
        getEconomicsReadiness: async () => ({
          availability: "ready",
          quality: "high",
          workbookTotalMinorUnits: 999_999,
        }),
        getTimeline: async () => [
          {
            id: "t1",
            kind: "decision",
            activityAt: "2026-09-18T10:00:00.000Z",
            evidenceAt: "2026-09-19T10:00:00.000Z",
          },
        ],
        getMarketProfile: async () => ({ status: "current", versionId: "v1", digest: "abc123" }),
        searchMemory: async () => [
          { id: "m1", provenance: "decision-log", recordedAt: "2026-09-19T10:00:00.000Z" },
        ],
      },
    });
    expect(out.lanes.economics).toEqual({ availability: "ready", quality: "high" });
    expect(JSON.stringify(out)).not.toContain("workbookTotalMinorUnits");
    expect(out.lanes.timeline.entries[0]?.activityAt).not.toBe(
      out.lanes.timeline.entries[0]?.evidenceAt,
    );
    expect(out.sources).toContain("v1");
    expect(out.sources).toContain("m1");
    expect(out.sources).toContain("t1");
  });

  it("rejects an invalid window instead of coercing it", async () => {
    await expect(
      buildAgentContextPack({
        organizationId: "o",
        userId: "u",
        windowDays: 44 as unknown as 30,
        page: "overview",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("turns a throwing reader into an honest gap, not a crash", async () => {
    const out = await buildAgentContextPack({
      organizationId: "o",
      userId: "u",
      windowDays: 30,
      page: "overview",
      now: "2026-09-20T12:00:00.000Z",
      readers: {
        getIdentityFacts: () => {
          throw new Error("reader down");
        },
      },
    });
    expect(out.refused).toBe(false);
    expect(out.lanes.identity.facts).toEqual([]);
    expect(out.limitations.some((line) => line.includes("Business identity"))).toBe(true);
  });

  it("refuses lane overflow instead of trimming rows", async () => {
    const out = await buildAgentContextPack({
      organizationId: "o",
      userId: "u",
      windowDays: 30,
      page: "overview",
      now: "2026-09-20T12:00:00.000Z",
      readers: {
        searchMemory: async () =>
          Array.from({ length: 101 }, (_, index) => ({
            id: `m${index}`,
            provenance: "log",
            recordedAt: "2026-09-19T10:00:00.000Z",
          })),
      },
    });
    expect(out.refused).toBe(true);
    expect(out.reasonCode).toBe(CONTEXT_PACK_OVERSIZED);
  });
});

describe("context pack evidence auto-widening (H3)", () => {
  const NOW = "2026-09-20T12:00:00.000Z";

  function covered(valueMinorUnits = 1200) {
    return {
      periodStartUtc: "2026-08-06T12:00:00.000Z",
      periodEndUtc: NOW,
      status: "covered",
      valueMinorUnits,
      currency: "AED",
    };
  }

  it("widens an empty 30-day window to the first rung with governed evidence and records it", async () => {
    const calls: number[] = [];
    const out = await buildAgentContextPack({
      organizationId: "o",
      userId: "u",
      windowDays: 30,
      page: "overview",
      now: NOW,
      readers: {
        getEvidence: async (scope: { windowDays: number }) => {
          calls.push(scope.windowDays);
          return scope.windowDays === 30 ? [] : [covered()];
        },
      },
    });
    expect(calls).toEqual([30, 45]);
    expect(out.refused).toBe(false);
    expect(out.window.windowDays).toBe(45);
    expect(out.windowDays).toBe(45);
    expect(out.window.startUtc).toBe("2026-08-06T12:00:00.000Z");
    expect(out.window.endUtc).toBe(NOW);
    expect(out.lanes.evidence.periods.some((period) => period.status === "covered")).toBe(true);
  });

  it("treats an all-gap rung as empty and keeps widening", async () => {
    const calls: number[] = [];
    const out = await buildAgentContextPack({
      organizationId: "o",
      userId: "u",
      windowDays: 30,
      page: "overview",
      now: NOW,
      readers: {
        getEvidence: async (scope: { windowDays: number }) => {
          calls.push(scope.windowDays);
          if (scope.windowDays < 60) {
            return [
              {
                periodStartUtc: "2026-08-21T12:00:00.000Z",
                periodEndUtc: NOW,
                status: "gap",
                valueMinorUnits: null,
              },
            ];
          }
          return [covered()];
        },
      },
    });
    expect(calls).toEqual([30, 45, 60]);
    expect(out.window.windowDays).toBe(60);
    expect(out.windowDays).toBe(60);
    expect(out.lanes.evidence.periods.some((period) => period.status === "covered")).toBe(true);
  });

  it("reads only the requested window when it already holds governed evidence", async () => {
    const calls: number[] = [];
    const out = await buildAgentContextPack({
      organizationId: "o",
      userId: "u",
      windowDays: 30,
      page: "overview",
      now: NOW,
      readers: {
        getEvidence: async (scope: { windowDays: number }) => {
          calls.push(scope.windowDays);
          return [covered()];
        },
      },
    });
    expect(calls).toEqual([30]);
    expect(out.window.windowDays).toBe(30);
    expect(out.windowDays).toBe(30);
  });

  it("stays honest when every rung is empty", async () => {
    const out = await buildAgentContextPack({
      organizationId: "o",
      userId: "u",
      windowDays: 30,
      page: "overview",
      now: NOW,
      readers: { getEvidence: async () => [] },
    });
    expect(out.refused).toBe(false);
    expect(out.window.windowDays).toBe(120);
    expect(out.windowDays).toBe(120);
    expect(out.lanes.evidence.periods.length).toBeGreaterThan(0);
    for (const period of out.lanes.evidence.periods) {
      expect(period.status).toBe("gap");
      expect(period.valueMinorUnits).toBeNull();
    }
    expect(out.limitations.join(" ")).toMatch(/widening/i);
    expect(out.limitations.join(" ")).toMatch(/no governed evidence/i);
  });

  it("accepts the widened window literals", async () => {
    for (const windowDays of [45, 90, 120] as const) {
      const out = await buildAgentContextPack({
        organizationId: "o",
        userId: "u",
        windowDays,
        page: "overview",
        now: NOW,
        readers: { getEvidence: async () => [covered()] },
      });
      expect(out.refused).toBe(false);
      expect(out.window.windowDays).toBe(windowDays);
      expect(out.windowDays).toBe(windowDays);
    }
  });

  it("refuses instead of trimming when a widened window overflows the period cap", async () => {
    const out = await buildAgentContextPack({
      organizationId: "o",
      userId: "u",
      windowDays: 30,
      page: "overview",
      now: NOW,
      readers: {
        getEvidence: async (scope: { windowDays: number }) => {
          if (scope.windowDays < 120) return [];
          return Array.from({ length: 121 }, (_, index) => ({
            periodStartUtc: `2026-05-24T00:00:00.${String(index).padStart(3, "0")}Z`,
            periodEndUtc: NOW,
            status: "covered",
            valueMinorUnits: 100 + index,
            currency: "AED",
          }));
        },
      },
    });
    expect(out.refused).toBe(true);
    expect(out.reasonCode).toBe(CONTEXT_PACK_OVERSIZED);
  });
});
