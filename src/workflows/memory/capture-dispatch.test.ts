import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MemoryError, memoryError } from "@/domain/memory/errors";
import type { CaptureRepository } from "@/modules/memory/infrastructure/capture-repository";
import {
  embedSweepIdempotencyKey,
  runCaptureDispatch,
  runCaptureReconcile,
  shouldSweepEmbeddings,
  toEnqueuedCount,
  type CaptureDispatchCounts,
  type CaptureReconcileDependencies,
} from "@/workflows/memory/capture-dispatch";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CORRELATION_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-09-11T12:00:00.000Z");

const CAPTURE_1 = "44444444-4444-4444-8444-444444444444";
const CAPTURE_2 = "55555555-5555-4555-8555-555555555555";
const CAPTURE_3 = "66666666-6666-4666-8666-666666666666";
const PROJECTED_ITEM = "77777777-7777-4777-8777-777777777777";

/** Shapes the fake exactly like the real repository: every database refusal
 * arrives as a CONFLICT MemoryError carrying the Postgres cause. */
function databaseRefusal(code: string, message: string): MemoryError {
  return memoryError("CONFLICT", {}, { code, message } as unknown as Record<string, string>);
}

function buildRepository(
  overrides: Partial<CaptureRepository> = {},
): { repository: CaptureRepository; calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {};
  const record =
    <T>(name: string, result: T) =>
    async (input: unknown) => {
      calls[name] = [...(calls[name] ?? []), input];
      return result;
    };
  const repository: CaptureRepository = {
    listDueOrganizations: record("listDueOrganizations", []),
    claim: record("claim", []),
    load: record("load", { captureId: CAPTURE_1 }),
    complete: record("complete", {
      status: "completed",
      captureId: CAPTURE_1,
      projectedItemId: PROJECTED_ITEM,
    }),
    fail: record("fail", { status: "pending", captureId: CAPTURE_1 }),
    retry: async () => {
      throw new Error("retry is not part of the dispatch surface");
    },
    updateSettings: async () => {
      throw new Error("settings are not part of the dispatch surface");
    },
    ...overrides,
  };
  return { repository, calls };
}

const dispatchInput = { organizationId: ORGANIZATION_ID, correlationId: CORRELATION_ID };
const dispatchDependencies = (repository: CaptureRepository) => ({
  repository,
  clock: () => NOW,
});

describe("runCaptureDispatch", () => {
  it("claims one bounded batch with a fresh lease and completes each event", async () => {
    const claimed = [CAPTURE_1, CAPTURE_2];
    const { repository, calls } = buildRepository({
      claim: async (input) => {
        calls.claim = [input];
        return claimed;
      },
      complete: async (input) => {
        calls.complete = [...(calls.complete ?? []), input];
        if (input.captureId === CAPTURE_2) return { status: "obsolete", captureId: CAPTURE_2 };
        return { status: "completed", captureId: CAPTURE_1, projectedItemId: PROJECTED_ITEM };
      },
    });

    const result = await runCaptureDispatch(dispatchInput, dispatchDependencies(repository));

    expect(calls.claim).toEqual([
      {
        organizationId: ORGANIZATION_ID,
        claimToken: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        ),
        limit: 25,
        leaseSeconds: 120,
      },
    ]);
    const claimToken = result.claimToken;
    expect(calls.load).toEqual([
      { organizationId: ORGANIZATION_ID, captureId: CAPTURE_1, claimToken },
      { organizationId: ORGANIZATION_ID, captureId: CAPTURE_2, claimToken },
    ]);
    expect(result.events).toEqual([
      { captureId: CAPTURE_1, outcome: "completed", projectedItemId: PROJECTED_ITEM },
      { captureId: CAPTURE_2, outcome: "obsolete" },
    ]);
    expect(result.counts).toMatchObject({
      claimed: 2,
      completed: 1,
      obsolete: 1,
      leaseLost: 0,
      retryScheduled: 0,
      terminal: 0,
      unsettled: 0,
    });
    expect(result.finishedAt).toBe(NOW.toISOString());
    expect(calls.fail).toBeUndefined();
  });

  it("keeps the batch moving when a lease is lost mid-batch", async () => {
    const { repository, calls } = buildRepository({
      claim: async () => [CAPTURE_1, CAPTURE_2, CAPTURE_3],
      load: async (input) => {
        if (input.captureId === CAPTURE_2) {
          throw databaseRefusal("42501", "memory capture lease is not held");
        }
        return { captureId: input.captureId };
      },
    });

    const result = await runCaptureDispatch(dispatchInput, dispatchDependencies(repository));

    expect(result.events).toEqual([
      { captureId: CAPTURE_1, outcome: "completed", projectedItemId: PROJECTED_ITEM },
      { captureId: CAPTURE_2, outcome: "lease_lost" },
      { captureId: CAPTURE_3, outcome: "completed", projectedItemId: PROJECTED_ITEM },
    ]);
    expect(result.counts).toMatchObject({ claimed: 3, completed: 2, leaseLost: 1 });
    // A lease loss is not a failure to record: fail_ is never called for it.
    expect(calls.fail).toBeUndefined();
  });

  it("records a complete_ lease loss without calling fail_ and continues", async () => {
    const { repository, calls } = buildRepository({
      claim: async () => [CAPTURE_1, CAPTURE_2],
      complete: async (input) => {
        if (input.captureId === CAPTURE_1) {
          throw databaseRefusal("42501", "memory capture lease is not held");
        }
        return { status: "replayed", captureId: CAPTURE_2, projectedItemId: PROJECTED_ITEM };
      },
    });

    const result = await runCaptureDispatch(dispatchInput, dispatchDependencies(repository));

    expect(result.events).toEqual([
      { captureId: CAPTURE_1, outcome: "lease_lost" },
      { captureId: CAPTURE_2, outcome: "replayed", projectedItemId: PROJECTED_ITEM },
    ]);
    expect(calls.fail).toBeUndefined();
  });

  it("retries unknown database failures as TRANSIENT_DB and quarantines only what the database named", async () => {
    const failCalls: unknown[] = [];
    const { repository } = buildRepository({
      claim: async () => [CAPTURE_1, CAPTURE_2, CAPTURE_3],
      load: async (input) => ({ captureId: input.captureId }),
      complete: async (input) => {
        if (input.captureId === CAPTURE_1) {
          throw databaseRefusal("XX000", "internal error, no diagnosis offered");
        }
        if (input.captureId === CAPTURE_2) {
          throw databaseRefusal("23514", "memory capture source is not projectable");
        }
        return { status: "completed", captureId: CAPTURE_3, projectedItemId: PROJECTED_ITEM };
      },
      fail: async (input) => {
        failCalls.push(input);
        return { status: "pending", captureId: input.captureId };
      },
    });

    const result = await runCaptureDispatch(dispatchInput, dispatchDependencies(repository));

    expect(failCalls).toMatchObject([
      { captureId: CAPTURE_1, safeCode: "TRANSIENT_DB" },
      { captureId: CAPTURE_2, safeCode: "QUARANTINE_INVALID_SHAPE" },
    ]);
    expect(result.events).toEqual([
      {
        captureId: CAPTURE_1,
        outcome: "retry_scheduled",
        safeCode: "TRANSIENT_DB",
        status: "pending",
      },
      {
        captureId: CAPTURE_2,
        outcome: "retry_scheduled",
        safeCode: "QUARANTINE_INVALID_SHAPE",
        status: "pending",
      },
      { captureId: CAPTURE_3, outcome: "completed", projectedItemId: PROJECTED_ITEM },
    ]);
  });

  it("treats a runner-side unknown completion code as transient, never as quarantine", async () => {
    const failCalls: unknown[] = [];
    const { repository } = buildRepository({
      claim: async () => [CAPTURE_1],
      // The repository's own shape guard: the database answered something the
      // contract does not know. The database named nothing, so no quarantine.
      complete: async () => {
        throw memoryError("CONFLICT", {}, new Error("capture completion is invalid"));
      },
      fail: async (input) => {
        failCalls.push(input);
        return { status: "failed", captureId: input.captureId };
      },
    });

    const result = await runCaptureDispatch(dispatchInput, dispatchDependencies(repository));

    expect(failCalls).toMatchObject([{ captureId: CAPTURE_1, safeCode: "TRANSIENT_DB" }]);
    expect(result.events).toEqual([
      {
        captureId: CAPTURE_1,
        outcome: "terminal",
        safeCode: "TRANSIENT_DB",
        status: "failed",
      },
    ]);
  });

  it("processes at most one batch even when the claim over-delivers", async () => {
    const overDelivery = Array.from(
      { length: 30 },
      (_, index) => `88888888-8888-4888-8888-${String(index).padStart(12, "0")}`,
    );
    const completed: unknown[] = [];
    const { repository, calls } = buildRepository({
      claim: async (input) => {
        calls.claim = [input];
        return overDelivery;
      },
      complete: async (input) => {
        completed.push(input);
        return { status: "completed", captureId: input.captureId, projectedItemId: PROJECTED_ITEM };
      },
    });

    const result = await runCaptureDispatch(dispatchInput, dispatchDependencies(repository));

    expect(calls.claim?.[0]).toMatchObject({ limit: 25 });
    expect(completed).toHaveLength(25);
    expect(result.counts.claimed).toBe(25);
  });

  it("rejects an invalid tenant payload before touching the queue", async () => {
    const { repository, calls } = buildRepository();

    await expect(
      runCaptureDispatch(
        { organizationId: "not-a-uuid", correlationId: CORRELATION_ID },
        dispatchDependencies(repository),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(calls.claim).toBeUndefined();
  });

  it("returns identifiers and safe codes only, never source bodies", async () => {
    const bodyText = "unpublished body text that must never appear in a result";
    const { repository } = buildRepository({
      claim: async () => [CAPTURE_1],
      load: async () => ({ captureId: CAPTURE_1, projectionDocument: { body: bodyText } }),
    });

    const result = await runCaptureDispatch(dispatchInput, dispatchDependencies(repository));

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(bodyText);
    expect(serialized).toContain(CAPTURE_1);
    expect(serialized).toContain(PROJECTED_ITEM);
  });
});

function buildReconcileDependencies(
  overrides: Partial<CaptureReconcileDependencies> = {},
): { dependencies: CaptureReconcileDependencies; calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {};
  const dependencies: CaptureReconcileDependencies = {
    listIdentities: async (input) => {
      calls.listIdentities = [...(calls.listIdentities ?? []), input];
      return { identities: [], completeCursor: null };
    },
    enqueueMissing: async (input) => {
      calls.enqueueMissing = [...(calls.enqueueMissing ?? []), input];
      return 0;
    },
    clock: () => NOW,
    ...overrides,
  };
  return { dependencies, calls };
}

const reconcileInput = {
  organizationId: ORGANIZATION_ID,
  adapter: "channel",
  cursor: null as string | null,
  limit: 100,
};

describe("runCaptureReconcile", () => {
  it("pages identities oldest-first, counts enqueued work, and advances past a clean page", async () => {
    const { dependencies, calls } = buildReconcileDependencies({
      listIdentities: async (input) => {
        calls.listIdentities = [input];
        return {
          identities: [
            { kind: "channel_findings", id: CAPTURE_1 },
            { kind: "channel_decision", id: CAPTURE_2 },
          ],
          completeCursor: "d|2026-09-11T00:00:00.000Z",
        };
      },
      enqueueMissing: async (input) => {
        calls.enqueueMissing = [...(calls.enqueueMissing ?? []), input];
        return input.identity.kind === "channel_findings" ? 2 : 0;
      },
    });

    const result = await runCaptureReconcile(reconcileInput, dependencies);

    expect(calls.listIdentities).toEqual([
      { organizationId: ORGANIZATION_ID, adapter: "channel", cursor: null, limit: 100 },
    ]);
    expect(result).toMatchObject({
      scanned: 2,
      enqueued: 2,
      nextCursor: "d|2026-09-11T00:00:00.000Z",
      advanced: true,
    });
    expect(result.finishedAt).toBe(NOW.toISOString());
  });

  it("freezes the cursor on the first enqueue error and attempts nothing after it", async () => {
    const enqueueMissing = vi.fn(async () => {
      throw databaseRefusal("08006", "connection lost mid-page");
    });
    const { dependencies } = buildReconcileDependencies({
      listIdentities: async () => ({
        identities: [
          { kind: "channel_findings", id: CAPTURE_1 },
          { kind: "channel_findings", id: CAPTURE_2 },
        ],
        completeCursor: "f|2026-09-11T00:00:00.000Z",
      }),
      enqueueMissing,
    });

    const result = await runCaptureReconcile(
      { ...reconcileInput, cursor: "f|2026-09-10T00:00:00.000Z" },
      dependencies,
    );

    expect(enqueueMissing).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      scanned: 0,
      enqueued: 0,
      nextCursor: "f|2026-09-10T00:00:00.000Z",
      advanced: false,
    });
  });

  it("keeps a null completeCursor on the input cursor after a clean empty page", async () => {
    const { dependencies } = buildReconcileDependencies({
      listIdentities: async () => ({ identities: [], completeCursor: null }),
    });

    const result = await runCaptureReconcile(
      { ...reconcileInput, cursor: "r|2026-09-11T00:00:00.000Z" },
      dependencies,
    );

    expect(result).toMatchObject({
      scanned: 0,
      enqueued: 0,
      nextCursor: "r|2026-09-11T00:00:00.000Z",
      advanced: true,
    });
  });

  it("freezes on a malformed identity without calling the enqueue path", async () => {
    const enqueueMissing = vi.fn(async () => 1);
    const { dependencies } = buildReconcileDependencies({
      listIdentities: async () => ({
        identities: [
          null as unknown as { kind: string; id: string },
          { kind: "channel_findings", id: "not-a-uuid" },
        ],
        completeCursor: "f|2026-09-11T00:00:00.000Z",
      }),
      enqueueMissing,
    });

    const result = await runCaptureReconcile(reconcileInput, dependencies);

    expect(enqueueMissing).not.toHaveBeenCalled();
    expect(result).toMatchObject({ scanned: 0, enqueued: 0, nextCursor: null, advanced: false });
  });

  it("refuses an over-limit page and an unknown adapter before paging", async () => {
    const { dependencies, calls } = buildReconcileDependencies();

    await expect(
      runCaptureReconcile({ ...reconcileInput, limit: 101 }, dependencies),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      runCaptureReconcile({ ...reconcileInput, adapter: "channel_finding" }, dependencies),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(calls.listIdentities).toBeUndefined();
  });
});

describe("toEnqueuedCount", () => {
  it("counts a decision uuid answer as one without throwing", () => {
    expect(
      toEnqueuedCount("channel_decision", "88888888-8888-4888-8888-888888888888"),
    ).toBe(1);
  });

  it("counts a decision null answer as zero when capture is bypassed", () => {
    expect(toEnqueuedCount("channel_decision", null)).toBe(0);
  });

  it("passes findings and recommendations integer counts through", () => {
    expect(toEnqueuedCount("channel_findings", 2)).toBe(2);
    expect(toEnqueuedCount("channel_recommendations", 0)).toBe(0);
  });

  it("refuses a decision integer answer, invalid counts, and unknown kinds", () => {
    // Regression guard: an integer check applied to the uuid-returning
    // decision wrapper threw on every decision identity and aborted its
    // reconcile pass.
    expect(() => toEnqueuedCount("channel_decision", 1)).toThrow(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
    expect(() => toEnqueuedCount("channel_findings", 1.5)).toThrow(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
    expect(() => toEnqueuedCount("channel_findings", -1)).toThrow(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
    expect(() => toEnqueuedCount("channel_findings", "1")).toThrow(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
    expect(() => toEnqueuedCount("growth_item", 1)).toThrow(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
  });
});

describe("embedding sweep decision", () => {
  const empty: CaptureDispatchCounts = {
    claimed: 0,
    completed: 0,
    replayed: 0,
    obsolete: 0,
    quarantined: 0,
    retryScheduled: 0,
    terminal: 0,
    leaseLost: 0,
    unsettled: 0,
  };

  it("sweeps only when the pass projected something", () => {
    expect(shouldSweepEmbeddings(empty)).toBe(false);
    expect(shouldSweepEmbeddings({ ...empty, replayed: 3, obsolete: 1 })).toBe(false);
    expect(shouldSweepEmbeddings({ ...empty, completed: 1 })).toBe(true);
  });

  it("keys the sweep once per organization per UTC day", () => {
    expect(embedSweepIdempotencyKey(ORGANIZATION_ID, new Date("2026-09-13T00:30:00.000Z"))).toBe(
      `embed-after-capture:${ORGANIZATION_ID}:2026-09-13`,
    );
    expect(embedSweepIdempotencyKey(ORGANIZATION_ID, new Date("2026-09-13T23:59:59.000Z"))).toBe(
      embedSweepIdempotencyKey(ORGANIZATION_ID, new Date("2026-09-13T00:00:00.000Z")),
    );
    expect(embedSweepIdempotencyKey(ORGANIZATION_ID, new Date("2026-09-14T00:00:00.000Z"))).not.toBe(
      embedSweepIdempotencyKey(ORGANIZATION_ID, new Date("2026-09-13T00:00:00.000Z")),
    );
  });

  it("keeps the key inside the task payload bounds", () => {
    const key = embedSweepIdempotencyKey(ORGANIZATION_ID, NOW);
    expect(key.length).toBeGreaterThanOrEqual(16);
    expect(key.length).toBeLessThanOrEqual(200);
  });
});
