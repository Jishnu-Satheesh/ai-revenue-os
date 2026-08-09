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
  const published: { eventName: string; payload: unknown }[] = [];
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
      published.push({ eventName: event.eventName, payload: event.payload });
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
      supersede: async () => ({ replacementId: "new-id", supersededId: "old-id" }),
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
    const { service, inserted } = createService();

    await service.createItem({
      organizationId: ORGANIZATION_ID,
      actor: operator,
      body: createBody,
    });

    expect(inserted[0]).toMatchObject({ origin: "user_verified", memory_type: "note" });
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

  it("sets both the verifying actor and the timestamp", async () => {
    const { service, updated } = createService();

    await service.updateItem({
      organizationId: ORGANIZATION_ID,
      actor: operator,
      itemId: "item-1",
      body: { action: "verify", idempotencyKey: "key-1" },
    });

    expect((updated[0] as { patch: Record<string, unknown> }).patch).toMatchObject({
      verification_state: "verified",
      verified_by: "user-1",
      verified_at: "2026-08-09T12:00:00.000Z",
    });
  });

  it("refuses to verify an item a person already rejected", async () => {
    const { service } = createService({
      getItem: async () => itemRow({ verification_state: "rejected" }),
    } as never);

    await expect(
      service.updateItem({
        organizationId: ORGANIZATION_ID,
        actor: operator,
        itemId: "item-1",
        body: { action: "verify", idempotencyKey: "key-1" },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("records the rejection reason without putting it in the event payload", async () => {
    const { service, published, updated } = createService();

    await service.updateItem({
      organizationId: ORGANIZATION_ID,
      actor: operator,
      itemId: "item-1",
      body: { action: "reject", reason: "The owner disagreed.", idempotencyKey: "key-1" },
    });

    const event = published.find((entry) => entry.eventName === "memory.item_rejected");
    expect(event?.payload).toMatchObject({ reasonProvided: true });
    expect(JSON.stringify(event?.payload)).not.toContain("The owner disagreed");
    expect(updated[0]).toMatchObject({ patch: { embedding_status: "skipped" } });
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

  it("refuses to supersede an item that is already superseded", async () => {
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
    ).rejects.toMatchObject({ code: "MEMORY_SUPERSESSION_INVALID" });
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
        supersede: async () => ({ replacementId: "replacement", supersededId: "superseded" }),
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
});
