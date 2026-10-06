import { describe, expect, it, vi } from "vitest";

import {
  dispatchDuePayloadSchema,
  dispatchDueWork,
} from "@/workflows/growth-intelligence/dispatch-due-work";

const organizationId = "10000000-0000-4000-8000-000000000001";
const otherOrganizationId = "11000000-0000-4000-8000-000000000011";
const correlationId = "60000000-0000-4000-8000-000000000006";

function dueRequest(overrides = {}) {
  return {
    organizationId,
    requestId: "20000000-0000-4000-8000-000000000002",
    kind: "market_research",
    correlationId,
    ...overrides,
  };
}

function dependencies(overrides = {}) {
  const claimDue = vi.fn(async (_input: { limit: number; cooldownSeconds: number }) => [
    dueRequest(),
  ]);
  const trigger = vi.fn(async () => {});
  return { claimDue, trigger, ...overrides };
}

describe("dispatchDuePayloadSchema", () => {
  it("defaults to a bounded batch with a recovery cooldown", () => {
    expect(dispatchDuePayloadSchema.parse({ correlationId })).toEqual({
      correlationId,
      limit: 25,
      cooldownSeconds: 300,
    });
  });

  it("rejects unbounded batches and negative cooldowns", () => {
    expect(() => dispatchDuePayloadSchema.parse({ correlationId, limit: 101 })).toThrow();
    expect(() =>
      dispatchDuePayloadSchema.parse({ correlationId, cooldownSeconds: 3_601 }),
    ).toThrow();
  });
});

describe("dispatchDueWork", () => {
  it("routes research kinds to research and synthesis kinds to synthesis", async () => {
    const deps = dependencies();
    deps.claimDue.mockResolvedValueOnce([
      dueRequest(),
      dueRequest({
        organizationId: otherOrganizationId,
        requestId: "21000000-0000-4000-8000-000000000021",
        kind: "market_evidence_changed",
      }),
      dueRequest({
        requestId: "22000000-0000-4000-8000-000000000022",
        kind: "evidence_reassessment",
      }),
      dueRequest({
        requestId: "23000000-0000-4000-8000-000000000023",
        kind: "business_evidence_changed",
      }),
      dueRequest({
        requestId: "24000000-0000-4000-8000-000000000024",
        kind: "weekly_synthesis",
      }),
    ]);

    const result = await dispatchDueWork({ correlationId }, deps);

    expect(result).toMatchObject({ outcome: "dispatched", dispatched: 5, skipped: 0 });
    expect(deps.trigger).toHaveBeenCalledTimes(5);
    expect(deps.trigger).toHaveBeenNthCalledWith(1, {
      taskId: "growth-intelligence.run-market-research",
      organizationId,
      requestId: "20000000-0000-4000-8000-000000000002",
      correlationId,
    });
    expect(deps.trigger).toHaveBeenNthCalledWith(2, {
      taskId: "growth-intelligence.run-synthesis",
      organizationId: otherOrganizationId,
      requestId: "21000000-0000-4000-8000-000000000021",
      correlationId,
    });
    expect(deps.trigger).toHaveBeenNthCalledWith(3, {
      taskId: "growth-intelligence.run-market-research",
      organizationId,
      requestId: "22000000-0000-4000-8000-000000000022",
      correlationId,
    });
    expect(deps.trigger).toHaveBeenNthCalledWith(4, {
      taskId: "growth-intelligence.run-synthesis",
      organizationId,
      requestId: "23000000-0000-4000-8000-000000000023",
      correlationId,
    });
    expect(deps.trigger).toHaveBeenNthCalledWith(5, {
      taskId: "growth-intelligence.run-synthesis",
      organizationId,
      requestId: "24000000-0000-4000-8000-000000000024",
      correlationId,
    });
  });

  it("skips kinds owned by other flows without triggering anything", async () => {
    const deps = dependencies();
    deps.claimDue.mockResolvedValueOnce([
      dueRequest({ kind: "profile_discovery" }),
      dueRequest({ kind: "unknown_future_kind" }),
    ]);

    const result = await dispatchDueWork({ correlationId }, deps);

    expect(result).toMatchObject({ outcome: "dispatched", dispatched: 0, skipped: 2 });
    expect(deps.trigger).not.toHaveBeenCalled();
  });

  it("recovers lost dispatches on the next run through the due index, not memory", async () => {
    const deps = dependencies();
    deps.claimDue.mockResolvedValueOnce([]);

    const result = await dispatchDueWork({ correlationId }, deps);

    expect(result).toMatchObject({ outcome: "dispatched", dispatched: 0, skipped: 0 });
    expect(deps.claimDue).toHaveBeenCalledWith({ limit: 25, cooldownSeconds: 300 });
  });

  it("propagates trigger failures so the cooldown, not a silent skip, governs redelivery", async () => {
    const deps = dependencies();
    deps.trigger.mockRejectedValueOnce(new Error("trigger unavailable"));

    await expect(dispatchDueWork({ correlationId }, deps)).rejects.toThrow("trigger unavailable");
  });

  it("passes the caller bounds straight to the fenced due claim", async () => {
    const deps = dependencies();

    await dispatchDueWork({ correlationId, limit: 10, cooldownSeconds: 60 }, deps);

    expect(deps.claimDue).toHaveBeenCalledWith({ limit: 10, cooldownSeconds: 60 });
  });
});
