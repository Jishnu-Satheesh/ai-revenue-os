import { describe, expect, it, vi } from "vitest";

import type { EventPublisher } from "@/domain/events/types";
import {
  createGrowthIntelligenceTriageService,
  type GrowthIntelligenceTriageStore,
} from "@/modules/growth-intelligence/application/triage-service";

const organizationId = "10000000-0000-4000-8000-000000000001";
const actorId = "20000000-0000-4000-8000-000000000002";
const itemId = "70000000-0000-4000-8000-000000000007";
const fingerprint = "a".repeat(64);

function store(
  overrides: Partial<GrowthIntelligenceTriageStore> = {},
): GrowthIntelligenceTriageStore {
  return {
    decide: vi
      .fn()
      .mockResolvedValue({ decisionId: "80000000-0000-4000-8000-000000000008", decision: "planned" }),
    setPreference: vi.fn().mockResolvedValue({ sourceKind: "synthesis_item", pinned: true }),
    ...overrides,
  };
}

function service(
  triage: GrowthIntelligenceTriageStore = store(),
  events: EventPublisher = { publish: vi.fn().mockResolvedValue(undefined) },
) {
  return { service: createGrowthIntelligenceTriageService({ triage, events }), triage, events };
}

describe("decideItem", () => {
  it("records the decision and emits an identifier-only triaged event", async () => {
    const { service: triage, triage: store, events } = service();
    const publish = vi.spyOn(events, "publish");

    const outcome = await triage.decideItem({
      organizationId,
      actorId,
      itemId,
      decision: "planned",
      reason: null,
      snoozedUntil: null,
      itemFingerprint: fingerprint,
      correlationId: "90000000-0000-4000-8000-000000000009",
    });

    expect(outcome).toEqual({
      decisionId: "80000000-0000-4000-8000-000000000008",
      decision: "planned",
    });
    expect(store.decide).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId, actorId, itemId, decision: "planned" }),
    );
    expect(publish).toHaveBeenCalledTimes(1);
    const event = publish.mock.calls[0]![0] as {
      eventName: string;
      organizationId: string;
      actorId: string;
      payload: Record<string, unknown>;
    };
    expect(event.eventName).toBe("growth_intelligence.item_triaged");
    expect(event.organizationId).toBe(organizationId);
    expect(event.actorId).toBe(actorId);
    expect(event.payload).toEqual({
      itemId,
      decisionId: "80000000-0000-4000-8000-000000000008",
    });
  });

  it("emits nothing when the committed outcome fails", async () => {
    const failing = store({
      decide: vi.fn().mockRejectedValue(new Error("denied")),
    });
    const events: EventPublisher = { publish: vi.fn().mockResolvedValue(undefined) };
    const triage = createGrowthIntelligenceTriageService({ triage: failing, events });
    const publish = vi.spyOn(events, "publish");

    await expect(
      triage.decideItem({
        organizationId,
        actorId,
        itemId,
        decision: "acknowledged",
        reason: null,
        snoozedUntil: null,
        itemFingerprint: fingerprint,
        correlationId: "90000000-0000-4000-8000-000000000009",
      }),
    ).rejects.toThrow("denied");
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("setPreference", () => {
  it("saves the actor-scoped preference without emitting organization policy events", async () => {
    const { service: triage, triage: store, events } = service();
    const publish = vi.spyOn(events, "publish");

    const outcome = await triage.setPreference({
      organizationId,
      actorId,
      sourceKind: "synthesis_item",
      sourceId: itemId,
      pinned: true,
      snoozedUntil: null,
    });

    expect(outcome).toEqual({ sourceKind: "synthesis_item", pinned: true });
    expect(store.setPreference).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId, actorId, sourceId: itemId, pinned: true }),
    );
    expect(publish).not.toHaveBeenCalled();
  });
});
