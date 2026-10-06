import { describe, expect, it, vi } from "vitest";

import {
  assessChannelForAgent,
  type ChannelAssessmentReads,
} from "@/modules/agent-chat/application/channel-assessment";

const ORG = "10000000-0000-4000-8000-000000000001";
const CHANNEL = "20000000-0000-4000-8000-000000000002";
const RUN = "30000000-0000-4000-8000-000000000003";

function input(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    actorId: "40000000-0000-4000-8000-000000000004",
    role: "operator" as const,
    question: "How has Talabat been doing these days?",
    correlationId: "50000000-0000-4000-8000-000000000005",
    now: "2026-10-01T12:00:00.000Z",
    allowDispatch: true,
    ...overrides,
  };
}

function reads(overrides: Partial<ChannelAssessmentReads> = {}): ChannelAssessmentReads {
  return {
    listChannels: async () => [
      { id: CHANNEL, key: "talabat", displayName: "Talabat", status: "active", aliases: [] },
    ],
    loadWindows: async () => [
      {
        windowStart: "2026-08-01",
        windowEnd: "2026-08-31",
        grain: "month",
        governedRowCount: 12,
        timeZone: "Asia/Dubai",
      },
    ],
    resolveWindow: async (_channelId, from, to) => ({
      windowStart: from,
      windowEnd: to,
      grain: "month",
      timeZone: "Asia/Dubai",
    }),
    currentRun: async () => ({ kind: "ready", analysisRunId: RUN }),
    loadRunForWindow: async () => ({ id: RUN, status: "completed", findingCount: 1 }),
    readResult: async () => ({
      findings: [{ id: "finding-1", kind: "observation", code: "ORDER_CANCELLATION_LOSS" }],
      recommendations: [
        {
          id: "rec-1",
          label: "recommendation",
          headline: "Reduce cancellations",
          detail: "Review stock accuracy.",
          supportedActions: ["Check unavailable items daily."],
          citationFindingIds: ["finding-1"],
        },
      ],
    }),
    consumeAllowance: vi.fn(async () => true),
    dispatchAnalysis: vi.fn(async () => true),
    dispatchNarration: vi.fn(async () => true),
    ...overrides,
  };
}

describe("bounded channel assessment", () => {
  it("waits for a new dispatched run while an older failed run is still the newest row", async () => {
    const pending = "30000000-0000-4000-8000-000000000099";
    const deps = reads({
      currentRun: async () => ({ kind: "failed" }),
      loadRunForWindow: async () => ({ id: RUN, status: "failed", findingCount: 0 }),
    });
    const result = await assessChannelForAgent(input({ pendingAnalysisRunId: pending }), deps);
    expect(result).toMatchObject({
      status: "in_progress",
      runId: pending,
      stage: "analysis_started",
    });
    expect(deps.dispatchAnalysis).not.toHaveBeenCalled();
  });
  it("reports the failure only when it belongs to the dispatched run", async () => {
    const deps = reads({
      currentRun: async () => ({ kind: "failed" }),
      loadRunForWindow: async () => ({ id: RUN, status: "failed", findingCount: 0 }),
    });
    const result = await assessChannelForAgent(input({ pendingAnalysisRunId: RUN }), deps);
    expect(result).toMatchObject({ status: "not_available", reason: "dispatch_failed" });
    expect(deps.dispatchAnalysis).not.toHaveBeenCalled();
  });
  it("uses the explicitly named period in the question before choosing recent coverage", async () => {
    const currentRun = vi.fn(async () => ({ kind: "ready" as const, analysisRunId: RUN }));
    const result = await assessChannelForAgent(
      input({ question: "How was Talabat doing during 2026-08-01 to 2026-08-31?" }),
      reads({ currentRun }),
    );
    expect(result).toMatchObject({
      status: "ready",
      period: { start: "2026-08-01", end: "2026-08-31" },
      periodSwitch: null,
    });
    expect(currentRun).toHaveBeenCalledWith(
      expect.objectContaining({ windowStart: "2026-08-01", windowEnd: "2026-08-31" }),
    );
  });
  it("reuses a current Talabat run with a citable result and exact audit link", async () => {
    const result = await assessChannelForAgent(input(), reads());

    expect(result).toMatchObject({
      status: "ready",
      channelId: CHANNEL,
      runId: RUN,
      auditHref: `/organizations/${ORG}/channels/${CHANNEL}?runId=${RUN}`,
      evidenceRefs: ["finding-1", "rec-1"],
      periodSwitch: {
        selectedStart: "2026-08-01",
        selectedEnd: "2026-08-31",
      },
    });
    if (result.status === "ready")
      expect(result.summary).toContain("Suggested action: Reduce cancellations");
  });

  it("asks for the channel when more than one organization channel matches", async () => {
    const deps = reads({
      listChannels: async () => [
        { id: CHANNEL, key: "talabat", displayName: "Talabat", status: "active", aliases: [] },
        {
          id: "20000000-0000-4000-8000-000000000099",
          key: "talabat-mart",
          displayName: "Talabat Mart",
          status: "active",
          aliases: ["Talabat"],
        },
      ],
    });
    const result = await assessChannelForAgent(input(), deps);
    expect(result).toMatchObject({ status: "needs_scope", field: "channel" });
    expect(deps.dispatchAnalysis).not.toHaveBeenCalled();
  });

  it("does not create an analysis when no governed window exists", async () => {
    const deps = reads({ loadWindows: async () => [] });
    const result = await assessChannelForAgent(input(), deps);
    expect(result).toMatchObject({ status: "not_available", reason: "no_governed_report" });
    expect(deps.dispatchAnalysis).not.toHaveBeenCalled();
  });

  it("keeps attached reports on their exact period without substituting older coverage", async () => {
    const deps = reads();
    const result = await assessChannelForAgent(
      {
        ...input(),
        channelId: CHANNEL,
        from: "2026-09-01",
        to: "2026-09-30",
        allowPeriodFallback: false,
      },
      deps,
    );
    expect(result).toMatchObject({
      status: "not_available",
      reason: "no_governed_report",
      period: { start: "2026-09-01", end: "2026-09-30" },
    });
    expect(deps.dispatchAnalysis).not.toHaveBeenCalled();
  });

  it("dispatches analysis for the verified report branch", async () => {
    const branchId = "60000000-0000-4000-8000-000000000006";
    const deps = reads({ currentRun: async () => ({ kind: "missing" }) });
    await assessChannelForAgent(
      {
        ...input(),
        branchId,
        channelId: CHANNEL,
        from: "2026-08-01",
        to: "2026-08-31",
        allowPeriodFallback: false,
      },
      deps,
    );
    expect(deps.dispatchAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        branchId,
        channelId: CHANNEL,
        windowStart: "2026-08-01",
        windowEnd: "2026-08-31",
      }),
    );
  });

  it("starts missing analysis once through the permission and allowance gate", async () => {
    const deps = reads({ currentRun: async () => ({ kind: "missing" }) });
    const result = await assessChannelForAgent(input(), deps);
    expect(result).toMatchObject({
      status: "in_progress",
      stage: "analysis_started",
      channelId: CHANNEL,
    });
    expect(deps.consumeAllowance).toHaveBeenCalledOnce();
    expect(deps.dispatchAnalysis).toHaveBeenCalledOnce();
  });

  it("waits on a persisted pending dispatch before the source worker creates its run", async () => {
    const deps = reads({ currentRun: async () => ({ kind: "missing" }) });
    const result = await assessChannelForAgent({ ...input(), pendingAnalysisRunId: RUN }, deps);
    expect(result).toMatchObject({ status: "in_progress", runId: RUN });
    expect(deps.dispatchAnalysis).not.toHaveBeenCalled();
    expect(deps.consumeAllowance).not.toHaveBeenCalled();
  });

  it("never dispatches when a viewer asks about a missing run", async () => {
    const deps = reads({ currentRun: async () => ({ kind: "missing" }) });
    const result = await assessChannelForAgent(input({ role: "viewer" }), deps);
    expect(result).toMatchObject({
      status: "not_available",
      reason: "analysis_permission_required",
    });
    expect(deps.consumeAllowance).not.toHaveBeenCalled();
    expect(deps.dispatchAnalysis).not.toHaveBeenCalled();
  });

  it("wakes only narration for a current completed run with pending advice", async () => {
    const deps = reads({ currentRun: async () => ({ kind: "narrating", analysisRunId: RUN }) });
    const result = await assessChannelForAgent(input(), deps);
    expect(result).toMatchObject({ status: "in_progress", stage: "narrating", runId: RUN });
    expect(deps.dispatchNarration).toHaveBeenCalledOnce();
    expect(deps.dispatchAnalysis).not.toHaveBeenCalled();
  });

  it("reuses a zero-finding terminal result without waking narration", async () => {
    const deps = reads({
      loadRunForWindow: async () => ({ id: RUN, status: "completed", findingCount: 0 }),
      readResult: async () => ({ findings: [], recommendations: [] }),
    });
    const result = await assessChannelForAgent(input(), deps);
    expect(result).toMatchObject({ status: "ready", evidenceRefs: [] });
    if (result.status === "ready") expect(result.summary).toContain("no findings");
    expect(deps.dispatchNarration).not.toHaveBeenCalled();
  });
});
