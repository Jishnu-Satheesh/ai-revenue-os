import { describe, expect, it } from "vitest";

import {
  buildMemoryHealth,
  type HealthInput,
} from "@/modules/memory/application/health-service";

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";

function input(overrides: Partial<HealthInput> = {}): HealthInput {
  return {
    organizationId: ORGANIZATION,
    role: "owner",
    serverTime: "2026-09-12T00:00:00.000Z",
    adapters: [],
    contexts: [],
    embeddingBacklog: 0,
    ...overrides,
  };
}

describe("buildMemoryHealth", () => {
  it("aggregates per-adapter counts with backlog and retryable failures", () => {
    const health = buildMemoryHealth(
      input({
        adapters: [
          { sourceKind: "channel_finding", status: "pending", count: 3, lastSuccessAt: null },
          { sourceKind: "channel_finding", status: "claimed", count: 1, lastSuccessAt: null },
          {
            sourceKind: "channel_finding",
            status: "completed",
            count: 9,
            lastSuccessAt: "2026-09-11T10:00:00.000Z",
          },
          { sourceKind: "channel_finding", status: "failed", count: 2, lastSuccessAt: null },
          {
            sourceKind: "channel_recommendation",
            status: "quarantined",
            count: 1,
            lastSuccessAt: null,
          },
        ],
      }),
    );

    const findings = health.adapters.find((adapter) => adapter.sourceKind === "channel_finding");
    expect(findings).toMatchObject({
      pending: 3,
      claimed: 1,
      completed: 9,
      failed: 2,
      backlog: 4,
      retryable: 2,
      lastSuccessAt: "2026-09-11T10:00:00.000Z",
    });
    const recommendations = health.adapters.find(
      (adapter) => adapter.sourceKind === "channel_recommendation",
    );
    expect(recommendations).toMatchObject({ quarantined: 1, backlog: 0, retryable: 1 });
    expect(health.canRetry).toBe(true);
    expect(health.canConfigure).toBe(true);
  });

  it("hides retry affordances from viewers while keeping the same counts", () => {
    const health = buildMemoryHealth(
      input({
        role: "viewer",
        adapters: [{ sourceKind: "channel_finding", status: "failed", count: 4, lastSuccessAt: null }],
      }),
    );

    expect(health.adapters[0]).toMatchObject({ failed: 4, retryable: 0 });
    expect(health.canRetry).toBe(false);
    expect(health.canConfigure).toBe(false);
  });

  it("aggregates context use by purpose with totals", () => {
    const health = buildMemoryHealth(
      input({
        contexts: [
          { purpose: "channel_advice", status: "ready", count: 5, lastPreparedAt: "2026-09-10T00:00:00.000Z" },
          { purpose: "channel_advice", status: "unavailable", count: 1, lastPreparedAt: "2026-09-11T00:00:00.000Z" },
          { purpose: "channel_advice", status: "disabled", count: 2, lastPreparedAt: null },
        ],
      }),
    );

    expect(health.contexts).toEqual([
      {
        purpose: "channel_advice",
        ready: 5,
        empty: 0,
        partial: 0,
        unavailable: 1,
        disabled: 2,
        total: 8,
        lastPreparedAt: "2026-09-11T00:00:00.000Z",
      },
    ]);
  });

  it("renders an empty organization honestly instead of a silent success", () => {
    const health = buildMemoryHealth(input());

    expect(health.adapters).toEqual([]);
    expect(health.contexts).toEqual([]);
    expect(health.embeddingBacklog).toBe(0);
  });

  it("refuses invented statuses and negative counts at the boundary", () => {
    expect(() =>
      buildMemoryHealth(
        input({
          adapters: [{ sourceKind: "channel_finding", status: "archived", count: 1, lastSuccessAt: null } as never],
        }),
      ),
    ).toThrow();
    expect(() => buildMemoryHealth(input({ embeddingBacklog: -1 }))).toThrow();
  });
});
