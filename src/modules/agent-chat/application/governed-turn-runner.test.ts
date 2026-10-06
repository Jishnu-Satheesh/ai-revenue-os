import { describe, expect, it, vi } from "vitest";

import { runGovernedAgentTurn } from "@/modules/agent-chat/application/governed-turn-runner";

const ids = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  turnId: "20000000-0000-4000-8000-000000000002",
  threadId: "30000000-0000-4000-8000-000000000003",
  userMessageId: "40000000-0000-4000-8000-000000000004",
  actorId: "50000000-0000-4000-8000-000000000005",
  leaseToken: "60000000-0000-4000-8000-000000000006",
};

function businessPorts() {
  const periodSwitch = {
    requestedStart: "2026-09-01",
    requestedEnd: "2026-09-30",
    selectedStart: "2026-08-01",
    selectedEnd: "2026-08-31",
    reason: "The requested period has no usable governed report.",
  };
  return {
    currentRole: vi.fn(async () => "viewer" as const),
    readAdvice: vi.fn(async () => ({ entries: [], limitations: [], periodSwitch })),
    readPack: vi.fn(async () => null),
    assessChannel: vi.fn(),
    answer: vi.fn(async (input: { question: string }) => ({
      body: `First week: establish a baseline for ${input.question}`,
      citations: [],
      limitations: [],
      estimates: [],
    })),
    appendEvent: vi.fn(async () => ({})),
    setChallenge: vi.fn(async () => ({})),
    complete: vi.fn(async () => ({})),
  };
}

describe("governed agent turn", () => {
  it("answers the exact business question for a viewer and records one durable period switch", async () => {
    const ports = businessPorts();
    const question = "How to improve the business within 1 month?";
    const outcome = await runGovernedAgentTurn(
      { ...ids, objective: "business_advice", mode: "quick", question },
      ports,
    );

    expect(outcome.kind).toBe("completed");
    expect(ports.answer).toHaveBeenCalledWith(expect.objectContaining({ question }));
    expect(ports.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "period_switched",
        payload: expect.objectContaining({
          requestedStart: "2026-09-01",
          selectedStart: "2026-08-01",
        }),
      }),
    );
    expect(ports.complete).toHaveBeenCalledTimes(1);
  });

  it("does not finalize a channel answer while analysis is still running", async () => {
    const ports = businessPorts();
    ports.currentRole.mockResolvedValue("operator" as never);
    ports.assessChannel.mockResolvedValue({
      status: "in_progress",
      stage: "running",
      channelName: "Talabat",
      period: { start: "2026-08-01", end: "2026-08-31" },
      periodSwitch: null,
      channelId: "70000000-0000-4000-8000-000000000007",
      runId: "80000000-0000-4000-8000-000000000008",
      auditHref: null,
      nextPollAfterMs: 10_000,
    } as never);

    const outcome = await runGovernedAgentTurn(
      { ...ids, objective: "channel_assessment", mode: "quick", question: "How is Talabat doing?" },
      ports,
    );
    expect(outcome).toEqual({ kind: "waiting", nextPollAfterMs: 10_000 });
    expect(ports.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "analysis_started" }),
    );
    expect(ports.complete).not.toHaveBeenCalled();
  });

  it("binds advice to the ready audit period without a second recent-period selection", async () => {
    const ports = businessPorts();
    ports.readAdvice.mockResolvedValue({
      entries: [],
      limitations: [],
      periodSwitch: null,
    } as never);
    const period = { start: "2026-08-01", end: "2026-08-31" };
    ports.assessChannel.mockResolvedValue({
      status: "ready",
      channelId: ids.actorId,
      channelName: "Talabat",
      runId: ids.turnId,
      auditHref: `/organizations/${ids.organizationId}/channels/${ids.actorId}?runId=${ids.turnId}`,
      summary: "Review the source cancellation finding.",
      evidenceRefs: [],
      period,
      periodSwitch: null,
    } as never);
    await runGovernedAgentTurn(
      {
        ...ids,
        objective: "channel_assessment",
        mode: "quick",
        question: "How was Talabat doing in August?",
      },
      ports,
    );
    expect(ports.readAdvice).toHaveBeenCalledWith({ channelId: ids.actorId, period });
    expect(ports.appendEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "period_switched" }),
    );
    expect(ports.complete).toHaveBeenCalledOnce();
  });

  it("does not dispatch channel analysis after permission revocation", async () => {
    const ports = businessPorts();
    ports.currentRole.mockResolvedValue(null as never);
    const outcome = await runGovernedAgentTurn(
      { ...ids, objective: "channel_assessment", mode: "quick", question: "How is Talabat doing?" },
      ports,
    );
    expect(outcome.kind).toBe("revoked");
    expect(ports.assessChannel).not.toHaveBeenCalled();
    expect(ports.complete).not.toHaveBeenCalled();
  });

  it("uses source channel ids in its server-owned scope question", async () => {
    const ports = businessPorts();
    ports.assessChannel.mockResolvedValue({
      status: "needs_scope",
      field: "channel",
      options: [{ id: ids.actorId, label: "Talabat" }],
    } as never);
    const outcome = await runGovernedAgentTurn(
      {
        ...ids,
        objective: "channel_assessment",
        mode: "quick",
        question: "How is the channel doing?",
      },
      ports,
    );
    expect(outcome.kind).toBe("awaiting_user");
    expect(ports.setChallenge).toHaveBeenCalledWith({
      kind: "scope",
      fields: [
        expect.objectContaining({
          key: "channelId",
          options: [{ value: ids.actorId, label: "Talabat" }],
        }),
      ],
    });
    expect(ports.complete).not.toHaveBeenCalled();
  });

  it("records a switch immediately while channel analysis runs", async () => {
    const ports = businessPorts();
    const advice = await ports.readAdvice();
    ports.assessChannel.mockResolvedValue({
      status: "in_progress",
      stage: "running",
      channelId: ids.actorId,
      channelName: "Talabat",
      runId: ids.turnId,
      period: { start: "2026-08-01", end: "2026-08-31" },
      periodSwitch: advice.periodSwitch,
      nextPollAfterMs: 10_000,
    } as never);
    await runGovernedAgentTurn(
      { ...ids, objective: "channel_assessment", mode: "quick", question: "How is Talabat doing?" },
      ports,
    );
    expect(ports.appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "period_switched" }),
    );
    expect(ports.complete).not.toHaveBeenCalled();
  });

  it("does not persist after membership is revoked during synthesis", async () => {
    const ports = businessPorts();
    ports.currentRole.mockResolvedValueOnce("viewer").mockResolvedValueOnce(null as never);
    const outcome = await runGovernedAgentTurn(
      { ...ids, objective: "business_advice", mode: "quick", question: "How can I improve?" },
      ports,
    );
    expect(outcome.kind).toBe("revoked");
    expect(ports.answer).toHaveBeenCalledOnce();
    expect(ports.complete).not.toHaveBeenCalled();
  });

  it("keeps report intake open until a verified attachment is handed to its worker", async () => {
    const ports = businessPorts();
    ports.currentRole.mockResolvedValue("operator" as never);
    const outcome = await runGovernedAgentTurn(
      { ...ids, objective: "report_intake", mode: "quick", question: "Review my attached report" },
      ports,
    );
    expect(outcome.kind).toBe("awaiting_upload");
    expect(ports.complete).not.toHaveBeenCalled();
  });
});
