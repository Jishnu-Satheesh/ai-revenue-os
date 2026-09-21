import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  AGENT_BLOCK_SIGNALS,
  AGENT_POLL_INTERVAL_MS,
  AGENT_SLOT_TIMEOUT_MS,
  buildCompetitorGoal,
  createTinyfishAgentAdapter,
  type AgentClientSeam,
} from "@/modules/growth-intelligence/infrastructure/research/tinyfish-agent-adapter";

type StartCall = { url: string; goal: string; browserProfile: "lite" | "stealth" };

function createFakeClient(overrides?: {
  startRuns?: Array<{ runId: string } | { error: Error }>;
  getRun?: (runId: string, call: number) => { status: string; result: unknown } | { error: Error };
}): { starts: StartCall[]; cancels: string[]; polls: string[]; client: AgentClientSeam } {
  const starts: StartCall[] = [];
  const cancels: string[] = [];
  const polls: string[] = [];
  let pollCalls = 0;
  const client: AgentClientSeam = {
    async startRun(input) {
      const index = starts.length;
      starts.push(input);
      const scripted = overrides?.startRuns?.[index];
      if (scripted && "error" in scripted) throw scripted.error;
      return "runId" in (scripted ?? {}) ? { runId: (scripted as { runId: string }).runId } : { runId: `run-${index + 1}` };
    },
    async getRun(runId) {
      polls.push(runId);
      pollCalls += 1;
      const scripted = overrides?.getRun?.(runId, pollCalls);
      if (scripted && "error" in scripted) throw scripted.error;
      return scripted ?? { status: "COMPLETED", result: { ok: true } };
    },
    async cancelRun(runId) {
      cancels.push(runId);
    },
  };
  return { starts, cancels, polls, client };
}

const SLOT = {
  url: "https://example.com/competitor",
  competitorName: "Acme Eats",
  fields: ["menus", "prices"],
};

describe("tinyfish agent adapter", () => {
  it("keeps the Task 3 contract constants verbatim", () => {
    expect(AGENT_SLOT_TIMEOUT_MS).toBe(120_000);
    expect(AGENT_POLL_INTERVAL_MS).toBe(5_000);
    expect(AGENT_BLOCK_SIGNALS).toEqual(["captcha", "blocked", "access denied", "forbidden"]);
  });

  it("returns ok with data and runId on start plus poll success", async () => {
    const fake = createFakeClient({
      getRun: () => ({ status: "COMPLETED", result: { menus: ["lunch"] } }),
    });
    const adapter = createTinyfishAgentAdapter(fake.client);

    const outcome = await adapter.runCompetitorSlot(SLOT);

    expect(outcome).toEqual({ status: "ok", data: { menus: ["lunch"] }, runId: "run-1" });
    expect(fake.starts).toHaveLength(1);
    expect(fake.starts[0]).toMatchObject({ url: SLOT.url, browserProfile: "lite" });
    expect(fake.cancels).toHaveLength(0);
  });

  it("retries once with stealth after a lite block, then returns ok", async () => {
    const fake = createFakeClient({
      getRun: (runId) =>
        runId === "run-1"
          ? { status: "COMPLETED", result: { blocked: true } }
          : { status: "COMPLETED", result: { menus: ["dinner"] } },
    });
    const adapter = createTinyfishAgentAdapter(fake.client);

    const outcome = await adapter.runCompetitorSlot(SLOT);

    expect(outcome).toEqual({ status: "ok", data: { menus: ["dinner"] }, runId: "run-2" });
    expect(fake.starts.map((call) => call.browserProfile)).toEqual(["lite", "stealth"]);
  });

  it("settles to blocked when stealth is blocked too", async () => {
    const fake = createFakeClient({
      getRun: () => ({ status: "COMPLETED", result: { message: "Access Denied for this page" } }),
    });
    const adapter = createTinyfishAgentAdapter(fake.client);

    const outcome = await adapter.runCompetitorSlot(SLOT);

    expect(outcome.status).toBe("blocked");
    expect(outcome.runId).toBe("run-2");
    expect(fake.starts.map((call) => call.browserProfile)).toEqual(["lite", "stealth"]);
    expect(fake.cancels).toHaveLength(0);
  });

  it("detects block signals case-insensitively in string payloads", async () => {
    const fake = createFakeClient({
      getRun: (runId) =>
        runId === "run-1"
          ? { status: "COMPLETED", result: "CAPTCHA required to continue" }
          : { status: "COMPLETED", result: "FORBIDDEN zone" },
    });
    const adapter = createTinyfishAgentAdapter(fake.client);

    const outcome = await adapter.runCompetitorSlot(SLOT);

    expect(outcome.status).toBe("blocked");
    expect(fake.starts).toHaveLength(2);
  });

  it("cancels and reports a timeout when the slot deadline passes", async () => {
    const fake = createFakeClient({
      getRun: () => ({ status: "RUNNING", result: null }),
    });
    const adapter = createTinyfishAgentAdapter(fake.client);

    const outcome = await adapter.runCompetitorSlot({ ...SLOT, timeoutMs: 40 });

    expect(outcome).toEqual({
      status: "failed",
      data: null,
      runId: "run-1",
      code: "AGENT_SLOT_TIMEOUT",
    });
    expect(fake.cancels).toEqual(["run-1"]);
    expect(fake.starts).toHaveLength(1);
  });

  it("cancels and reports aborted when the signal fires mid-poll", async () => {
    const controller = new AbortController();
    const fake = createFakeClient({
      getRun: () => {
        controller.abort();
        return { status: "RUNNING", result: null };
      },
    });
    const adapter = createTinyfishAgentAdapter(fake.client);

    const outcome = await adapter.runCompetitorSlot({ ...SLOT, abortSignal: controller.signal });

    expect(outcome).toEqual({
      status: "failed",
      data: null,
      runId: "run-1",
      code: "AGENT_SLOT_ABORTED",
    });
    expect(fake.cancels).toEqual(["run-1"]);
  });

  it.each(["FAILED", "CANCELLED", "failed"])("maps %s runs to AGENT_RUN_FAILED", async (status) => {
    const fake = createFakeClient({
      getRun: () => ({ status, result: null }),
    });
    const adapter = createTinyfishAgentAdapter(fake.client);

    const outcome = await adapter.runCompetitorSlot(SLOT);

    expect(outcome).toEqual({
      status: "failed",
      data: null,
      runId: "run-1",
      code: "AGENT_RUN_FAILED",
    });
    expect(fake.starts).toHaveLength(1);
  });

  it("settles a refused start to AGENT_RUN_FAILED without throwing", async () => {
    const fake = createFakeClient({
      startRuns: [{ error: new Error("queue refused") }],
    });
    const adapter = createTinyfishAgentAdapter(fake.client);

    const outcome = await adapter.runCompetitorSlot(SLOT);

    expect(outcome).toEqual({
      status: "failed",
      data: null,
      runId: "",
      code: "AGENT_RUN_FAILED",
    });
  });

  it("throws only on programmer errors such as an empty url", async () => {
    const fake = createFakeClient();
    const adapter = createTinyfishAgentAdapter(fake.client);

    await expect(adapter.runCompetitorSlot({ ...SLOT, url: "" })).rejects.toThrow();
    expect(fake.starts).toHaveLength(0);
  });

  it("builds a goal naming the competitor, fields, and blocked instruction", () => {
    const goal = buildCompetitorGoal("Acme Eats", ["menus", "prices"]);

    expect(goal).toBe(
      'Extract menus, prices about Acme Eats from this page. ' +
        "Return JSON matching the requested fields. " +
        'If the page is a block, captcha, login wall, or access-denied page, return {"blocked": true}.',
    );
    expect(goal).toContain("Acme Eats");
    expect(goal).toContain("menus, prices");
    expect(goal).toContain('{"blocked": true}');
  });
});
