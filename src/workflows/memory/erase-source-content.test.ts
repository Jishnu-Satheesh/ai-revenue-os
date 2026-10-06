import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  eraseSourceContentPayloadSchema,
  runEraseSourceContent,
} from "@/workflows/memory/erase-source-content";

const PAYLOAD = {
  taskName: "memory.erase-source-content",
  organizationId: "11111111-1111-4111-8111-111111111111",
  correlationId: "22222222-2222-4222-8222-222222222222",
  idempotencyKey: "erase-source-content-key-01",
  sourceKind: "channel_finding",
  sourceId: "33333333-3333-4333-8333-333333333333",
  reason: "Operator rights request",
} as const;

describe("eraseSourceContentPayloadSchema", () => {
  it("accepts a bounded audited erasure request", () => {
    expect(eraseSourceContentPayloadSchema.safeParse(PAYLOAD).success).toBe(true);
  });

  it("refuses an unbounded reason and an unknown source kind", () => {
    expect(
      eraseSourceContentPayloadSchema.safeParse({ ...PAYLOAD, reason: "x".repeat(301) }).success,
    ).toBe(false);
    expect(
      eraseSourceContentPayloadSchema.safeParse({ ...PAYLOAD, sourceKind: "channel" }).success,
    ).toBe(false);
  });

  it("is registered for every erasure source identity", () => {
    const kinds = [
      "channel_finding",
      "channel_recommendation",
      "channel_decision",
      "market_claim",
      "growth_item",
      "growth_decision",
      "campaign_state",
      "campaign_outcome",
      "campaign_lesson",
      "memory_item",
    ];
    for (const sourceKind of kinds) {
      expect(eraseSourceContentPayloadSchema.safeParse({ ...PAYLOAD, sourceKind }).success).toBe(true);
    }
  });
});

describe("runEraseSourceContent", () => {
  it("calls the erasure RPC by source identity and reports bounded counts", async () => {
    const eraseSourceContent = vi.fn(async () => ({
      sourceId: PAYLOAD.sourceId,
      erasedEvents: 1,
      erasedItems: 1,
      erasedEntries: 2,
    }));
    const outcome = await runEraseSourceContent(PAYLOAD, { erasure: { eraseSourceContent } });
    expect(outcome).toEqual({ outcome: "succeeded", erasedEvents: 1, erasedItems: 1, erasedEntries: 2 });
    expect(eraseSourceContent).toHaveBeenCalledWith({
      organizationId: PAYLOAD.organizationId,
      actorId: null,
      sourceKind: PAYLOAD.sourceKind,
      sourceId: PAYLOAD.sourceId,
      reason: PAYLOAD.reason,
    });
  });

  it("refuses an invalid payload without touching the database", async () => {
    const eraseSourceContent = vi.fn();
    await expect(
      runEraseSourceContent({ ...PAYLOAD, sourceId: "not-a-uuid" }, { erasure: { eraseSourceContent } }),
    ).rejects.toThrow();
    expect(eraseSourceContent).not.toHaveBeenCalled();
  });

  it("honours cancellation before any database call", async () => {
    const eraseSourceContent = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const outcome = await runEraseSourceContent(PAYLOAD, {
      erasure: { eraseSourceContent },
      signal: controller.signal,
    });
    expect(outcome).toEqual({ outcome: "cancelled", erased: 0 });
    expect(eraseSourceContent).not.toHaveBeenCalled();
  });
});
