import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import {
  createResearchProviderQualification,
  describeQualificationBlockers,
  type ResearchQualificationPersistence,
} from "@/modules/growth-intelligence/infrastructure/research/qualification";

function persistenceFor(data: unknown, error: unknown = null) {
  const rpc = vi.fn(async () => ({ data, error }));
  return { client: { rpc } as ResearchQualificationPersistence, rpc };
}

describe("research provider qualification", () => {
  it("reports a complete staged qualification as available", async () => {
    const { client, rpc } = persistenceFor({
      provider: "brave",
      available: true,
      blockers: [],
    });

    const { qualification, blockers } = await createResearchProviderQualification(client).check();

    expect(qualification.available).toBe(true);
    expect(blockers).toEqual([]);
    expect(rpc).toHaveBeenCalledWith("check_research_provider_qualification", {});
    await expect(
      createResearchProviderQualification(client).assertQualified(),
    ).resolves.toBeUndefined();
  });

  it("fails closed while any blocker stands", async () => {
    const { client } = persistenceFor({
      provider: "brave",
      available: false,
      blockers: ["credential_missing", "controlled_canary_missing"],
    });

    const { qualification } = await createResearchProviderQualification(client).check();
    expect(qualification.available).toBe(false);
    await expect(createResearchProviderQualification(client).assertQualified()).rejects.toEqual(
      expect.objectContaining({ code: "RESEARCH_PROVIDER_NOT_QUALIFIED" }),
    );
  });

  it("fails closed on transport failure and on malformed answers", async () => {
    const failing = persistenceFor(null, { message: "connection reset" });
    await expect(
      createResearchProviderQualification(failing.client).assertQualified(),
    ).rejects.toBeInstanceOf(GrowthIntelligenceError);

    const malformed = persistenceFor({ provider: "brave", available: true });
    await expect(
      createResearchProviderQualification(malformed.client).assertQualified(),
    ).rejects.toBeInstanceOf(GrowthIntelligenceError);
  });

  it("describes blockers with safe copy and no secrets", () => {
    const copy = describeQualificationBlockers([
      "credential_missing",
      "agreement_expired",
      "required_rights_missing",
      "rates_missing",
      "model_bounds_missing",
      "controlled_canary_missing",
      "qualification_missing",
      "agreement_missing",
    ]);

    expect(copy).toHaveLength(8);
    for (const line of copy) {
      expect(line).not.toMatch(/key|token|secret|contract|https?:/i);
    }
    expect(copy).toContain("Provider credentials are not configured.");
  });
});
