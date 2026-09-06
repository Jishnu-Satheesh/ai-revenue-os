import { describe, expect, it, vi } from "vitest";

import { dispatchDueActions } from "@/workflows/campaigns/dispatch-due-actions";

const ORG = "11111111-1111-4111-8111-111111111111";

function action(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    campaignId: "c1000000-0000-4000-8000-000000000001",
    bundleVersionId: "d1000000-0000-4000-8000-000000000001",
    actionRunId: "e1000000-0000-4000-8000-000000000001",
    actionKey: "b1000000-0000-4000-8000-000000000001",
    scheduledFor: "2026-08-19T10:00:00.000Z",
    ...overrides,
  };
}

const PLAN = {
  toolKey: "meta.publish_image" as const,
  capabilityKey: "meta.instagram.publish",
  idempotencyKey: "idem-abcdefgh",
  requestDigest: "a".repeat(64),
  assertedFacts: { credentialHealthy: true },
};

function deps(overrides: Record<string, unknown> = {}) {
  return {
    due: { listDue: vi.fn(async () => [action()]) },
    planner: { plan: vi.fn(async () => PLAN) },
    gateway: {
      execute: vi.fn(async () => ({
        status: "published" as const,
        receiptId: "r1",
        externalReference: "17841_media_9",
      })),
    },
    exposures: { record: vi.fn(async () => undefined) },
    isCancelled: () => false,
    now: () => new Date("2026-08-19T10:05:00.000Z"),
    ...overrides,
  } as never;
}

function run(dependencies: ReturnType<typeof deps>, limit?: number) {
  return dispatchDueActions({ limit }, dependencies, new AbortController().signal);
}

describe("nothing decides for itself whether an action may run", () => {
  it("hands every due action to the gateway", async () => {
    const dependencies = deps();
    await run(dependencies);

    const gateway = (dependencies as never as { gateway: { execute: ReturnType<typeof vi.fn> } })
      .gateway;
    expect(gateway.execute).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG, toolKey: "meta.publish_image" }),
      expect.anything(),
    );
  });

  it("treats a refusal as an answer rather than an error", async () => {
    const result = await run(
      deps({
        gateway: {
          execute: vi.fn(async () => ({
            status: "refused" as const,
            reasonCodes: ["capability_not_granted", "credential_expired"],
          })),
        },
      }),
    );

    expect(result.outcomes[0]).toMatchObject({
      result: "refused",
      detail: "capability_not_granted,credential_expired",
    });
    expect(result.published).toBe(0);
  });

  it("does not call the gateway for an action it cannot plan", async () => {
    const dependencies = deps({ planner: { plan: vi.fn(async () => null) } });
    const result = await run(dependencies);

    expect(result.outcomes[0]).toMatchObject({ result: "unplannable" });
    expect(
      (dependencies as never as { gateway: { execute: ReturnType<typeof vi.fn> } }).gateway.execute,
    ).not.toHaveBeenCalled();
  });
});

describe("a confirmed publication is recorded the moment it happens", () => {
  it("writes an exposure with the provider's reference", async () => {
    const dependencies = deps();
    await run(dependencies);

    const record = (dependencies as never as { exposures: { record: ReturnType<typeof vi.fn> } })
      .exposures.record;
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        externalReference: "17841_media_9",
        providerStatus: "PUBLISHED",
        publishedAt: "2026-08-19T10:05:00.000Z",
      }),
    );
  });

  it("delays metric eligibility rather than fetching into an empty window", async () => {
    // Insights are empty immediately after a post, and a zero recorded then
    // reads exactly like a measured zero.
    const dependencies = deps({ metricsDelayMinutes: 90 });
    await run(dependencies);

    const record = (dependencies as never as { exposures: { record: ReturnType<typeof vi.fn> } })
      .exposures.record;
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ metricsEligibleAt: "2026-08-19T11:35:00.000Z" }),
    );
  });

  it("records no exposure for anything short of a publication", async () => {
    for (const status of [
      { status: "failed" as const, failureCode: "meta.400" },
      { status: "refused" as const, reasonCodes: ["blocked"] },
      { status: "provider_outcome_unknown" as const, invocationId: "i1" },
    ]) {
      const dependencies = deps({ gateway: { execute: vi.fn(async () => status) } });
      await run(dependencies);

      expect(
        (dependencies as never as { exposures: { record: ReturnType<typeof vi.fn> } }).exposures
          .record,
      ).not.toHaveBeenCalled();
    }
  });
});

describe("an unknown outcome is never retried here", () => {
  it("reports it for reconciliation rather than trying again", async () => {
    // A retry at this point is how one post becomes two.
    const result = await run(
      deps({
        gateway: {
          execute: vi.fn(async () => ({
            status: "provider_outcome_unknown" as const,
            invocationId: "inv-9",
          })),
        },
      }),
    );

    expect(result.outcomes[0]).toMatchObject({ result: "unknown", detail: "inv-9" });
  });

  it("stands down when another worker already holds the run", async () => {
    const result = await run(
      deps({
        gateway: {
          execute: vi.fn(async () => ({ status: "skipped" as const, reason: "already_claimed" })),
        },
      }),
    );

    expect(result.outcomes[0]).toMatchObject({ result: "skipped" });
  });
});

describe("the sweep is bounded and interruptible", () => {
  it("stops partway when cancelled rather than finishing the batch", async () => {
    let calls = 0;
    const dependencies = deps({
      due: { listDue: vi.fn(async () => [action(), action({ actionRunId: "e2" })]) },
      isCancelled: () => {
        calls += 1;
        return calls > 1;
      },
    });

    const result = await run(dependencies);

    expect(result.considered).toBe(2);
    expect(result.outcomes).toHaveLength(1);
  });

  it("asks for the batch size it was given", async () => {
    const dependencies = deps();
    await run(dependencies, 10);

    expect(
      (dependencies as never as { due: { listDue: ReturnType<typeof vi.fn> } }).due.listDue,
    ).toHaveBeenCalledWith(10);
  });

  it("reports an empty sweep without treating it as a problem", async () => {
    const result = await run(deps({ due: { listDue: vi.fn(async () => []) } }));

    expect(result).toMatchObject({ considered: 0, published: 0, outcomes: [] });
  });

  /**
   * The state of any deployment whose provider is not connected: the gateway
   * raises "no adapter is installed" rather than returning a status. Letting
   * that escape would abandon every remaining action because the first one
   * named a tool this build cannot perform, and would retry the whole sweep to
   * reach the same wall.
   */
  it("records a gateway that raised and carries on with the rest of the batch", async () => {
    const second = action({ actionRunId: "e1000000-0000-4000-8000-000000000002" });
    const result = await run(
      deps({
        due: { listDue: vi.fn(async () => [action(), second]) },
        gateway: {
          execute: vi.fn(async (input: { actionRunId: string }) => {
            if (input.actionRunId === action().actionRunId) {
              throw new Error("No adapter is installed for meta.publish_image.");
            }
            return {
              status: "published" as const,
              receiptId: "r2",
              externalReference: "17841_media_10",
            };
          }),
        },
      }),
    );

    expect(result.considered).toBe(2);
    expect(result.outcomes[0]).toMatchObject({
      actionRunId: action().actionRunId,
      result: "failed",
      // The gateway's own words: paraphrasing loses which tool was missing.
      detail: "No adapter is installed for meta.publish_image.",
    });
    expect(result.outcomes[1]?.result).toBe("published");
    expect(result.published).toBe(1);
  });
});
