import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { getMetaCampaignProviderContract } from "@/modules/integrations/providers/meta/contract";
import {
  internalDraftContentContract,
  verifiedChannelLimits,
  verifiedChannelLimitsEvidence,
} from "@/modules/campaigns/application/verified-limits";
import { createGenerationContextLoader } from "@/modules/campaigns/infrastructure/generation-readers";
import {
  CampaignGenerationBootstrapError,
  withGenerationBootstrapRecovery,
  type GenerationBootstrapRecorder,
} from "@/workflows/campaigns/run-bootstrap";

/**
 * The failure this file reproduces.
 *
 * Deployed Trigger run `run_06g9cko3ehp1gemp1f1v6k6h01`, task
 * `campaign.generate-bundle`, worker `20260910.4`, FAILED after two attempts
 * with `Provider contract verification is expired: meta_campaign`. Its stack
 * ran `parseVerifiedProviderContract` → `getMetaCampaignProviderContract` →
 * `verifiedChannelLimits` → Trigger task dependency construction. The domain
 * run `d2682f4c-2be1-4a2a-823f-e58d5da1731f` was still `queued`, `attempt = 0`,
 * with no lease and no failure code, because the exception happened while the
 * dependency object was being built — before `generateCampaignBundle` was
 * entered, so nothing had claimed the run and its failure handler never ran.
 *
 * A test that mocks an error *inside* the workflow does not reproduce this.
 * The injection below happens in `build`, and the assertion that matters is
 * that `invoke` was never called.
 */

const ORGANIZATION_ID = "2dda45b8-82db-4f5f-b17d-611b9bbb7846";
const RUN_ID = "d2682f4c-2be1-4a2a-823f-e58d5da1731f";
const CAMPAIGN_ID = "d7365075-810c-4e35-8432-a7ff6f04a0a8";
const CORRELATION_ID = "6f5a8f7c-2a2a-4a1b-9a4a-9f1d0c3b7e21";

/** The moment the deployed run was created, so the expiry is fixed forever. */
const DEPLOYED_RUN_CREATED_AT = new Date("2026-09-12T15:53:38.115Z");

type FailBootstrapInput = Parameters<GenerationBootstrapRecorder["failBootstrap"]>[0];
type FailBootstrapOutcome = Awaited<ReturnType<GenerationBootstrapRecorder["failBootstrap"]>>;

function recorder(
  outcome: FailBootstrapOutcome = { outcome: "recorded", attempt: 1 },
): { failBootstrap: ReturnType<typeof vi.fn> } & GenerationBootstrapRecorder {
  return {
    failBootstrap: vi.fn(async (_input: FailBootstrapInput) => outcome),
  };
}

/** A worker client that cannot be produced, the way a missing secret behaves. */
function unavailableWorkerPersistence(): never {
  throw new Error("the campaign worker service client could not be created");
}

function runIdentity(taskId = "campaign.generate-bundle") {
  return {
    organizationId: ORGANIZATION_ID,
    campaignId: CAMPAIGN_ID,
    runId: RUN_ID,
    correlationId: CORRELATION_ID,
    taskId,
  };
}

describe("a generation worker that dies before it claims its run", () => {
  it("records the real expired-contract failure raised while dependencies are built", async () => {
    const failures = recorder();
    const invoke = vi.fn(async () => ({ status: "published" as const }));
    // Stands in for every model and provider call the dependency set would
    // construct. Nothing may reach it: the run never started.
    const providerFactory = vi.fn(() => ({ generate: vi.fn() }));

    const thrown = await withGenerationBootstrapRecovery({
      run: runIdentity(),
      recorder: failures,
      build: () => {
        // The exact deployed call, at the exact deployed moment. Not a mocked
        // error: the checked-in contract really is expired at this date, and
        // R5 forbids moving that date to make generation work.
        const contract = getMetaCampaignProviderContract(DEPLOYED_RUN_CREATED_AT);
        return { limitsByChannel: {}, contract, provider: providerFactory() };
      },
      invoke,
    }).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(CampaignGenerationBootstrapError);
    const bootstrapError = thrown as CampaignGenerationBootstrapError;

    // The defect itself: the workflow was never entered, so nothing claimed
    // the run and nothing could record its failure.
    expect(invoke).not.toHaveBeenCalled();
    expect(providerFactory).not.toHaveBeenCalled();

    // The repair: the outcome is persisted anyway, against the exact tenant and
    // run, instead of leaving the row queued forever.
    expect(failures.failBootstrap).toHaveBeenCalledOnce();
    expect(failures.failBootstrap).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      runId: RUN_ID,
      taskId: "campaign.generate-bundle",
      failureCode: "bootstrap:provider_contract_expired",
    });

    expect(bootstrapError.failureCode).toBe("bootstrap:provider_contract_expired");
    expect(bootstrapError.recorded).toEqual({ outcome: "recorded", attempt: 1 });
    // A lapsed contract is not a flaky network. Retrying it twice, as the
    // deployed run did, buys nothing and bills for it.
    expect(bootstrapError.deterministic).toBe(true);
    expect(bootstrapError.blocker.code).toBe("provider_contract_expired");
    expect(bootstrapError.blocker.repair).toEqual({
      kind: "reverify_provider_contract",
      providerKey: "meta_campaign",
    });
  });

  it("keeps an unexplained bootstrap fault retryable rather than declaring it permanent", async () => {
    const failures = recorder();

    const thrown = (await withGenerationBootstrapRecovery({
      run: runIdentity(),
      recorder: failures,
      build: () => {
        throw new Error("getaddrinfo EAI_AGAIN db.example");
      },
      invoke: vi.fn(async () => ({ status: "published" as const })),
    }).catch((error: unknown) => error)) as CampaignGenerationBootstrapError;

    expect(thrown.failureCode).toBe("bootstrap:worker_start_failed");
    expect(thrown.deterministic).toBe(false);
    // The message is recorded as a code, never as the raw exception text: a
    // connection string or a token can end up inside one of those.
    expect(failures.failBootstrap.mock.calls[0]?.[0].failureCode).toBe(
      "bootstrap:worker_start_failed",
    );
  });

  it("leaves a failure raised inside the workflow to the workflow's own handler", async () => {
    const failures = recorder();

    const thrown = await withGenerationBootstrapRecovery({
      run: runIdentity(),
      recorder: failures,
      build: () => ({ ready: true }),
      invoke: async () => {
        throw new Error("the planner rejected the manifest");
      },
    }).catch((error: unknown) => error);

    // The workflow claims the run and owns its failure path. Recording a
    // bootstrap failure here would fight the claim the workflow holds.
    expect(failures.failBootstrap).not.toHaveBeenCalled();
    expect(thrown).not.toBeInstanceOf(CampaignGenerationBootstrapError);
    expect((thrown as Error).message).toBe("the planner rejected the manifest");
  });

  it("stands down instead of overwriting a run another worker already holds", async () => {
    const failures = recorder({ outcome: "already_claimed" });

    const thrown = (await withGenerationBootstrapRecovery({
      run: runIdentity(),
      recorder: failures,
      build: () => {
        throw new Error("boom");
      },
      invoke: vi.fn(),
    }).catch((error: unknown) => error)) as CampaignGenerationBootstrapError;

    // The attempt still failed and still says so, but it wrote nothing over
    // the live claim: the other worker is the one doing the job.
    expect(thrown.recorded).toEqual({ outcome: "already_claimed" });
  });

  it("reports a run that finished concurrently rather than failing a finished run", async () => {
    const failures = recorder({ outcome: "already_finished", status: "succeeded" });

    const thrown = (await withGenerationBootstrapRecovery({
      run: runIdentity(),
      recorder: failures,
      build: () => {
        throw new Error("boom");
      },
      invoke: vi.fn(),
    }).catch((error: unknown) => error)) as CampaignGenerationBootstrapError;

    expect(thrown.recorded).toEqual({ outcome: "already_finished", status: "succeeded" });
  });

  it("still reports the original cause when the recorder itself is unavailable", async () => {
    const failures = {
      failBootstrap: vi.fn(async () => {
        throw new Error("Campaign generation state could not be read or written.");
      }),
    };

    const thrown = (await withGenerationBootstrapRecovery({
      run: runIdentity(),
      recorder: failures as unknown as GenerationBootstrapRecorder,
      build: () => getMetaCampaignProviderContract(DEPLOYED_RUN_CREATED_AT),
      invoke: vi.fn(),
    }).catch((error: unknown) => error)) as CampaignGenerationBootstrapError;

    // A database that cannot be written is not a reason to lose why the run
    // died. The recorder's own failure is reported as unrecorded, not swapped
    // in for the cause.
    expect(thrown).toBeInstanceOf(CampaignGenerationBootstrapError);
    expect(thrown.failureCode).toBe("bootstrap:provider_contract_expired");
    expect(thrown.recorded).toEqual({ outcome: "unavailable" });
  });

  it("returns the workflow's own result untouched when dependencies build cleanly", async () => {
    const failures = recorder();

    const result = await withGenerationBootstrapRecovery({
      run: runIdentity(),
      recorder: failures,
      build: () => ({ limitsByChannel: {} }),
      invoke: async (dependencies) => ({ status: "published" as const, dependencies }),
    });

    expect(result.status).toBe("published");
    expect(failures.failBootstrap).not.toHaveBeenCalled();
  });
});

describe("an internal draft is not held to unverifiable publishing limits", () => {
  it("no longer throws while the execution contract is expired", () => {
    // The line the deployed stack died on. It now answers "nothing is verified"
    // instead of crashing the worker that asked.
    expect(() => verifiedChannelLimits(DEPLOYED_RUN_CREATED_AT)).not.toThrow();
    expect(verifiedChannelLimits(DEPLOYED_RUN_CREATED_AT)).toEqual({});
  });

  it("names the expired contract as launch evidence rather than inventing limits", () => {
    const evidence = verifiedChannelLimitsEvidence(DEPLOYED_RUN_CREATED_AT);

    expect(evidence.outcome).toBe("unverified");
    expect(evidence.limitsByChannel).toEqual({});
    expect(evidence.blockers.map((blocker) => blocker.code)).toContain("provider_contract_expired");
    for (const blocker of evidence.blockers) expect(blocker.phase).toBe("launch");
  });

  it("lets a draft proceed while carrying the launch blockers forward", () => {
    const draft = internalDraftContentContract(DEPLOYED_RUN_CREATED_AT);

    // No guessed platform limit reaches the draft. An unprovable limit stays
    // unprovable, so generated hashtag sets are blocked by content policy
    // exactly as they are when a live contract proves no limit.
    expect(draft.limitsByChannel).toEqual({});
    expect(draft.deferredLaunchBlockers.map((blocker) => blocker.code)).toContain(
      "provider_contract_expired",
    );
    for (const blocker of draft.deferredLaunchBlockers) expect(blocker.phase).toBe("launch");
  });

  it("carries whatever a current contract proves through to the draft", () => {
    // Before the review date the same reader returns whatever the contract
    // actually proves, so the draft contract is not a permanent empty map.
    const beforeExpiry = new Date("2026-09-16T00:00:00.000Z");
    expect(() => verifiedChannelLimits(beforeExpiry)).not.toThrow();
    expect(internalDraftContentContract(beforeExpiry).limitsByChannel).toEqual(
      verifiedChannelLimits(beforeExpiry),
    );
  });

  it("names every blocked placement even while the contract is current", () => {
    // The failure this covers: a contract inside its review date but with no
    // usable placement used to answer `verified` with an empty blocker list,
    // so a caller asking about Instagram was told everything was fine.
    const evidence = verifiedChannelLimitsEvidence(new Date("2026-09-16T00:00:00.000Z"));

    expect(evidence.outcome).toBe("unverified");
    const blocked = evidence.blockers.filter(
      (blocker) => blocker.code === "provider_placement_blocked",
    );
    expect(blocked.length).toBeGreaterThan(0);
    // Named one by one, so the client can say which post cannot be published.
    // Instagram feed images were the example until the 2026-09-15 re-verification
    // proved their limits; stories are still unproven because the pages
    // consulted do not document them.
    expect(blocked.map((blocker) => blocker.actionKey)).toContain("instagram.image_story");
    for (const blocker of blocked) expect(blocker.phase).toBe("launch");
  });

  it("says so when asked about a placement the contract has never heard of", () => {
    const evidence = verifiedChannelLimitsEvidence(new Date("2026-09-16T00:00:00.000Z"), {
      requestedPlacementKeys: ["tiktok.feed_video"],
    });

    const unknown = evidence.blockers.filter(
      (blocker) => blocker.code === "provider_placement_unknown",
    );
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.actionKey).toBe("tiktok.feed_video");
    expect(evidence.outcome).toBe("unverified");
  });

  it("only ever reports verified when it has nothing left to explain", () => {
    for (const at of ["2026-08-12T00:00:00.000Z", DEPLOYED_RUN_CREATED_AT.toISOString()]) {
      const evidence = verifiedChannelLimitsEvidence(new Date(at));
      expect(evidence.outcome === "verified").toBe(evidence.blockers.length === 0);
    }
  });
});

const GENERATION_TASK_IDS = [
  "campaign.generate-bundle",
  "campaign.revise-bundle",
  "campaign.generate-variants",
] as const;

/**
 * Everything a generation task does before its recovery begins.
 *
 * This slice is the whole risk surface. A construction that happens here has
 * the defect this task fixed: it can throw with no claim, no lease and nothing
 * able to record why, leaving the row `queued` forever.
 */
function preludeBeforeRecovery(source: string, taskId: string): string {
  const taskAt = source.indexOf(`id: "${taskId}"`);
  expect(taskAt).toBeGreaterThan(-1);
  const runAt = source.indexOf("run: async (payload, { signal }) => {", taskAt);
  const recoveryAt = source.indexOf("withGenerationBootstrapRecovery({", runAt);
  expect(runAt).toBeGreaterThan(-1);
  expect(recoveryAt).toBeGreaterThan(runAt);
  // Comments are prose about factories, not calls to them.
  return source.slice(runAt, recoveryAt).replace(/^\s*\/\/.*$/gm, "");
}

describe("the registered generation tasks use the recovery", () => {
  it("wraps every generation task's dependency construction", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/campaigns.ts"), "utf8");

    expect(source.match(/withGenerationBootstrapRecovery\(/g)).toHaveLength(3);
    // The build thunk must enclose the dependency construction, or the
    // exception escapes exactly as it did in the deployed run.
    expect(source.match(/build: \(\): \w+Dependencies => \{/g)).toHaveLength(3);
    expect(source.match(/invoke: \(dependencies\) =>/g)).toHaveLength(3);
  });

  it.each(GENERATION_TASK_IDS)(
    "%s constructs nothing but the client and the run store before the recovery begins",
    async (taskId) => {
      const source = await readFile(resolve(process.cwd(), "src/trigger/campaigns.ts"), "utf8");
      const prelude = preludeBeforeRecovery(source, taskId);

      // A structural guard, not a substring search: it enumerates every factory
      // call in the unguarded window and demands the set be exactly the two that
      // have to be there. Moving any construction back out -- the generation
      // context loader, the model router, a planner, a reader -- fails this, which
      // a `toContain` assertion on the build thunk would not.
      const constructed = new Set(
        (prelude.match(/\b(?:create[A-Z]\w*|campaignRouter)\(/g) ?? []).map((call) =>
          call.slice(0, -1),
        ),
      );

      expect([...constructed].sort()).toEqual([
        // Accepted, and it cannot move: the recorder must exist before anything
        // can be recorded, so a failure to build these two is the one bootstrap
        // gap that has no durable store to report itself to.
        "createCampaignRunStore",
        "createCampaignWorkerServiceClient",
      ]);
    },
  );

  it("records a fault raised while the real generation context loader is constructed", async () => {
    // Exercises the production factory through the production recovery, rather
    // than asserting on the text of the file that calls it. The loader is now
    // built inside the thunk, so an exception evaluating its arguments is a
    // recorded outcome instead of a run left waiting for a worker forever.
    const failures = recorder();
    const invoke = vi.fn(async () => ({ status: "published" as const }));

    const thrown = (await withGenerationBootstrapRecovery({
      run: runIdentity(),
      recorder: failures,
      build: () => ({
        context: createGenerationContextLoader(unavailableWorkerPersistence(), {
          organizationId: ORGANIZATION_ID,
          runId: RUN_ID,
        }),
      }),
      invoke,
    }).catch((error: unknown) => error)) as CampaignGenerationBootstrapError;

    expect(invoke).not.toHaveBeenCalled();
    expect(thrown).toBeInstanceOf(CampaignGenerationBootstrapError);
    expect(failures.failBootstrap).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      runId: RUN_ID,
      taskId: "campaign.generate-bundle",
      failureCode: "bootstrap:worker_start_failed",
    });
  });

  it("stops retrying a deterministic prerequisite instead of billing for it twice", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/campaigns.ts"), "utf8");

    expect(source).toContain("AbortTaskRunError");
    expect(source).toContain("error.deterministic");
    expect(source.match(/refuseUnrepeatableBootstrapFailure\)/g)).toHaveLength(3);
  });

  it("feeds generation the internal draft contract, not the execution limits", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/campaigns.ts"), "utf8");

    expect(source).toContain("internalDraftContentContract");
    // The old call site is what crashed the worker. It must not come back.
    expect(source).not.toContain("limitsByChannel: verifiedChannelLimits()");
  });
});
