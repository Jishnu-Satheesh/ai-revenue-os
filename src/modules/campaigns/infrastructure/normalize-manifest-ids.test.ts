import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: {} }));

import { normalizeManifestIds } from "@/modules/campaigns/infrastructure/campaign-planner";

const AUTH = {
  campaignId: "c0000000-0000-4000-8000-000000000001",
  policy: { offer: "lunch-set-menu-2026-09", factKeys: ["lunch_covers_gap"] },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function candidate() {
  return {
    directions: [
      { id: "dir-control", kind: "control", assetIds: ["asset-1"] },
      { id: "dir-evidence", kind: "evidence_led", assetIds: ["asset-2"] },
    ],
    assets: [{ id: "asset-1" }, { id: "asset-2" }],
    actions: [
      { id: "act-1", directionId: "dir-control" },
      { id: "act-2", directionId: "dir-evidence" },
    ],
  };
}

describe("model identifiers become real UUIDs", () => {
  it("overwrites the campaign id with the real one rather than trusting the model", () => {
    const input = {
      campaignId: "whatever-the-model-said",
      directions: [],
      assets: [],
      actions: [],
    };

    const result = normalizeManifestIds(input, AUTH) as typeof input;

    expect(result.campaignId).toBe(AUTH.campaignId);
  });

  it("rewrites every declared id into a v4 UUID", () => {
    const result = normalizeManifestIds(candidate(), AUTH) as ReturnType<typeof candidate>;

    for (const row of [...result.directions, ...result.assets, ...result.actions]) {
      expect(row.id).toMatch(UUID);
    }
  });

  it("keeps references pointing at the same things they did before", () => {
    const result = normalizeManifestIds(candidate(), AUTH) as ReturnType<typeof candidate>;

    const controlId = result.directions[0]!.id;
    const evidenceId = result.directions[1]!.id;
    expect(result.actions[0]!.directionId).toBe(controlId);
    expect(result.actions[1]!.directionId).toBe(evidenceId);
    expect(result.directions[0]!.assetIds[0]).toBe(result.assets[0]!.id);
    expect(result.directions[1]!.assetIds[0]).toBe(result.assets[1]!.id);
  });

  it("gives two different handles two different UUIDs", () => {
    const result = normalizeManifestIds(candidate(), AUTH) as ReturnType<typeof candidate>;
    const ids = [...result.directions, ...result.assets, ...result.actions].map((row) => row.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("leaves an id that is already a valid UUID exactly as it was", () => {
    const existing = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    const input = {
      directions: [{ id: existing, assetIds: [] }],
      assets: [],
      actions: [],
    };

    const result = normalizeManifestIds(input, AUTH) as typeof input;

    expect(result.directions[0]!.id).toBe(existing);
  });

  it("does not invent a target for a reference that points at nothing", () => {
    const input = {
      directions: [{ id: "dir-control", assetIds: ["asset-that-does-not-exist"] }],
      assets: [],
      actions: [{ id: "act-1", directionId: "dir-missing" }],
    };

    const result = normalizeManifestIds(input, AUTH) as typeof input;

    // Left untouched, so the dangling reference is still rejected downstream.
    // Repairing the format must never repair a broken proposal.
    expect(result.directions[0]!.assetIds[0]).toBe("asset-that-does-not-exist");
    expect(result.actions[0]!.directionId).toBe("dir-missing");
  });

  it("leaves everything that is not an identifier alone", () => {
    const input = {
      objective: "Raise weekday margin",
      directions: [{ id: "d1", kind: "control", name: "Steady table", assetIds: [] }],
      assets: [],
      actions: [],
    };

    const result = normalizeManifestIds(input, AUTH) as typeof input;

    expect(result.objective).toBe("Raise weekday margin");
    expect(result.directions[0]!.kind).toBe("control");
    expect(result.directions[0]!.name).toBe("Steady table");
  });

  it("passes through anything that is not an object", () => {
    expect(normalizeManifestIds(null, AUTH)).toBeNull();
    expect(normalizeManifestIds("not json", AUTH)).toBe("not json");
  });
});

describe("the generation policy is derived, never proposed", () => {
  function scheduled() {
    return {
      directions: [
        { id: "d1", kind: "control", assetIds: [] },
        { id: "d2", kind: "evidence_led", assetIds: [] },
        { id: "d3", kind: "experimental", assetIds: [] },
      ],
      assets: [],
      actions: [
        { id: "a1", directionId: "d1", scheduledFor: "2026-09-01T14:00:00.000Z" },
        { id: "a2", directionId: "d3", scheduledFor: "2026-09-05T14:00:00.000Z" },
        { id: "a3", directionId: "d2", scheduledFor: "2026-09-03T14:00:00.000Z" },
      ],
    };
  }

  it("replaces a policy the model tried to grant itself", () => {
    const input = {
      ...scheduled(),
      generationPolicy: {
        maxVariantsPerDirection: 500,
        maxVariantsTotal: 5_000,
        policyExpiresAt: "2099-01-01T00:00:00.000Z",
        lockedOfferRef: null,
        lockedAssertionKeys: ["award.best_lunch_2026"],
      },
    };

    const policy = (normalizeManifestIds(input, AUTH) as Record<string, unknown>)
      .generationPolicy as Record<string, unknown>;

    expect(policy.maxVariantsPerDirection).toBe(4);
    expect(policy.policyExpiresAt).toBe("2026-09-05T14:00:00.000Z");
    expect(policy.lockedAssertionKeys).toEqual(["lunch_covers_gap"]);
  });

  it("ends the window at the last scheduled action, whatever order they arrived in", () => {
    const policy = (normalizeManifestIds(scheduled(), AUTH) as Record<string, unknown>)
      .generationPolicy as Record<string, unknown>;

    expect(policy.policyExpiresAt).toBe("2026-09-05T14:00:00.000Z");
  });

  it("sizes the total so no direction can be starved by another", () => {
    const policy = (normalizeManifestIds(scheduled(), AUTH) as Record<string, unknown>)
      .generationPolicy as Record<string, unknown>;

    expect(policy.maxVariantsTotal).toBe(12);
  });

  it("locks only the offer the campaign actually recorded", () => {
    const policy = (
      normalizeManifestIds(scheduled(), {
        ...AUTH,
        policy: { offer: null, factKeys: [] },
      }) as Record<string, unknown>
    ).generationPolicy as Record<string, unknown>;

    expect(policy.lockedOfferRef).toBeNull();
    expect(policy.lockedAssertionKeys).toEqual([]);
  });
});
