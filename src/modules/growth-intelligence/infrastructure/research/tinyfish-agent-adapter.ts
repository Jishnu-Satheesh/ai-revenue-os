import "server-only";

import type { TinyFish } from "@tiny-fish/sdk";

/**
 * Agent fallback lane adapter (Growth Intelligence).
 *
 * The lane runs competitor slots through the TinyFish Agent API with an
 * async-start + poll flow (never sync/SSE: agent runs typically outlive the
 * 20s adapter timeout). The provider surface stays behind AgentClientSeam so
 * Task 3 can consume this contract verbatim; only the SDK-backed factory
 * below knows the installed SDK's method names.
 *
 * SDK surface used (installed @tiny-fish/sdk version reported in the Task 1
 * report): `client.agent.queue` (async start), `client.runs.get` (poll).
 * The SDK exposes no cancel-run method, so the Task 3 wiring implements
 * `cancelRun` as a raw `POST https://agent.tinyfish.ai/v1/runs/{runId}/cancel`
 * with the `X-API-Key` header (per the TinyFish Agent API reference). The
 * seam signature stays `cancelRun(runId: string): Promise<void>` so lane
 * semantics (timeout/abort settle) are intact.
 *
 * Every start carries `maxDurationSeconds` (120, i.e. AGENT_SLOT_TIMEOUT_MS
 * / 1000) so the run is server-side bounded by
 * `agent_config: { max_duration_seconds: 120 }` even if local polling stops.
 *
 * Fail-closed: provider-shaped outcomes never throw; only programmer errors
 * (empty url/goal) throw. No API key handling here (the seam takes no
 * secrets) and result bodies are never logged — runIds may be logged by the
 * caller.
 */

export type AgentSlotStatus = "ok" | "blocked" | "failed";

export type AgentSlotOutcome = {
  status: AgentSlotStatus;
  data: unknown;
  runId: string;
  code?: string;
};

export type AgentClientSeam = {
  startRun(input: {
    url: string;
    goal: string;
    browserProfile: "lite" | "stealth";
    maxDurationSeconds: number;
  }): Promise<{ runId: string }>;
  getRun(runId: string): Promise<{ status: string; result: unknown }>;
  /**
   * Real cancel, not a no-op. The SDK-backed implementation (Task 3 wiring)
   * performs a raw `POST https://agent.tinyfish.ai/v1/runs/{runId}/cancel`
   * with the `X-API-Key` header, per the TinyFish Agent API reference.
   */
  cancelRun(runId: string): Promise<void>;
};

/** Per-slot ceiling: the agent attempt lives inside the task ceiling. */
export const AGENT_SLOT_TIMEOUT_MS = 120_000;

/** Poll cadence for async agent runs. */
export const AGENT_POLL_INTERVAL_MS = 5_000;

/** Case-insensitive block substrings scanned in the stringified result. */
export const AGENT_BLOCK_SIGNALS = ["captcha", "blocked", "access denied", "forbidden"];

export function buildCompetitorGoal(competitorName: string, fields: string[]): string {
  return (
    `Extract ${fields.join(", ")} about ${competitorName} from this page. ` +
    `Return JSON matching the requested fields. ` +
    `If the page is a block, captcha, login wall, or access-denied page, return {"blocked": true}.`
  );
}

/**
 * Maps the installed TinyFish SDK onto the lane seam. `queue` is the SDK's
 * async-start (returns a run_id immediately); `runs.get` is the poll. A
 * queue-time error response carries no run_id, so it surfaces as a throw
 * that the adapter settles to a failed outcome — never as invented data.
 */
export function createTinyfishSdkAgentClient(client: TinyFish): AgentClientSeam {
  return {
    async startRun(input) {
      const response = await client.agent.queue({
        url: input.url,
        goal: input.goal,
        browser_profile: input.browserProfile,
        agent_config: { max_duration_seconds: input.maxDurationSeconds },
      });
      if (response.run_id === null) {
        throw new Error("TinyFish agent queue refused the run.");
      }
      return { runId: response.run_id };
    },
    async getRun(runId) {
      const run = await client.runs.get(runId);
      return { status: run.status, result: run.result };
    },
    async cancelRun(runId) {
      // Placeholder until the Task 3 wiring lands: the real implementation
      // performs a raw `POST https://agent.tinyfish.ai/v1/runs/{runId}/cancel`
      // with the `X-API-Key` header (the installed SDK has no cancel-run
      // method, so nothing is invented here). Task 3 replaces this body.
      void runId;
    },
  };
}

export function createTinyfishAgentAdapter(client: AgentClientSeam): {
  runCompetitorSlot(input: {
    url: string;
    competitorName: string;
    fields: string[];
    timeoutMs?: number;
    abortSignal?: AbortSignal;
  }): Promise<AgentSlotOutcome>;
} {
  return {
    async runCompetitorSlot(input) {
      if (input.url.length === 0) {
        throw new Error("Agent competitor slots require a page URL.");
      }
      const goal = buildCompetitorGoal(input.competitorName, input.fields);
      if (goal.length === 0) {
        throw new Error("Agent competitor slots require a goal.");
      }
      if (input.abortSignal?.aborted) {
        return { status: "failed", data: null, runId: "", code: "AGENT_SLOT_ABORTED" };
      }
      const timeoutMs = input.timeoutMs ?? AGENT_SLOT_TIMEOUT_MS;
      const deadline = Date.now() + timeoutMs;

      const startAttempt = async (
        browserProfile: "lite" | "stealth",
      ): Promise<{ runId: string } | null> => {
        try {
          return await client.startRun({
            url: input.url,
            goal,
            browserProfile,
            maxDurationSeconds: AGENT_SLOT_TIMEOUT_MS / 1000,
          });
        } catch {
          return null;
        }
      };

      const cancelQuietly = async (runId: string): Promise<void> => {
        if (runId.length === 0) return;
        try {
          await client.cancelRun(runId);
        } catch {
          // Best-effort: the outcome below already settles the slot.
        }
      };

      const settleFailed = async (
        runId: string,
        code: string,
        data: unknown = null,
      ): Promise<AgentSlotOutcome> => {
        await cancelQuietly(runId);
        return { status: "failed", data, runId, code };
      };

      // First attempt always runs on the lite profile.
      const lite = await startAttempt("lite");
      if (lite === null) {
        return { status: "failed", data: null, runId: "", code: "AGENT_RUN_FAILED" };
      }
      const liteResult = await pollToTerminal(client, lite.runId, deadline, input.abortSignal);
      const liteOutcome = await settlePolled(lite.runId, liteResult);
      if (liteOutcome !== null) return liteOutcome;

      // Lite completed with a block signal: exactly one stealth retry.
      const stealth = await startAttempt("stealth");
      if (stealth === null) {
        return { status: "failed", data: null, runId: lite.runId, code: "AGENT_RUN_FAILED" };
      }
      const stealthResult = await pollToTerminal(client, stealth.runId, deadline, input.abortSignal);
      const stealthOutcome = await settlePolled(stealth.runId, stealthResult);
      if (stealthOutcome !== null) return stealthOutcome;

      // Stealth also completed with a block signal: no evidence, no invention.
      return { status: "blocked", data: lastResult(stealthResult), runId: stealth.runId };

      async function settlePolled(runId: string, polled: PolledRun): Promise<AgentSlotOutcome | null> {
        switch (polled.kind) {
          case "completed":
            // Blocked completions return null so the caller retries (lite)
            // or settles to blocked (stealth); clean completions settle ok.
            if (isBlockedResult(polled.result)) return null;
            return { status: "ok", data: polled.result, runId };
          case "run-failed":
            return { status: "failed", data: polled.result, runId, code: "AGENT_RUN_FAILED" };
          case "poll-error":
            return settleFailed(runId, "AGENT_RUN_FAILED");
          case "timeout":
            return settleFailed(runId, "AGENT_SLOT_TIMEOUT");
          case "aborted":
            return settleFailed(runId, "AGENT_SLOT_ABORTED");
        }
      }
    },
  };
}

type PolledRun =
  | { kind: "completed"; result: unknown }
  | { kind: "run-failed"; result: unknown }
  | { kind: "poll-error" }
  | { kind: "timeout" }
  | { kind: "aborted" };

function lastResult(polled: PolledRun): unknown {
  switch (polled.kind) {
    case "completed":
    case "run-failed":
      return polled.result;
    default:
      return null;
  }
}

/**
 * Polls one run until it reaches a terminal status. Terminal statuses are
 * COMPLETED / FAILED / CANCELLED (matched case-insensitively so SDK
 * equivalents fold in); anything else keeps polling until the slot
 * deadline, with the caller's abort signal checked on every iteration.
 */
async function pollToTerminal(
  client: AgentClientSeam,
  runId: string,
  deadline: number,
  abortSignal: AbortSignal | undefined,
): Promise<PolledRun> {
  for (;;) {
    if (abortSignal?.aborted) return { kind: "aborted" };
    let observed: { status: string; result: unknown };
    try {
      observed = await client.getRun(runId);
    } catch {
      return { kind: "poll-error" };
    }
    const status = observed.status.toUpperCase();
    if (status === "COMPLETED") return { kind: "completed", result: observed.result };
    if (status === "FAILED" || status === "CANCELLED") {
      return { kind: "run-failed", result: observed.result };
    }
    if (abortSignal?.aborted) return { kind: "aborted" };
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { kind: "timeout" };
    const slept = await sleepMs(Math.min(AGENT_POLL_INTERVAL_MS, remaining), abortSignal);
    if (slept === "aborted") return { kind: "aborted" };
    if (Date.now() >= deadline) return { kind: "timeout" };
  }
}

function sleepMs(ms: number, signal: AbortSignal | undefined): Promise<"slept" | "aborted"> {
  if (ms <= 0) return Promise.resolve("slept");
  if (signal?.aborted) return Promise.resolve("aborted");
  if (!signal) {
    return new Promise((resolve) => {
      setTimeout(() => resolve("slept"), ms);
    });
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve("slept");
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve("aborted");
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Blocked when the payload flags itself or names a block signal (any case). */
function isBlockedResult(result: unknown): boolean {
  if (typeof result === "object" && result !== null && !Array.isArray(result)) {
    if ((result as Record<string, unknown>)["blocked"] === true) return true;
  }
  let text: string;
  try {
    text = JSON.stringify(result) ?? "";
  } catch {
    return false;
  }
  const lowered = text.toLowerCase();
  return AGENT_BLOCK_SIGNALS.some((signal) => lowered.includes(signal));
}
