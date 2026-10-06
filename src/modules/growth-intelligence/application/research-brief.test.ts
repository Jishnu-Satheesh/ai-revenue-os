import { describe, expect, it } from "vitest";

import {
  assertExternalRequestHasOnlyPublicBytes,
  buildResearchBrief,
  describeBriefDegradation,
  orderSlotsByMemory,
  type ResearchBriefSlot,
} from "@/modules/growth-intelligence/application/research-brief";

const organizationId = "10000000-0000-4000-8000-000000000001";
const requestId = "20000000-0000-4000-8000-000000000002";
const profileVersionId = "70000000-0000-4000-8000-000000000007";
const correlationId = "60000000-0000-4000-8000-000000000006";
const manifestId = "50000000-0000-4000-8000-000000000005";
const digest = "a".repeat(64);
const sourcePolicyDigest = "c".repeat(64);

function slots(): ResearchBriefSlot[] {
  return [
    { slotKey: "local_market", kind: "local_market", text: '"Kerala Kitchen" Dubai AE', maxResults: 5 },
    { slotKey: "topic:local-events", kind: "topic", text: '"Local events" Dubai AE', maxResults: 5 },
    { slotKey: "competitor:rival", kind: "competitor", text: '"Rival" Dubai AE', maxResults: 5 },
  ];
}

describe("research brief", () => {
  it("pins the brief with manifest identity and preserves every approved slot", () => {
    const brief = buildResearchBrief({
      organizationId,
      requestId,
      branchId: null,
      profileVersionId,
      sourcePolicyDigest,
      attemptKey: "fb42-research-attempt-1",
      correlationId,
      slots: slots(),
      manifest: {
        manifestId,
        contextDigest: digest,
        status: "ready",
        contextRefs: ["ctx-0001", "ctx-0002"],
        degradedReasons: [],
      },
      qualified: true,
    });
    expect(brief.manifestId).toBe(manifestId);
    expect(brief.contextDigest).toBe(digest);
    expect(brief.status).toBe("ready");
    expect(brief.evidenceOnly).toBe(false);
    expect(brief.slots.map((slot) => slot.slotKey).sort()).toEqual(
      ["competitor:rival", "local_market", "topic:local-events"],
    );
    expect(brief.briefFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stays evidence-only with unavailable status when the provider is not qualified", () => {
    const brief = buildResearchBrief({
      organizationId,
      requestId,
      branchId: null,
      profileVersionId,
      sourcePolicyDigest,
      attemptKey: "fb42-research-attempt-2",
      correlationId,
      slots: slots(),
      manifest: {
        manifestId,
        contextDigest: digest,
        status: "ready",
        contextRefs: ["ctx-0001"],
        degradedReasons: [],
      },
      qualified: false,
    });
    expect(brief.evidenceOnly).toBe(true);
    expect(brief.status).toBe("unavailable");
    expect(brief.manifestId).toBeNull();
    expect(brief.contextRefs).toEqual([]);
  });

  it("orders execution by memory relevance without dropping any approved slot", () => {
    const { ordered, preserved } = orderSlotsByMemory({
      slots: slots(),
      relevance: { "competitor:rival": 10, "topic:local-events": 5 },
      memoryOrderRef: `memory:${manifestId}:order-preserved`,
    });
    expect(preserved).toBe(true);
    expect(ordered.map((slot) => slot.slotKey)).toEqual([
      "competitor:rival",
      "topic:local-events",
      "local_market",
    ]);
    // All three approved slots survive reordering.
    expect(new Set(ordered.map((slot) => slot.slotKey)).size).toBe(3);
  });

  it("fails closed when an external request carries private context bytes", () => {
    const privateSummary = "fb42 internal operator note about margins";
    expect(() =>
      assertExternalRequestHasOnlyPublicBytes({
        serialized: JSON.stringify({ query: `"Kerala Kitchen" Dubai ${privateSummary}` }),
        privateBytes: [privateSummary, digest],
      }),
    ).toThrow("private context bytes");
    expect(() =>
      assertExternalRequestHasOnlyPublicBytes({
        serialized: JSON.stringify({ query: '"Kerala Kitchen" Dubai AE' }),
        privateBytes: [privateSummary, digest],
      }),
    ).not.toThrow();
  });

  it("describes degradation honestly for operators", () => {
    expect(describeBriefDegradation("unavailable")).toMatch(/evidence-only/i);
    expect(describeBriefDegradation("disabled")).toMatch(/disabled/i);
  });

  it("keeps support review to source/candidate context only (no brief bytes)", () => {
    // The worker passes no brief/memory field to support review by
    // construction (see run-market-research brief-threading test); this guard
    // proves the byte-absence half of that boundary for review payloads.
    const reviewPayload = JSON.stringify({ candidates: [], sources: [] });
    expect(() =>
      assertExternalRequestHasOnlyPublicBytes({
        serialized: reviewPayload,
        privateBytes: [digest, manifestId, "fb42 internal review note"],
      }),
    ).not.toThrow();
    expect(() =>
      assertExternalRequestHasOnlyPublicBytes({
        serialized: JSON.stringify({ leaked: "fb42 internal review note" }),
        privateBytes: ["fb42 internal review note"],
      }),
    ).toThrow("private context bytes");
  });
});
