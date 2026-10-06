import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: {} }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/modules/memory/application/api", () => ({ createMemoryWorkspaceApi: vi.fn() }));

import {
  assembleAgentAdviceContext,
  sharedAgentMemoryCeiling,
} from "@/modules/agent-chat/application/advice-context-reader";

const ORG = "10000000-0000-4000-8000-000000000001";
const CHANNEL = "20000000-0000-4000-8000-000000000002";
const base = {
  organizationId: ORG,
  actorId: "30000000-0000-4000-8000-000000000003",
  role: "operator" as const,
  question: "What should I do to improve the business this month?",
  correlationId: "40000000-0000-4000-8000-000000000004",
  timeZone: "Asia/Dubai",
  now: "2026-10-01T10:00:00.000Z",
};

function observation(id: string, month: string) {
  return {
    id,
    channelId: CHANNEL,
    branchId: null,
    metricKey: "revenue.gross",
    grain: "month" as const,
    periodStartDate: `${month}-01`,
    periodEndDate: month === "2026-08" ? "2026-08-31" : "2026-09-30",
    periodTimezone: "Asia/Dubai",
    valueKind: "money" as const,
    numerator: 100_000,
    currency: "AED",
    qualityTier: "measured" as const,
    dimensions: {},
  };
}

describe("agent advice context from source reads", () => {
  it("excludes other channel and period advice from an attached report assessment", async () => {
    const candidate = {
      id: "rec",
      kind: "recommendation" as const,
      title: "Action",
      supportingText: "Check conversion.",
      href: null,
      key: null,
      sourceRevision: null,
      sourceWindowStart: "2026-09-01",
      sourceWindowEnd: "2026-09-30",
      channelIds: [CHANNEL],
      branchIds: [],
      sourceStatus: null,
      evidenceRefs: [],
      relation: "general" as const,
      permission: "growth_intelligence.read" as const,
    };
    const context = await assembleAgentAdviceContext(
      {
        ...base,
        channelId: CHANNEL,
        requestedPeriod: { start: "2026-09-01", end: "2026-09-30" },
        allowPeriodFallback: false,
      },
      {
        readCandidates: async () => ({
          candidates: [
            candidate,
            { ...candidate, id: "other-channel", channelIds: ["other"] },
            {
              ...candidate,
              id: "other-month",
              sourceWindowStart: "2026-08-01",
              sourceWindowEnd: "2026-08-31",
            },
          ],
          laneErrors: {},
        }),
        readMemory: async () => [],
        readEvidence: async () => [],
      },
    );
    expect(context.entries.map((entry) => entry.sourceId)).toEqual(["rec"]);
  });
  it("switches an empty completed month to the latest comparable governed month", async () => {
    const context = await assembleAgentAdviceContext(base, {
      readCandidates: async () => ({ candidates: [], laneErrors: {} }),
      readMemory: async () => [],
      readEvidence: async ({ windowStart }) =>
        windowStart === "2026-08-01" ? [observation("metric-aug", "2026-08")] : [],
    });

    expect(context.periodSwitch).toEqual({
      requestedStart: "2026-09-01",
      requestedEnd: "2026-09-30",
      selectedStart: "2026-08-01",
      selectedEnd: "2026-08-31",
      reason: "The requested period has no usable governed report.",
    });
    expect(context.entries.find((entry) => entry.sourceId === "metric-aug")?.detail).toContain(
      "AED",
    );
    expect(context.entries.find((entry) => entry.sourceId === "metric-aug")?.detail).toContain(
      "minor units",
    );
  });

  it("does not turn a failed current read into an empty period or switch", async () => {
    const context = await assembleAgentAdviceContext(base, {
      readCandidates: async () => ({ candidates: [], laneErrors: {} }),
      readMemory: async () => [],
      readEvidence: async () => {
        throw new Error("unavailable");
      },
    });

    expect(context.periodSwitch).toBeNull();
    expect(context.limitations).toContain("Governed evidence could not be read.");
  });

  it("does not substitute another report period for an attached report", async () => {
    const readEvidence = vi.fn(async () => []);
    const context = await assembleAgentAdviceContext(
      { ...base, allowPeriodFallback: false },
      {
        readCandidates: async () => ({ candidates: [], laneErrors: {} }),
        readMemory: async () => [],
        readEvidence,
      },
    );
    expect(readEvidence).toHaveBeenCalledTimes(1);
    expect(context.periodSwitch).toBeNull();
  });

  it("keeps candidate advice and Memory as distinct cited sources", async () => {
    const context = await assembleAgentAdviceContext(
      { ...base, requestedPeriod: { start: "2026-09-01", end: "2026-09-30" } },
      {
        readCandidates: async () => ({
          candidates: [
            {
              id: "rec:one",
              kind: "recommendation",
              title: "Improve menu conversion",
              supportingText: "Check menu views against orders.",
              href: `/organizations/${ORG}/growth-intelligence`,
              key: null,
              sourceRevision: null,
              sourceWindowStart: "2026-08-01",
              sourceWindowEnd: "2026-08-31",
              channelIds: [CHANNEL],
              branchIds: [],
              sourceStatus: null,
              evidenceRefs: ["finding-1"],
              relation: "general",
              permission: "growth_intelligence.read",
            },
          ],
          laneErrors: {},
        }),
        readMemory: async () => [
          {
            itemId: "50000000-0000-4000-8000-000000000005",
            title: "Service constraint",
            body: "The kitchen cannot add another shift.",
            provenance: "verified operator note",
            observedAt: "2026-08-15T00:00:00.000Z",
          },
        ],
        readEvidence: async () => [],
      },
    );

    expect(context.entries.map((entry) => entry.sourceId)).toContain("rec:one");
    expect(context.entries.map((entry) => entry.sourceId)).toContain(
      "memory:50000000-0000-4000-8000-000000000005",
    );
    expect(context.entries.find((entry) => entry.kind === "memory")?.detail).toContain(
      "kitchen cannot add another shift",
    );
  });

  it("does not satisfy required measures by borrowing one from another channel", async () => {
    const otherChannel = "20000000-0000-4000-8000-000000000099";
    const context = await assembleAgentAdviceContext(
      { ...base, requiredMetricKeys: ["revenue.gross", "revenue.net"] },
      {
        readCandidates: async () => ({ candidates: [], laneErrors: {} }),
        readMemory: async () => [],
        readEvidence: async ({ windowStart }) =>
          windowStart === "2026-08-01"
            ? [
                observation("revenue-aug", "2026-08"),
                {
                  ...observation("net-aug", "2026-08"),
                  channelId: otherChannel,
                  metricKey: "revenue.net",
                },
              ]
            : [],
      },
    );

    expect(context.periodSwitch).toBeNull();
    expect(context.entries.filter((entry) => entry.kind === "channel")).toEqual([]);
  });

  it("moves an explicit seven-day question to the preceding seven days", async () => {
    const requested = { start: "2026-09-15", end: "2026-09-21" };
    const context = await assembleAgentAdviceContext(
      { ...base, requestedPeriod: requested },
      {
        readCandidates: async () => ({ candidates: [], laneErrors: {} }),
        readMemory: async () => [],
        readEvidence: async ({ windowStart, windowEnd }) =>
          windowStart === "2026-09-08" && windowEnd === "2026-09-14"
            ? [
                {
                  ...observation("metric-prior-week", "2026-08"),
                  grain: "week" as const,
                  periodStartDate: "2026-09-08",
                  periodEndDate: "2026-09-14",
                },
              ]
            : [],
      },
    );

    expect(context.periodSwitch).toMatchObject({
      requestedStart: "2026-09-15",
      requestedEnd: "2026-09-21",
      selectedStart: "2026-09-08",
      selectedEnd: "2026-09-14",
    });
  });
});

it("keeps owner-derived shared chat history below the sensitive Memory boundary", () => {
  for (const role of ["owner", "admin", "operator", "viewer"] as const) {
    expect(sharedAgentMemoryCeiling({ userId: base.actorId, role })).toBe("internal");
  }
});
