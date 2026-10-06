import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import {
  createResearchRetentionRepository,
  toResearchSourceHistoryView,
  type ResearchRetentionPersistence,
} from "@/modules/growth-intelligence/infrastructure/research/retention-repository";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const SOURCE_ID = "20000000-0000-4000-8000-000000000002";

function persistenceFor(data: unknown, error: unknown = null) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => ({
    data,
    error,
    args,
  }));
  return { client: { rpc } as ResearchRetentionPersistence, rpc };
}

describe("research retention repository", () => {
  it("erases a payload through the privileged RPC with audit", async () => {
    const { client, rpc } = persistenceFor({
      sourceId: SOURCE_ID,
      erasedClaims: 1,
      erasedAt: "2026-09-08T10:00:00.000Z",
      replayed: false,
    });

    const result = await createResearchRetentionRepository(client).eraseSourcePayload({
      organizationId: ORGANIZATION_ID,
      sourceId: SOURCE_ID,
      reasonCode: "AGREEMENT_TERMINATED",
      includeDerivedText: false,
    });

    expect(result.erasedClaims).toBe(1);
    expect(result.replayed).toBe(false);
    expect(rpc).toHaveBeenCalledWith(
      "erase_research_source_payload",
      expect.objectContaining({
        p_organization_id: ORGANIZATION_ID,
        p_source_id: SOURCE_ID,
        p_reason_code: "AGREEMENT_TERMINATED",
        p_include_derived_text: false,
      }),
    );
  });

  it("refuses an unsafe reason code before any RPC", async () => {
    const { client, rpc } = persistenceFor({});

    await expect(
      createResearchRetentionRepository(client).eraseSourcePayload({
        organizationId: ORGANIZATION_ID,
        sourceId: SOURCE_ID,
        reasonCode: "lowercase-reason",
        includeDerivedText: false,
      }),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps erasure failures onto a safe error", async () => {
    const { client } = persistenceFor(null, { message: "research_erasure_forbidden" });

    await expect(
      createResearchRetentionRepository(client).eraseSourcePayload({
        organizationId: ORGANIZATION_ID,
        sourceId: SOURCE_ID,
        reasonCode: "AGREEMENT_TERMINATED",
        includeDerivedText: true,
      }),
    ).rejects.toBeInstanceOf(GrowthIntelligenceError);
  });

  it("renders erased sources as unavailable and ineligible for synthesis", () => {
    expect(
      toResearchSourceHistoryView({
        sourceId: SOURCE_ID,
        availability: "available",
        erasedAt: null,
      }),
    ).toEqual({ sourceId: SOURCE_ID, state: "available", eligibleForSynthesis: true });

    expect(
      toResearchSourceHistoryView({
        sourceId: SOURCE_ID,
        availability: "unavailable",
        erasedAt: "2026-09-08T10:00:00.000Z",
      }),
    ).toEqual({
      sourceId: SOURCE_ID,
      state: "source_unavailable",
      eligibleForSynthesis: false,
    });
  });
});
