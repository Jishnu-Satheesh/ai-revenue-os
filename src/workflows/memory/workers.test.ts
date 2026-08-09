import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { EventPublisher } from "@/domain/events/types";
import type { MemoryItemRow } from "@/modules/memory/application/ports";
import {
  MAX_EMBEDDING_BATCH_SIZE,
  createMemoryWorkerDependencies,
  type MemoryWorkerRepository,
  type MemoryWorkerDependencies,
} from "@/workflows/memory/contracts";
import { runEmbedItems } from "@/workflows/memory/embed-items";
import { runExpireItems } from "@/workflows/memory/expire-items";
import { runReembedItem } from "@/workflows/memory/reembed-item";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";
const CORRELATION_ID = "33333333-3333-4333-8333-333333333333";
const ITEM_ID = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-08-09T12:00:00.000Z");

function item(overrides: Partial<MemoryItemRow> = {}): MemoryItemRow {
  return {
    id: ITEM_ID,
    organization_id: ORGANIZATION_ID,
    branch_id: null,
    memory_type: "note",
    title: "Kitchen staffing note",
    body: "Schedule two people for the evening shift.",
    structured_value: null,
    origin: "user_verified",
    source_tier: 1,
    source_system: null,
    source_reference: null,
    source_run_id: null,
    source_record_id: null,
    verification_state: "unverified",
    confidence: null,
    sensitivity: "internal",
    observed_at: null,
    effective_from: null,
    effective_to: null,
    review_due_at: null,
    expires_at: null,
    superseded_by_id: null,
    superseded_at: null,
    supersession_reason: null,
    rejection_reason: null,
    proposed_fact_key: null,
    proposed_fact_value: null,
    proposed_branch_id: null,
    embedding_model: null,
    embedding_status: "pending",
    embedding_updated_at: null,
    created_by: null,
    verified_by: null,
    verified_at: null,
    created_at: "2026-08-09T00:00:00.000Z",
    updated_at: "2026-08-09T00:00:00.000Z",
    ...overrides,
  };
}

function buildDependencies(
  overrides: Omit<Partial<MemoryWorkerDependencies>, "repository"> & {
    repository?: Partial<MemoryWorkerRepository> & Record<string, unknown>;
  } = {},
) {
  const calls: Record<string, unknown[]> = {};
  const record =
    <T>(name: string, result: T) =>
    async (input: unknown) => {
      calls[name] = [...(calls[name] ?? []), input];
      return result;
    };
  const events: EventPublisher = { publish: vi.fn(async () => undefined) };
  const repository: MemoryWorkerRepository = {
    claimPendingEmbeddingItems: record("claimPendingEmbeddingItems", [
      {
        ...item(),
        claim_token: "55555555-5555-4555-8555-555555555555",
        item_revision: NOW.toISOString(),
      },
    ]),
    getEmbeddingBatchState: record("getEmbeddingBatchState", "owned"),
    getEmbeddingItem: record("getEmbeddingItem", item()),
    completeEmbedding: record("completeEmbedding", true),
    completeEmbeddingBatch: record("completeEmbeddingBatch", true),
    resetEmbedding: record("resetEmbedding", true),
    skipExpiredOrSuperseded: record("skipExpiredOrSuperseded", 0),
    ...overrides.repository,
  };
  const base = createMemoryWorkerDependencies({
    repository,
    embeddings: {
      model: "test-embedding-model",
      dimensions: 1536,
      embed: vi.fn(async () => [Array.from({ length: 1536 }, () => 0.25)]),
    },
    events,
    now: () => NOW,
  });
  return { dependencies: { ...base, ...overrides, repository }, calls, events };
}

const embedPayload = {
  taskName: "memory.embed-items",
  organizationId: ORGANIZATION_ID,
  correlationId: CORRELATION_ID,
  idempotencyKey: "embed-items-2026-08-09",
};

describe("memory.embed-items", () => {
  it("selects no more than 64 tenant-scoped pending items and writes each ready vector atomically", async () => {
    const pending = Array.from({ length: MAX_EMBEDDING_BATCH_SIZE + 1 }, (_, index) =>
      item({
        id: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
        title: `Note ${index}`,
        structured_value: { mustNeverReachEmbedding: "private structured value" },
      }),
    );
    const { dependencies, calls } = buildDependencies({
      repository: {
        claimPendingEmbeddingItems: async (input) => {
          calls.claimPendingEmbeddingItems = [input];
          return pending.slice(0, input.limit).map((pendingItem) => ({
            ...pendingItem,
            claim_token: input.claimToken,
            item_revision: NOW.toISOString(),
          }));
        },
        completeEmbedding: async (input) => {
          calls.completeEmbedding = [...(calls.completeEmbedding ?? []), input];
          return true;
        },
      },
    });

    await expect(runEmbedItems(embedPayload, dependencies)).resolves.toEqual({
      outcome: "succeeded",
      embedded: MAX_EMBEDDING_BATCH_SIZE,
      failed: 0,
      skipped: 0,
    });

    expect(calls.claimPendingEmbeddingItems?.[0]).toMatchObject({
      organizationId: ORGANIZATION_ID,
      idempotencyKey: embedPayload.idempotencyKey,
      limit: MAX_EMBEDDING_BATCH_SIZE,
    });
    expect(calls.completeEmbedding).toHaveLength(MAX_EMBEDDING_BATCH_SIZE);
    expect(calls.completeEmbedding?.[0]).toMatchObject({
      organizationId: ORGANIZATION_ID,
      embeddingStatus: "ready",
      embeddingModel: "test-embedding-model",
      embeddingUpdatedAt: NOW.toISOString(),
      embedding: Array.from({ length: 1536 }, () => 0.25),
    });
    const embed = dependencies.embeddings?.embed;
    expect(embed).toBeDefined();
    expect(vi.mocked(embed!).mock.calls[0]?.[0]?.texts[0]).toBe(
      "Note 0\n\nSchedule two people for the evening shift.",
    );
  });

  it("marks an item failed after bounded embedding attempts, emits only safe event data, and does not remove lexical retrieval", async () => {
    const embed = vi.fn(async () => {
      throw new Error("provider body with item content must not be published");
    });
    const { dependencies, calls, events } = buildDependencies({
      embeddings: { model: "test-embedding-model", dimensions: 1536, embed },
    });

    await expect(runEmbedItems(embedPayload, dependencies)).resolves.toEqual({
      outcome: "partially_succeeded",
      embedded: 0,
      failed: 1,
      skipped: 0,
    });

    expect(embed).toHaveBeenCalledTimes(3);
    expect(calls.completeEmbedding?.[0]).toMatchObject({
      organizationId: ORGANIZATION_ID,
      itemId: ITEM_ID,
      embeddingStatus: "failed",
      embeddingUpdatedAt: NOW.toISOString(),
    });
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "memory.embedding_failed",
        organizationId: ORGANIZATION_ID,
        correlationId: CORRELATION_ID,
        payload: { itemId: ITEM_ID, attempts: 3 },
      }),
    );
    expect(calls.completeEmbedding).toHaveLength(1);
  });

  it("rejects an invalid tenant payload before querying a privileged repository", async () => {
    const { dependencies, calls } = buildDependencies();

    await expect(
      runEmbedItems({ ...embedPayload, organizationId: "not-a-uuid" }, dependencies),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(calls.claimPendingEmbeddingItems).toBeUndefined();
  });

  it("throws a retryable conflict instead of succeeding while another run owns the same batch", async () => {
    const embed = vi.fn(async () => [Array.from({ length: 1536 }, () => 0.25)]);
    const { dependencies, calls } = buildDependencies({
      embeddings: { model: "test-embedding-model", dimensions: 1536, embed },
      repository: {
        claimPendingEmbeddingItems: async () => [],
        getEmbeddingBatchState: async () => "active",
      },
    });

    await expect(runEmbedItems(embedPayload, dependencies)).rejects.toMatchObject({
      code: "CONFLICT",
      retryable: true,
    });

    expect(embed).not.toHaveBeenCalled();
    expect(calls.completeEmbeddingBatch).toBeUndefined();
  });

  it("propagates a database completion failure without converting it into an embedding failure", async () => {
    const writeFailure = new Error("database unavailable");
    const completeEmbedding = vi.fn(async () => Promise.reject(writeFailure));
    const { dependencies, events } = buildDependencies({
      repository: {
        completeEmbedding,
      },
    });

    await expect(runEmbedItems(embedPayload, dependencies)).rejects.toBe(writeFailure);

    expect(completeEmbedding).toHaveBeenCalledTimes(1);
    expect(events.publish).not.toHaveBeenCalled();
  });

  it("invalidates once when a terminal write acknowledgement fails after persisting", async () => {
    const writeAcknowledgementFailure = new Error("response lost after write");
    const invalidated: string[] = [];
    let persisted = false;
    const { dependencies, events } = buildDependencies({
      cache: {
        invalidateOrganization: async (organizationId) => void invalidated.push(organizationId),
      },
      repository: {
        completeEmbedding: async () => {
          persisted = true;
          throw writeAcknowledgementFailure;
        },
      },
    });

    await expect(runEmbedItems(embedPayload, dependencies)).rejects.toBe(
      writeAcknowledgementFailure,
    );

    expect(persisted).toBe(true);
    expect(invalidated).toEqual([ORGANIZATION_ID]);
    expect(events.publish).not.toHaveBeenCalled();
  });

  it("invalidates once before propagating a later completion failure after an earlier commit", async () => {
    const failure = new Error("second completion failed");
    const invalidated: string[] = [];
    let completions = 0;
    const { dependencies } = buildDependencies({
      cache: {
        invalidateOrganization: async (organizationId) => void invalidated.push(organizationId),
      },
      repository: {
        claimPendingEmbeddingItems: async ({ claimToken }) => [
          { ...item(), claim_token: claimToken, item_revision: NOW.toISOString() },
          {
            ...item({ id: "55555555-5555-4555-8555-555555555555" }),
            claim_token: claimToken,
            item_revision: NOW.toISOString(),
          },
        ],
        completeEmbedding: async () => {
          completions += 1;
          if (completions === 2) throw failure;
          return true;
        },
      },
    });

    await expect(runEmbedItems(embedPayload, dependencies)).rejects.toBe(failure);

    expect(invalidated).toEqual([ORGANIZATION_ID]);
  });

  it("invalidates once before propagating a batch-finalization failure after a commit", async () => {
    const failure = new Error("batch finalization failed");
    const invalidated: string[] = [];
    const { dependencies } = buildDependencies({
      cache: {
        invalidateOrganization: async (organizationId) => void invalidated.push(organizationId),
      },
      repository: { completeEmbeddingBatch: async () => Promise.reject(failure) },
    });

    await expect(runEmbedItems(embedPayload, dependencies)).rejects.toBe(failure);

    expect(invalidated).toEqual([ORGANIZATION_ID]);
  });

  it("stops provider retries on cancellation without marking a failure or publishing an event", async () => {
    const controller = new AbortController();
    const embed = vi.fn(async () => {
      controller.abort();
      throw new Error("provider aborted");
    });
    const { dependencies, calls, events } = buildDependencies({
      signal: controller.signal,
      embeddings: { model: "test-embedding-model", dimensions: 1536, embed },
    });

    await expect(runEmbedItems(embedPayload, dependencies)).resolves.toEqual({
      outcome: "cancelled",
      embedded: 0,
      failed: 0,
      skipped: 0,
    });

    expect(embed).toHaveBeenCalledTimes(1);
    expect(calls.completeEmbedding).toBeUndefined();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it("atomically leases a pending row so concurrent or replayed runs invoke the provider once", async () => {
    let held = false;
    let releaseEmbedding: (() => void) | undefined;
    const embeddingStarted = new Promise<void>((resolve) => {
      releaseEmbedding = resolve;
    });
    const embed = vi.fn(async () => {
      await embeddingStarted;
      return [Array.from({ length: 1536 }, () => 0.25)];
    });
    const claims: unknown[] = [];
    const claimPendingEmbeddingItems = vi.fn(async (input: { claimToken: string }) => {
      claims.push(input);
      if (held) return [];
      held = true;
      return [{ ...item(), claim_token: input.claimToken, item_revision: NOW.toISOString() }];
    });
    const repository = {
      listPendingEmbeddingItems: async () => [item()],
      getEmbeddingItem: async () => null,
      writeEmbedding: async () => true,
      markEmbeddingFailed: async () => true,
      resetEmbedding: async () => true,
      skipExpiredOrSuperseded: async () => 0,
      claimPendingEmbeddingItems,
      completeEmbedding: async () => true,
    };
    const { dependencies } = buildDependencies({
      repository,
      embeddings: { model: "test-embedding-model", dimensions: 1536, embed },
    });

    const first = runEmbedItems(embedPayload, dependencies);
    const second = runEmbedItems(embedPayload, dependencies);
    await vi.waitFor(() => expect(embed).toHaveBeenCalledTimes(1));
    releaseEmbedding?.();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { outcome: "succeeded", embedded: 1, failed: 0, skipped: 0 },
      { outcome: "succeeded", embedded: 0, failed: 0, skipped: 0 },
    ]);
    expect(claims).toHaveLength(2);
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it("does not complete a stale lease after an item is superseded while embedding is in flight", async () => {
    let superseded = false;
    let releaseEmbedding: (() => void) | undefined;
    const embeddingStarted = new Promise<void>((resolve) => {
      releaseEmbedding = resolve;
    });
    const claimPendingEmbeddingItems = vi.fn(async (input: { claimToken: string }) => [
      { ...item(), claim_token: input.claimToken, item_revision: NOW.toISOString() },
    ]);
    const repository = {
      listPendingEmbeddingItems: async () => [item()],
      getEmbeddingItem: async () => null,
      writeEmbedding: async () => {
        if (superseded) throw new Error("stale write incorrectly reached the repository");
        return true;
      },
      markEmbeddingFailed: async () => {
        if (superseded) throw new Error("stale failure incorrectly reached the repository");
        return true;
      },
      resetEmbedding: async () => true,
      skipExpiredOrSuperseded: async () => 0,
      claimPendingEmbeddingItems,
      completeEmbedding: async () => !superseded,
    };
    const { dependencies, calls, events } = buildDependencies({
      repository,
      embeddings: {
        model: "test-embedding-model",
        dimensions: 1536,
        embed: async () => {
          await embeddingStarted;
          return [Array.from({ length: 1536 }, () => 0.25)];
        },
      },
    });

    const running = runEmbedItems(embedPayload, dependencies);
    await vi.waitFor(() => expect(claimPendingEmbeddingItems).toHaveBeenCalledTimes(1));
    superseded = true;
    releaseEmbedding?.();

    await expect(running).resolves.toEqual({
      outcome: "succeeded",
      embedded: 0,
      failed: 0,
      skipped: 1,
    });
    expect(calls.markEmbeddingFailed).toBeUndefined();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it("stops after an aborted first completion, preserves committed counts, and invalidates once", async () => {
    const controller = new AbortController();
    const invalidated: string[] = [];
    let writes = 0;
    const embed = vi.fn(async () => [Array.from({ length: 1536 }, () => 0.25)]);
    const { dependencies } = buildDependencies({
      signal: controller.signal,
      cache: {
        invalidateOrganization: async (organizationId) => void invalidated.push(organizationId),
      },
      embeddings: { model: "test-embedding-model", dimensions: 1536, embed },
      repository: {
        claimPendingEmbeddingItems: async ({ claimToken }) => [
          { ...item(), claim_token: claimToken, item_revision: NOW.toISOString() },
          {
            ...item({ id: "55555555-5555-4555-8555-555555555555" }),
            claim_token: claimToken,
            item_revision: NOW.toISOString(),
          },
        ],
        completeEmbedding: async () => {
          writes += 1;
          controller.abort();
          return true;
        },
      },
    });

    await expect(runEmbedItems(embedPayload, dependencies)).resolves.toEqual({
      outcome: "cancelled",
      embedded: 1,
      failed: 0,
      skipped: 0,
    });

    expect(writes).toBe(1);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(invalidated).toEqual([ORGANIZATION_ID]);
  });
});

describe("memory.reembed-item", () => {
  it("carries the eligible item's revision and decision time into an atomic reset", async () => {
    const { dependencies, calls } = buildDependencies({
      repository: {
        listPendingEmbeddingItems: async () => [],
        getEmbeddingItem: async (input) => {
          calls.getEmbeddingItem = [input];
          return item({ embedding_status: "ready", embedding_model: "old-model" });
        },
        writeEmbedding: async () => true,
        markEmbeddingFailed: async () => true,
        resetEmbedding: async (input) => {
          calls.resetEmbedding = [input];
          return true;
        },
        skipExpiredOrSuperseded: async () => 0,
      },
    });

    await expect(
      runReembedItem(
        {
          taskName: "memory.reembed-item",
          organizationId: ORGANIZATION_ID,
          itemId: ITEM_ID,
          correlationId: CORRELATION_ID,
          idempotencyKey: "reembed-item-2026-08-09",
        },
        dependencies,
      ),
    ).resolves.toEqual({ outcome: "succeeded", reset: true });

    expect(calls.getEmbeddingItem).toEqual([{ organizationId: ORGANIZATION_ID, itemId: ITEM_ID }]);
    expect(calls.resetEmbedding).toEqual([
      {
        organizationId: ORGANIZATION_ID,
        itemId: ITEM_ID,
        expectedRevision: "2026-08-09T00:00:00.000Z",
        now: NOW.toISOString(),
        embeddingUpdatedAt: null,
      },
    ]);
  });

  it("returns no reset when the repository rejects a row that expired after the read", async () => {
    const { dependencies, calls } = buildDependencies({
      repository: {
        getEmbeddingItem: async () => item({ embedding_status: "ready" }),
        resetEmbedding: async (input) => {
          calls.resetEmbedding = [input];
          return false;
        },
      },
    });

    await expect(
      runReembedItem(
        {
          taskName: "memory.reembed-item",
          organizationId: ORGANIZATION_ID,
          itemId: ITEM_ID,
          correlationId: CORRELATION_ID,
          idempotencyKey: "reembed-item-expired-during-update",
        },
        dependencies,
      ),
    ).resolves.toEqual({ outcome: "succeeded", reset: false });

    expect(calls.resetEmbedding).toEqual([
      expect.objectContaining({
        expectedRevision: "2026-08-09T00:00:00.000Z",
        now: NOW.toISOString(),
      }),
    ]);
  });

  it("does not reset an item returned from a different tenant", async () => {
    const { dependencies, calls } = buildDependencies({
      repository: {
        listPendingEmbeddingItems: async () => [],
        getEmbeddingItem: async () => item({ organization_id: OTHER_ORGANIZATION_ID }),
        writeEmbedding: async () => true,
        markEmbeddingFailed: async () => true,
        resetEmbedding: async (input) => {
          calls.resetEmbedding = [input];
          return true;
        },
        skipExpiredOrSuperseded: async () => 0,
      },
    });

    await expect(
      runReembedItem(
        {
          taskName: "memory.reembed-item",
          organizationId: ORGANIZATION_ID,
          itemId: ITEM_ID,
          correlationId: CORRELATION_ID,
          idempotencyKey: "reembed-item-2026-08-09",
        },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: "TENANT_SCOPE_ERROR" });
    expect(calls.resetEmbedding).toBeUndefined();
  });
});

describe("memory.expire-items", () => {
  it("marks only newly expired or superseded tenant rows skipped and invalidates once after the sweep", async () => {
    const invalidated: string[] = [];
    const { dependencies, calls } = buildDependencies({
      cache: {
        invalidateOrganization: async (organizationId) => void invalidated.push(organizationId),
      },
      repository: {
        listPendingEmbeddingItems: async () => [],
        getEmbeddingItem: async () => null,
        writeEmbedding: async () => true,
        markEmbeddingFailed: async () => true,
        resetEmbedding: async () => true,
        skipExpiredOrSuperseded: async (input) => {
          calls.skipExpiredOrSuperseded = [input];
          return 2;
        },
      },
    });

    await expect(
      runExpireItems(
        {
          taskName: "memory.expire-items",
          organizationId: ORGANIZATION_ID,
          correlationId: CORRELATION_ID,
          idempotencyKey: "expire-items-2026-08-09",
        },
        dependencies,
      ),
    ).resolves.toEqual({ outcome: "succeeded", skipped: 2 });

    expect(calls.skipExpiredOrSuperseded).toEqual([
      { organizationId: ORGANIZATION_ID, now: NOW.toISOString() },
    ]);
    expect(invalidated).toEqual([ORGANIZATION_ID]);
  });

  it("does not let a cache outage roll back an already completed expiry sweep", async () => {
    const { dependencies } = buildDependencies({
      cache: { invalidateOrganization: async () => Promise.reject(new Error("cache unavailable")) },
      repository: {
        listPendingEmbeddingItems: async () => [],
        getEmbeddingItem: async () => null,
        writeEmbedding: async () => true,
        markEmbeddingFailed: async () => true,
        resetEmbedding: async () => true,
        skipExpiredOrSuperseded: async () => 1,
      },
    });

    await expect(
      runExpireItems(
        {
          taskName: "memory.expire-items",
          organizationId: ORGANIZATION_ID,
          correlationId: CORRELATION_ID,
          idempotencyKey: "expire-items-cache-failure",
        },
        dependencies,
      ),
    ).resolves.toEqual({ outcome: "succeeded", skipped: 1 });
  });
});
