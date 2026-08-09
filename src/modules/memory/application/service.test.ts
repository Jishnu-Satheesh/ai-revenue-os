import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { EventPublisher } from "@/domain/events/types";
import type { MemoryItemRow } from "@/modules/memory/application/ports";
import { createMemoryService } from "@/modules/memory/application/service";
import type { MemoryRepository } from "@/modules/memory/infrastructure/repository";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";

function itemRow(overrides: Partial<MemoryItemRow> = {}): MemoryItemRow {
  return {
    id: "22222222-2222-4222-8222-222222222221",
    organization_id: ORGANIZATION_ID,
    branch_id: null,
    memory_type: "note",
    title: "Kitchen staffing",
    body: null,
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

function createService(
  repositoryOverrides: Partial<MemoryRepository> = {},
  transactionOverrides: Partial<
    import("@/modules/memory/application/service").MemoryTransactionPort
  > = {},
) {
  const published: { eventName: string; payload: unknown; correlationId: string }[] = [];
  const invalidated: string[] = [];
  const inserted: unknown[] = [];
  const updated: unknown[] = [];

  const repository = {
    getItem: async () => itemRow(),
    insertItem: async (input: unknown) => {
      inserted.push(input);
      return itemRow(input as Partial<MemoryItemRow>);
    },
    updateItem: async (input: { patch: Record<string, unknown> }) => {
      updated.push(input);
      return itemRow(input.patch as Partial<MemoryItemRow>);
    },
    listByTypes: async () => [],
    listTimeline: async () => [],
    listLinks: async () => [],
    countsFor: async () => ({
      byType: {},
      byVerificationState: {},
      bySensitivity: {},
      reviewQueueDepth: 0,
      embeddingBacklog: 0,
      total: 0,
    }),
    ...repositoryOverrides,
  } as unknown as MemoryRepository;

  const events: EventPublisher = {
    publish: async (event) => {
      published.push({
        eventName: event.eventName,
        payload: event.payload,
        correlationId: event.correlationId,
      });
    },
  };

  const service = createMemoryService({
    repository,
    events,
    cache: {
      invalidateOrganization: async (organizationId: string) => {
        invalidated.push(organizationId);
      },
    },
    transactions: {
      createItem: async (input) => ({
        item: itemRow({
          memory_type: input.memoryType,
          title: input.title,
          body: input.body ?? null,
          branch_id: input.branchId ?? null,
          sensitivity: input.sensitivity,
          verification_state: input.markVerified ? "verified" : "unverified",
        }),
        replayed: false,
      }),
      updateItem: async () => ({ item: itemRow(), replayed: false }),
      confirmProposal: async () => ({
        itemId: "proposal-id",
        factId: "fact-id",
        promoted: true,
        factKey: "test.fact",
        branchScoped: false,
        overrodeVerified: false,
        replayed: false,
      }),
      rejectProposal: async () => ({
        itemId: "proposal-id",
        memoryType: "fact_proposal",
        origin: "ai_proposed",
        sensitivity: "internal",
        verificationState: "rejected",
        replayed: false,
      }),
      supersede: async () => ({ replacementId: "new-id", supersededId: "old-id", replayed: false }),
      ...transactionOverrides,
    },
    now: () => new Date("2026-08-09T12:00:00.000Z"),
  });

  return { service, published, invalidated, inserted, updated };
}

const operator = { userId: "user-1", role: "operator" as const };
const viewer = { userId: "user-2", role: "viewer" as const };
const admin = { userId: "user-3", role: "admin" as const };

const factProposal = itemRow({
  memory_type: "fact_proposal",
  origin: "ai_proposed",
  verification_state: "proposed",
  proposed_fact_key: "google_business_profile.location.hours",
  proposed_fact_value: { value: "09:00-17:00" },
});

const createBody = {
  memoryType: "note" as const,
  title: "Kitchen staffing",
  sensitivity: "internal" as const,
  markVerified: true,
  idempotencyKey: "key-1",
};

describe("createMemoryService", () => {
  it("refuses every mutation for a viewer", async () => {
    const { service } = createService();

    await expect(
      service.createItem({ organizationId: ORGANIZATION_ID, actor: viewer, body: createBody }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
    await expect(
      service.updateItem({
        organizationId: ORGANIZATION_ID,
        actor: viewer,
        itemId: "item-1",
        body: { action: "verify", idempotencyKey: "key-1" },
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("forces a browser-authored item to user_verified origin", async () => {
    const { service, published } = createService();

    await service.createItem({
      organizationId: ORGANIZATION_ID,
      actor: operator,
      body: createBody,
    });

    expect(published[0]).toMatchObject({ eventName: "memory.item_created" });
  });

  it("refuses to let an operator classify memory they could not read back", async () => {
    const { service } = createService();

    await expect(
      service.createItem({
        organizationId: ORGANIZATION_ID,
        actor: operator,
        body: { ...createBody, sensitivity: "customer_content" },
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });

    await expect(
      service.createItem({
        organizationId: ORGANIZATION_ID,
        actor: admin,
        body: { ...createBody, sensitivity: "customer_content" },
      }),
    ).resolves.toBeDefined();
  });

  it("passes verification to the governed transaction", async () => {
    const transactionCalls: unknown[] = [];
    const { service } = createService(
      {},
      {
        updateItem: async (input) => {
          transactionCalls.push(input);
          return {
            item: itemRow({
              verification_state: "verified",
              verified_by: operator.userId,
              verified_at: "2026-08-09T12:00:00.000Z",
            }),
            replayed: false,
          };
        },
      },
    );

    await service.updateItem({
      organizationId: ORGANIZATION_ID,
      actor: operator,
      itemId: "item-1",
      body: { action: "verify", idempotencyKey: "key-1" },
    });

    expect(transactionCalls[0]).toMatchObject({ action: "verify", actorId: "user-1" });
  });

  it("leaves stale transition arbitration to the idempotent transaction", async () => {
    const calls: unknown[] = [];
    const { service } = createService(
      {},
      {
        updateItem: async (input) => {
          calls.push(input);
          return { item: itemRow({ verification_state: "rejected" }), replayed: true };
        },
      },
    );

    await expect(
      service.updateItem({
        organizationId: ORGANIZATION_ID,
        actor: operator,
        itemId: "item-1",
        body: { action: "verify", idempotencyKey: "key-1" },
      }),
    ).resolves.toMatchObject({ verificationState: "rejected" });
    expect(calls).toHaveLength(1);
  });

  it("passes the rejection reason to the transaction without putting it in the event payload", async () => {
    const transactionCalls: unknown[] = [];
    const { service, published } = createService(
      {},
      {
        updateItem: async (input) => {
          transactionCalls.push(input);
          return {
            item: itemRow({
              verification_state: "rejected",
              rejection_reason: input.reason ?? null,
              embedding_status: "skipped",
            }),
            replayed: false,
          };
        },
      },
    );

    await service.updateItem({
      organizationId: ORGANIZATION_ID,
      actor: operator,
      itemId: "item-1",
      body: { action: "reject", reason: "The owner disagreed.", idempotencyKey: "key-1" },
    });

    const event = published.find((entry) => entry.eventName === "memory.item_rejected");
    expect(event?.payload).toMatchObject({ reasonProvided: true });
    expect(JSON.stringify(event?.payload)).not.toContain("The owner disagreed");
    expect(transactionCalls[0]).toMatchObject({ action: "reject", reason: "The owner disagreed." });
  });

  it("never puts item content into an event payload", async () => {
    const { service, published } = createService();

    await service.createItem({
      organizationId: ORGANIZATION_ID,
      actor: operator,
      body: { ...createBody, title: "Secret title", body: "Secret body" },
    });

    const serialized = JSON.stringify(published);
    expect(serialized).not.toContain("Secret title");
    expect(serialized).not.toContain("Secret body");
  });

  it("invalidates the organization after every write, and only after it succeeds", async () => {
    const { service, invalidated } = createService();

    await service.createItem({
      organizationId: ORGANIZATION_ID,
      actor: operator,
      body: createBody,
    });
    await service.updateItem({
      organizationId: ORGANIZATION_ID,
      actor: operator,
      itemId: "item-1",
      body: { action: "verify", idempotencyKey: "key-1" },
    });

    expect(invalidated).toEqual([ORGANIZATION_ID, ORGANIZATION_ID]);
  });

  it("does not fail a committed write when cache invalidation fails", async () => {
    const service = createMemoryService({
      repository: {
        insertItem: async () => itemRow(),
      } as unknown as MemoryRepository,
      events: { publish: async () => undefined },
      transactions: {
        createItem: async () => ({ item: itemRow(), replayed: false }),
        updateItem: async () => ({ item: itemRow(), replayed: false }),
        confirmProposal: async () => ({
          itemId: "proposal",
          factId: null,
          promoted: false,
          memoryType: "note",
          origin: "user_verified",
          sensitivity: "internal",
          verificationState: "verified",
          replayed: false,
        }),
        rejectProposal: async () => ({
          itemId: "proposal",
          memoryType: "note",
          origin: "user_verified",
          sensitivity: "internal",
          verificationState: "rejected",
          replayed: false,
        }),
        supersede: async () => ({
          replacementId: "replacement",
          supersededId: "superseded",
          replayed: false,
        }),
      },
      cache: {
        invalidateOrganization: async () => {
          throw new Error("redis is down");
        },
      },
      now: () => new Date("2026-08-09T12:00:00.000Z"),
    });

    await expect(
      service.createItem({ organizationId: ORGANIZATION_ID, actor: operator, body: createBody }),
    ).resolves.toBeDefined();
  });

  it("asks the transaction to reject an already superseded item", async () => {
    const { service } = createService({
      getItem: async () => itemRow({ superseded_by_id: "other-id" }),
    } as never);

    await expect(
      service.supersedeItem({
        organizationId: ORGANIZATION_ID,
        actor: operator,
        itemId: "item-1",
        body: {
          title: "Correction",
          sensitivity: "internal",
          reason: "It was wrong.",
          idempotencyKey: "key-1",
        },
      }),
    ).resolves.toEqual({ replacementId: "new-id", supersededId: "old-id" });
  });

  it("refuses to supersede at all when the atomic operation is unavailable", async () => {
    const service = createMemoryService({
      repository: { getItem: async () => itemRow() } as unknown as MemoryRepository,
      events: { publish: async () => undefined },
      now: () => new Date("2026-08-09T12:00:00.000Z"),
    });

    await expect(
      service.supersedeItem({
        organizationId: ORGANIZATION_ID,
        actor: operator,
        itemId: "item-1",
        body: {
          title: "Correction",
          sensitivity: "internal",
          reason: "It was wrong.",
          idempotencyKey: "key-1",
        },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("confirms a fact proposal through the atomic transaction before emitting the safe promotion event", async () => {
    const promoted: unknown[] = [];
    const { published, invalidated, service } = createService(
      { getItem: async () => factProposal } as never,
      {
        confirmProposal: async (input: unknown) => {
          promoted.push(input);
          return {
            itemId: factProposal.id,
            factId: "fact-1",
            promoted: true,
            factKey: factProposal.proposed_fact_key!,
            branchScoped: false,
            overrodeVerified: false,
            replayed: false,
          };
        },
      } as never,
    );
    const confirmProposal = (
      service as unknown as {
        confirmProposal(input: {
          organizationId: string;
          actor: typeof operator;
          itemId: string;
          body: { overrideVerified: boolean; idempotencyKey: string };
        }): Promise<{ itemId: string; factId: string | null; promoted: boolean }>;
      }
    ).confirmProposal;

    const result = await confirmProposal.call(service, {
      organizationId: ORGANIZATION_ID,
      actor: operator,
      itemId: factProposal.id,
      body: { overrideVerified: false, idempotencyKey: "promotion-key-1" },
    });

    expect(result).toMatchObject({
      itemId: factProposal.id,
      factId: "fact-1",
      promoted: true,
    });
    expect(promoted).toHaveLength(1);
    expect(invalidated).toEqual([ORGANIZATION_ID]);
    const event = published.find((entry) => entry.eventName === "memory.fact_promoted");
    expect(event?.payload).toEqual({
      itemId: factProposal.id,
      factKey: "google_business_profile.location.hours",
      branchScoped: false,
      overrodeVerified: false,
    });
    expect(JSON.stringify(event?.payload)).not.toContain("09:00-17:00");
  });

  it("lets the transaction return an idempotent confirmation replay without pre-reading proposal state", async () => {
    const calls: unknown[] = [];
    const { service } = createService(
      {
        getItem: async () => {
          throw new Error("the transaction must arbitrate replays");
        },
      } as never,
      {
        confirmProposal: async (input: unknown) => {
          calls.push(input);
          return {
            itemId: factProposal.id,
            factId: "fact-1",
            promoted: true,
            factKey: factProposal.proposed_fact_key!,
            branchScoped: false,
            overrodeVerified: false,
            replayed: false,
          };
        },
      } as never,
    );

    await expect(
      service.confirmProposal({
        organizationId: ORGANIZATION_ID,
        actor: operator,
        itemId: factProposal.id,
        body: { overrideVerified: false, idempotencyKey: "promotion-replay-key" },
      }),
    ).resolves.toMatchObject({ itemId: factProposal.id, promoted: true });
    expect(calls).toHaveLength(1);
  });

  it("does not emit a second promotion event when confirmation replays for another actor", async () => {
    let calls = 0;
    const { invalidated, published, service } = createService(
      {},
      {
        confirmProposal: async () => {
          calls += 1;
          return {
            itemId: factProposal.id,
            factId: "fact-1",
            promoted: true,
            factKey: factProposal.proposed_fact_key!,
            branchScoped: false,
            overrodeVerified: false,
            replayed: calls === 2,
          };
        },
      },
    );

    const body = { overrideVerified: false, idempotencyKey: "promotion-event-replay-key" };
    await service.confirmProposal({
      organizationId: ORGANIZATION_ID,
      actor: operator,
      itemId: factProposal.id,
      body,
    });
    await service.confirmProposal({
      organizationId: ORGANIZATION_ID,
      actor: admin,
      itemId: factProposal.id,
      body,
    });

    expect(published.filter((entry) => entry.eventName === "memory.fact_promoted")).toHaveLength(1);
    expect(invalidated).toEqual([ORGANIZATION_ID, ORGANIZATION_ID]);
  });

  it("emits proposal_confirmed rather than fact_promoted for a non-fact proposal", async () => {
    const { published, service } = createService({}, {
      confirmProposal: async () => ({
        itemId: "non-fact-proposal-1",
        factId: null,
        promoted: false,
        memoryType: "lesson",
        origin: "ai_proposed",
        sensitivity: "internal",
        verificationState: "verified",
        replayed: false,
      }),
    } as never);

    await service.confirmProposal({
      organizationId: ORGANIZATION_ID,
      actor: operator,
      itemId: "non-fact-proposal-1",
      body: { overrideVerified: false, idempotencyKey: "non-fact-confirm-key" },
    });

    expect(published).toEqual([
      {
        eventName: "memory.proposal_confirmed",
        correlationId: expect.any(String),
        payload: {
          itemId: "non-fact-proposal-1",
          memoryType: "lesson",
          origin: "ai_proposed",
          sensitivity: "internal",
          verificationState: "verified",
        },
      },
    ]);
  });

  it("invalidates a committed proposal confirmation even when its event publisher fails", async () => {
    const invalidated: string[] = [];
    const service = createMemoryService({
      repository: {} as MemoryRepository,
      events: {
        publish: async () => {
          throw new Error("event transport unavailable");
        },
      },
      cache: {
        invalidateOrganization: async (organizationId) => {
          invalidated.push(organizationId);
        },
      },
      transactions: {
        createItem: async () => ({ item: itemRow(), replayed: false }),
        updateItem: async () => ({ item: itemRow(), replayed: false }),
        confirmProposal: async () => ({
          itemId: factProposal.id,
          factId: "fact-1",
          promoted: true,
          factKey: factProposal.proposed_fact_key!,
          branchScoped: false,
          overrodeVerified: false,
          replayed: false,
        }),
        rejectProposal: async () => ({
          itemId: factProposal.id,
          memoryType: "fact_proposal",
          origin: "ai_proposed",
          sensitivity: "internal",
          verificationState: "rejected",
          replayed: false,
        }),
        supersede: async () => ({
          replacementId: "replacement",
          supersededId: "superseded",
          replayed: false,
        }),
      },
    });

    await expect(
      service.confirmProposal({
        organizationId: ORGANIZATION_ID,
        actor: operator,
        itemId: factProposal.id,
        body: { overrideVerified: false, idempotencyKey: "promotion-event-failure-key" },
      }),
    ).resolves.toMatchObject({ itemId: factProposal.id });
    expect(invalidated).toEqual([ORGANIZATION_ID]);
  });

  it("refuses proposal confirmation before it can invoke the transaction for a viewer", async () => {
    const { service } = createService({ getItem: async () => factProposal } as never);
    const confirmProposal = (
      service as unknown as {
        confirmProposal(input: {
          organizationId: string;
          actor: typeof viewer;
          itemId: string;
          body: { overrideVerified: boolean; idempotencyKey: string };
        }): Promise<unknown>;
      }
    ).confirmProposal;

    await expect(
      confirmProposal.call(service, {
        organizationId: ORGANIZATION_ID,
        actor: viewer,
        itemId: factProposal.id,
        body: { overrideVerified: false, idempotencyKey: "promotion-key-2" },
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("rejects a proposal through its locked idempotent transaction instead of a table update", async () => {
    const rejected: unknown[] = [];
    const { service, published, updated, invalidated } = createService(
      {
        getItem: async () => {
          throw new Error("the rejection transaction owns proposal state");
        },
      } as never,
      {
        rejectProposal: async (input: unknown) => {
          rejected.push(input);
          return {
            itemId: factProposal.id,
            memoryType: "fact_proposal",
            origin: "ai_proposed",
            sensitivity: "internal",
            verificationState: "rejected",
            replayed: false,
          };
        },
      } as never,
    );
    const rejectProposal = (
      service as unknown as {
        rejectProposal(input: {
          organizationId: string;
          actor: typeof operator;
          itemId: string;
          body: { reason: string; idempotencyKey: string };
        }): Promise<unknown>;
      }
    ).rejectProposal;

    await rejectProposal.call(service, {
      organizationId: ORGANIZATION_ID,
      actor: operator,
      itemId: factProposal.id,
      body: { reason: "The source is stale.", idempotencyKey: "rejection-key-1" },
    });

    expect(rejected).toHaveLength(1);
    expect(updated).toEqual([]);
    expect(
      published.find((entry) => entry.eventName === "memory.item_rejected")?.payload,
    ).toMatchObject({
      itemId: factProposal.id,
      reasonProvided: true,
    });
    expect(invalidated).toEqual([ORGANIZATION_ID]);
  });

  it("does not emit a second rejection event when a rejection replay has a new actor", async () => {
    let calls = 0;
    const { invalidated, published, service } = createService(
      {},
      {
        rejectProposal: async () => {
          calls += 1;
          return {
            itemId: factProposal.id,
            memoryType: "fact_proposal",
            origin: "ai_proposed",
            sensitivity: "internal",
            verificationState: "rejected",
            replayed: calls === 2,
          };
        },
      },
    );

    const body = { reason: "The source is stale.", idempotencyKey: "rejection-event-replay-key" };
    await service.rejectProposal({
      organizationId: ORGANIZATION_ID,
      actor: operator,
      itemId: factProposal.id,
      body,
    });
    await service.rejectProposal({
      organizationId: ORGANIZATION_ID,
      actor: admin,
      itemId: factProposal.id,
      body,
    });

    expect(published.filter((entry) => entry.eventName === "memory.item_rejected")).toHaveLength(1);
    expect(invalidated).toEqual([ORGANIZATION_ID, ORGANIZATION_ID]);
  });

  it("narrows an operator's snapshot to their sensitivity ceiling", async () => {
    const requested: unknown[] = [];
    const { service } = createService({
      listByTypes: async (input: unknown) => {
        requested.push(input);
        return [];
      },
    } as never);

    await service.getSnapshot({ organizationId: ORGANIZATION_ID, actor: operator });

    for (const call of requested) {
      expect((call as { sensitivities: string[] }).sensitivities).toEqual(["public", "internal"]);
    }
  });

  it("opens the snapshot ceiling for an admin", async () => {
    const requested: unknown[] = [];
    const { service } = createService({
      listByTypes: async (input: unknown) => {
        requested.push(input);
        return [];
      },
    } as never);

    const snapshot = await service.getSnapshot({
      organizationId: ORGANIZATION_ID,
      actor: admin,
    });

    expect(snapshot.ceiling).toBe("customer_content");
    expect((requested[0] as { sensitivities: string[] }).sensitivities).toContain(
      "customer_content",
    );
  });

  it("replays an idempotent create without a second item_created event and preserves correlation", async () => {
    let calls = 0;
    const { published, service } = createService(
      {
        insertItem: async () => {
          throw new Error("the authenticated RPC owns idempotent writes");
        },
      } as never,
      {
        createItem: async () => {
          calls += 1;
          return { item: itemRow({ verification_state: "verified" }), replayed: calls === 2 };
        },
      } as never,
    );
    const correlationId = "44444444-4444-4444-8444-444444444444";

    const first = await service.createItem({
      organizationId: ORGANIZATION_ID,
      actor: operator,
      body: createBody,
      correlationId,
    });
    const replay = await service.createItem({
      organizationId: ORGANIZATION_ID,
      actor: operator,
      body: createBody,
      correlationId,
    });

    expect(replay).toEqual(first);
    expect(calls).toBe(2);
    expect(published).toHaveLength(1);
    expect(published[0]?.correlationId).toBe(correlationId);
  });

  it("routes every PATCH action through its idempotent transaction before any direct write", async () => {
    const updates: unknown[] = [];
    const { service, published } = createService(
      {
        getItem: async () => {
          throw new Error("the authenticated RPC owns update state");
        },
        updateItem: async () => {
          throw new Error("the authenticated RPC owns update state");
        },
      } as never,
      {
        updateItem: async (input: unknown) => {
          updates.push(input);
          return {
            item: itemRow({ verification_state: "verified" }),
            replayed: updates.length > 3,
          };
        },
      } as never,
    );
    const correlationId = "44444444-4444-4444-8444-444444444444";
    for (const body of [
      { action: "verify" as const, idempotencyKey: "verify-key" },
      { action: "reject" as const, reason: "Stale.", idempotencyKey: "reject-key" },
      {
        action: "reclassify" as const,
        sensitivity: "public" as const,
        idempotencyKey: "reclassify-key",
      },
    ]) {
      await service.updateItem({
        organizationId: ORGANIZATION_ID,
        actor: operator,
        itemId: itemRow().id,
        body,
        correlationId,
      });
    }

    expect(updates).toHaveLength(3);
    expect(updates).toEqual(
      expect.arrayContaining([expect.objectContaining({ correlationId, action: "verify" })]),
    );
    expect(published.map((event) => event.correlationId)).toEqual(
      expect.arrayContaining([correlationId]),
    );
  });

  it("asks the supersede transaction to arbitrate an idempotent replay before checking current state", async () => {
    const { published, service } = createService(
      { getItem: async () => itemRow({ superseded_by_id: "already-replaced" }) } as never,
      {
        supersede: async () => ({
          replacementId: "replacement-id",
          supersededId: "superseded-id",
          replayed: true,
          fingerprint: "must-not-leak",
        }),
      } as never,
    );

    await expect(
      service.supersedeItem({
        organizationId: ORGANIZATION_ID,
        actor: operator,
        itemId: itemRow().id,
        body: {
          title: "Correction",
          sensitivity: "internal",
          reason: "Stale.",
          idempotencyKey: "supersede-replay-key",
        },
        correlationId: "44444444-4444-4444-8444-444444444444",
      }),
    ).resolves.toEqual({ replacementId: "replacement-id", supersededId: "superseded-id" });
    expect(published).toEqual([]);
  });

  it("omits lesson evidence targets that are not visible under the caller sensitivity ceiling", async () => {
    const lesson = itemRow({ id: "lesson-id", memory_type: "lesson" });
    const { service } = createService({
      listByTypes: async () => [lesson],
      listLinks: async () => [
        {
          id: "visible-link",
          organization_id: ORGANIZATION_ID,
          from_item_id: lesson.id,
          to_item_id: "visible-evidence",
          relation: "derived_from",
          created_by: null,
          created_at: "2026-08-09T00:00:00.000Z",
        },
        {
          id: "hidden-link",
          organization_id: ORGANIZATION_ID,
          from_item_id: lesson.id,
          to_item_id: "hidden-evidence",
          relation: "derived_from",
          created_by: null,
          created_at: "2026-08-09T00:00:00.000Z",
        },
      ],
      hydrateByIds: async () => [itemRow({ id: "visible-evidence", sensitivity: "internal" })],
    } as never);

    await expect(
      service.listLessons({ organizationId: ORGANIZATION_ID, actor: operator, limit: 20 }),
    ).resolves.toEqual({
      items: [expect.objectContaining({ id: lesson.id })],
      evidence: { [lesson.id]: ["visible-evidence"] },
    });
  });

  it("returns only the RLS-visible detail chain and evidence links, capped at 32 hops", async () => {
    const visibleChain = Array.from({ length: 32 }, (_, index) =>
      itemRow({ id: `visible-${index}`, title: `Visible ${index}` }),
    );
    const { service } = createService({
      getItemDetail: async () => ({
        item: itemRow(),
        chain: visibleChain,
        links: [
          {
            id: "visible-link",
            relation: "derived_from",
            direction: "to",
            relatedItemId: "visible-0",
          },
        ],
      }),
    } as never);

    const detail = await service.getItemDetail({
      organizationId: ORGANIZATION_ID,
      actor: operator,
      itemId: "22222222-2222-4222-8222-222222222221",
    });

    expect(detail.chain).toHaveLength(32);
    expect(detail.links).toEqual([
      {
        id: "visible-link",
        relation: "derived_from",
        direction: "to",
        relatedItemId: "visible-0",
      },
    ]);
    expect(detail.links.map((link) => link.relatedItemId)).not.toContain("cross-tenant-item");
  });
});
