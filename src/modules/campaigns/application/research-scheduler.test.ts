import { describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logger";
import type { EvaluateDueResult } from "@/modules/campaigns/infrastructure/research-due-reader";
import {
  runResearchScheduleSweep,
  type ResearchScheduleSweepDue,
  type ResearchScheduleSweepMemory,
} from "@/modules/campaigns/application/research-scheduler";
import type { ResearchWorkerDispatch } from "@/modules/campaigns/application/research-dispatch";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const loggerError = vi.mocked(logger.error);

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RUN = "11111111-1111-4111-8111-111111111111";

function admitted(overrides: Partial<EvaluateDueResult> = {}): EvaluateDueResult {
  return {
    outcome: "admitted",
    runId: RUN,
    policyVersion: 3,
    evidenceMaxAgeDays: 30,
    budgetMinor: 5000,
    allowanceCurrency: "AED",
    reason: null,
    ...overrides,
  };
}

function outcomeOnly(outcome: EvaluateDueResult["outcome"]): EvaluateDueResult {
  return {
    outcome,
    runId: null,
    policyVersion: null,
    evidenceMaxAgeDays: null,
    budgetMinor: null,
    allowanceCurrency: null,
    reason: null,
  };
}

function harness(options: {
  dueOrgs: readonly string[];
  evaluate: (organizationId: string) => Promise<EvaluateDueResult> | EvaluateDueResult;
  manifest?: { digest: string; revision: string } | null;
  manifestThrows?: boolean;
  dispatchReturns?: boolean;
  maxOrganizationsPerTick?: number;
}) {
  const evaluated: string[] = [];
  const due: ResearchScheduleSweepDue = {
    listDueOrganizations: async () => options.dueOrgs,
    evaluateDue: async (input) => {
      evaluated.push(input.organizationId);
      return options.evaluate(input.organizationId);
    },
  };
  const memory: ResearchScheduleSweepMemory = {
    readManifestDigest: async () => {
      if (options.manifestThrows) throw new Error("provider exploded");
      return options.manifest ?? null;
    },
  };
  const dispatched: Array<{ organizationId: string; runId: string }> = [];
  const dispatch: ResearchWorkerDispatch = async (input) => {
    dispatched.push({ organizationId: input.organizationId, runId: input.runId });
    return options.dispatchReturns ?? true;
  };
  return {
    evaluated,
    dispatched,
    run: () =>
      runResearchScheduleSweep({
        due,
        memory,
        dispatch,
        now: () => new Date("2026-09-17T12:00:00.000Z"),
        newCorrelationId: () => "22222222-2222-4222-8222-222222222222",
        maxOrganizationsPerTick: options.maxOrganizationsPerTick,
      }),
  };
}

describe("the hourly research tick", () => {
  it("finds no work when nothing is due, and spends nothing", async () => {
    const { run, dispatched, evaluated } = harness({
      dueOrgs: [],
      evaluate: () => outcomeOnly("not_due"),
    });

    const result = await run();

    // No settings anywhere means no due organizations, which means no
    // evaluation, no admission, no dispatch — and this module never calls a
    // model, so zero model spend is structural, not a limit that could move.
    expect(result).toMatchObject({ organizationsSwept: 0, admitted: 0, failed: [] });
    expect(evaluated).toEqual([]);
    expect(dispatched).toEqual([]);
  });

  it("admits org A and dispatches its worker with the binding policy's evidence age", async () => {
    const seen: Array<{ evidenceFingerprint: string; idempotencyKey: string }> = [];
    const due: ResearchScheduleSweepDue = {
      listDueOrganizations: async () => [ORG_A],
      evaluateDue: async (input) => {
        seen.push({
          evidenceFingerprint: input.evidenceFingerprint,
          idempotencyKey: input.idempotencyKey,
        });
        return admitted();
      },
    };
    const dispatched: unknown[] = [];
    const result = await runResearchScheduleSweep({
      due,
      memory: {
        readManifestDigest: async () => ({ digest: "d".repeat(64), revision: "rev-9" }),
      },
      dispatch: async (input) => {
        dispatched.push(input);
        return true;
      },
      now: () => new Date("2026-09-17T12:00:00.000Z"),
      newCorrelationId: () => "22222222-2222-4222-8222-222222222222",
    });

    expect(result).toMatchObject({ organizationsSwept: 1, admitted: 1 });
    // The tick compares the manifest digest, never its bytes; the worker
    // reads the bytes later through its claim.
    expect(seen[0]?.evidenceFingerprint).toBe(`memory:${"d".repeat(64)}`);
    expect(seen[0]?.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    // Identifiers, the one operating limit the worker refuses to default, and
    // the policy currency the dispatcher pairs with the platform preparation
    // figure. The staged question, the manifest bytes and the budget stay out
    // of the payload — the worker re-reads them from the admitted run.
    expect(dispatched).toEqual([
      {
        organizationId: ORG_A,
        runId: RUN,
        correlationId: "22222222-2222-4222-8222-222222222222",
        evidenceMaxAgeDays: 30,
        allowanceCurrency: "AED",
      },
    ]);
  });

  it("dispatches a replayed admission rather than stranding the run", async () => {
    // A manual double-click replays; so does a retried tick. The worker's
    // claim takes only queued rows, so re-asking is safe and not re-asking
    // would strand a run whose first dispatch was lost.
    const { run, dispatched } = harness({
      dueOrgs: [ORG_A],
      evaluate: () => ({ ...admitted(), outcome: "replayed" }),
    });

    const result = await run();

    expect(result).toMatchObject({ replayed: 1, admitted: 0 });
    expect(dispatched).toHaveLength(1);
  });

  it("stores the outcome and proposes nothing when the evidence was seen or moved nowhere", async () => {
    for (const outcome of ["already_evaluated", "no_qualifying_change"] as const) {
      const { run, dispatched } = harness({
        dueOrgs: [ORG_A],
        evaluate: () => outcomeOnly(outcome),
      });

      const result = await run();

      expect(dispatched).toEqual([]);
      if (outcome === "already_evaluated") {
        // A repeated capture of the same root revision: recognized as seen.
        expect(result).toMatchObject({ deduplicated: 1, notWarranted: 0 });
      } else {
        // Due, evaluated, nothing warranted: the receipt is the outcome.
        expect(result).toMatchObject({ notWarranted: 1, deduplicated: 0 });
      }
    }
  });

  it("names a refused purse without dispatching, and keeps sweeping", async () => {
    const { run, dispatched } = harness({
      dueOrgs: [ORG_A, ORG_B],
      evaluate: (org) =>
        org === ORG_A
          ? { ...outcomeOnly("refused"), reason: "allowance_exceeded" }
          : admitted({ runId: "33333333-3333-4333-8333-333333333333" }),
    });

    const result = await run();

    // An exhausted budget proposes nothing for A and blocks nothing for B.
    expect(result).toMatchObject({
      organizationsSwept: 2,
      refused: 1,
      admitted: 1,
      failed: [],
    });
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ organizationId: ORG_B });
  });

  it("counts a paused schedule as no work rather than a fault", async () => {
    // The policy was paused (or never set up) between the list and the turn:
    // the writer rechecked under lock and reported not_due. Nothing was
    // decided, so nothing is recorded and nobody is paged.
    const { run, dispatched } = harness({
      dueOrgs: [ORG_B],
      evaluate: () => outcomeOnly("not_due"),
    });

    const result = await run();

    expect(result).toMatchObject({ organizationsSwept: 1, notDue: 1, failed: [] });
    expect(dispatched).toEqual([]);
  });

  it("reports an admitted run no worker picked up without calling it started", async () => {
    const { run, dispatched } = harness({
      dueOrgs: [ORG_A],
      evaluate: () => admitted(),
      dispatchReturns: false,
    });

    const result = await run();

    // The run stays queued and the lease sweep will offer it again. The run
    // id is carried so the loss is reconcilable, exactly like the manual
    // path's awaiting-worker report.
    expect(result).toMatchObject({ admitted: 1, dispatchFailed: [RUN] });
    expect(dispatched).toHaveLength(1);
  });

  it("skips an organization whose evidence cannot be read, without guessing", async () => {
    // An unknown provider outcome while reading the manifest is an unknown
    // evidence state, not an empty one. The tick skips rather than admit on
    // fiction or record "seen" for evidence never compared.
    const { run, dispatched, evaluated } = harness({
      dueOrgs: [ORG_A, ORG_B],
      evaluate: () => admitted(),
      manifestThrows: true,
    });

    const result = await run();

    expect(result).toMatchObject({ organizationsSwept: 2, admitted: 0 });
    expect(result.failed).toEqual([ORG_A, ORG_B]);
    expect(evaluated).toEqual([]);
    expect(dispatched).toEqual([]);
    expect(loggerError).toHaveBeenCalledTimes(2);
    expect(loggerError).toHaveBeenCalledWith(
      "campaign.research_schedule_tick_failed",
      expect.objectContaining({ organizationId: ORG_A }),
    );
  });

  it("bounds each tick so a missed sweep never floods catch-up", async () => {
    const orgs = Array.from(
      { length: 30 },
      (_, index) => `000000${String(index).padStart(2, "0")}-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`,
    );
    const { run } = harness({
      dueOrgs: orgs,
      evaluate: () => admitted(),
      maxOrganizationsPerTick: 25,
    });

    const result = await run();

    // Thirty due, twenty-five touched. The rest keep their watermark and
    // wait for the next tick; each claims only its current window, so none
    // of them admits twice for the weeks nobody swept.
    expect(result.organizationsSwept).toBe(25);
  });

  it("derives a stable key per evidence so retries replay and revisions admit once", async () => {
    const keys: string[] = [];
    const due: ResearchScheduleSweepDue = {
      listDueOrganizations: async () => [ORG_A],
      evaluateDue: async (input) => {
        keys.push(input.idempotencyKey);
        return admitted();
      },
    };
    const tick = (manifest: { digest: string; revision: string }) =>
      runResearchScheduleSweep({
        due,
        memory: { readManifestDigest: async () => manifest },
        dispatch: async () => true,
        now: () => new Date("2026-09-17T12:00:00.000Z"),
        newCorrelationId: () => "22222222-2222-4222-8222-222222222222",
      });

    await tick({ digest: "d".repeat(64), revision: "rev-9" });
    await tick({ digest: "d".repeat(64), revision: "rev-9" });
    await tick({ digest: "e".repeat(64), revision: "rev-10" });

    // Same evidence twice: the same key, so the second tick replays. A
    // material new revision: a new key, so it may admit exactly one run of
    // its own — one next-test proposal per evidence revision, even across
    // event storms and lease recoveries.
    expect(keys).toHaveLength(3);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("never subscribes to memory writes — the tick polls, nothing pushes", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(
        new URL("./research-scheduler.ts", import.meta.url),
        "utf8",
      ),
    );

    // Memory writes alone must never trigger research. The scheduler reads
    // the digest inside its own tick; if a memory event path ever calls into
    // this module, this fails loudly rather than auto-firing spend.
    expect(source).not.toMatch(/from "@\/(trigger\/memory|modules\/memory\/[^"]*trigger)/);
    expect(source).not.toMatch(/export (function|const) on[A-Z]/);
    expect(source).toContain("runResearchScheduleSweep");
  });

  it("admits a fresh revision after a cancelled run without resurrecting the old one", async () => {
    // The cancelled run keeps its history (measured cost, receipt) and is
    // never re-queued by this tick: the new evaluation admits a new run for
    // new evidence under a new key. Cancellation stops a run; it does not
    // poison the cadence.
    const { run, dispatched } = harness({
      dueOrgs: [ORG_A],
      manifest: { digest: "f".repeat(64), revision: "rev-11" },
      evaluate: () => admitted({ runId: "44444444-4444-4444-8444-444444444444" }),
    });

    const result = await run();

    expect(result).toMatchObject({ admitted: 1 });
    expect(dispatched[0]).toMatchObject({ runId: "44444444-4444-4444-8444-444444444444" });
  });

  it("refuses to dispatch an admission without a policy currency", async () => {
    // An admitted evaluation that names no currency cannot fund a purse: the
    // payload schema requires one, and the worker refuses to default it. The
    // tick fails loudly for that tenant rather than dispatching a run the
    // worker can only reject.
    const { run, dispatched } = harness({
      dueOrgs: [ORG_A],
      evaluate: () => admitted({ allowanceCurrency: null }),
    });

    const result = await run();

    expect(result).toMatchObject({ admitted: 0, failed: [ORG_A] });
    expect(dispatched).toEqual([]);
  });

  it("hands the worker the same payload shape the manual Ask path uses", async () => {
    // Manual and scheduled runs share one worker and one dispatch contract
    // (organizationId, runId, correlationId, evidenceMaxAgeDays,
    // allowanceCurrency): identifiers plus the one operating limit the worker
    // refuses to default, plus the policy currency the dispatcher pairs with
    // the platform preparation figure. The budget, the staged question and
    // the trigger kind all travel on the admitted run row, never in either
    // payload — so neither caller can widen what its run was admitted to do.
    const dispatched: unknown[] = [];
    await runResearchScheduleSweep({
      due: {
        listDueOrganizations: async () => [ORG_A],
        evaluateDue: async () => admitted(),
      },
      memory: { readManifestDigest: async () => null },
      dispatch: async (input) => {
        dispatched.push(input);
        return true;
      },
      now: () => new Date("2026-09-17T12:00:00.000Z"),
      newCorrelationId: () => "22222222-2222-4222-8222-222222222222",
    });

    expect(Object.keys(dispatched[0] as Record<string, unknown>).sort()).toEqual(
      ["allowanceCurrency", "correlationId", "evidenceMaxAgeDays", "organizationId", "runId"].sort(),
    );
  });
});
