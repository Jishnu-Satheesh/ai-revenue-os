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

function createService(repositoryOverrides: Partial<MemoryRepository> = {}) {
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
      supersede: async () => ({ replacementId: "new-id", supersededId: "old-id" }),
    },
    now: () => new Date("2026-08-09T12:00:00.000Z"),
  });

  return { service, published, invalidated, inserted, updated };
}

const operator = { userId: "user-1", role: "operator" as const };
const viewer = { userId: "user-2", role: "viewer" as const };
const admin = { userId: "user-3", role: "admin" as const };

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
    const { service, published } = createService();

    await service.updateItem({
      organizationId: ORGANIZATION_ID,
      actor: operator,
      itemId: "item-1",
      body: { action: "reject", reason: "The owner disagreed.", idempotencyKey: "key-1" },
    });

    const event = published.find((entry) => entry.eventName === "memory.item_rejected");
    expect(event?.payload).toMatchObject({ reasonProvided: true });
    expect(JSON.stringify(event?.payload)).not.toContain("The owner disagreed");
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
