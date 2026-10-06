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

  it("keeps the explicit brave lane on the legacy RPC with {}", async () => {
    const { client, rpc } = persistenceFor({
      provider: "brave",
      available: true,
      blockers: [],
    });

    const { qualification } = await createResearchProviderQualification(client, "brave").check();

    expect(qualification.provider).toBe("brave");
    expect(rpc).toHaveBeenCalledWith("check_research_provider_qualification", {});
    await expect(
      createResearchProviderQualification(client, "brave").assertQualified(),
    ).resolves.toBeUndefined();
  });

  it("checks the tinyfish lane through the _for RPC with the provider arg", async () => {
    const { client, rpc } = persistenceFor({
      provider: "tinyfish",
      available: true,
      blockers: [],
    });

    const { qualification, blockers } = await createResearchProviderQualification(
      client,
      "tinyfish",
    ).check();

    expect(qualification.provider).toBe("tinyfish");
    expect(qualification.available).toBe(true);
    expect(blockers).toEqual([]);
    expect(rpc).toHaveBeenCalledWith("check_research_provider_qualification_for", {
      p_provider: "tinyfish",
    });
    await expect(
      createResearchProviderQualification(client, "tinyfish").assertQualified(),
    ).resolves.toBeUndefined();
  });

  it("maps tinyfish blockers and refuses assertQualified", async () => {
    const { client, rpc } = persistenceFor({
      provider: "tinyfish",
      available: false,
      blockers: ["credential_missing", "controlled_canary_missing"],
    });

    const { qualification, blockers } = await createResearchProviderQualification(
      client,
      "tinyfish",
    ).check();

    expect(qualification.available).toBe(false);
    expect(blockers).toEqual(["credential_missing", "controlled_canary_missing"]);
    expect(rpc).toHaveBeenCalledWith("check_research_provider_qualification_for", {
      p_provider: "tinyfish",
    });
    await expect(
      createResearchProviderQualification(client, "tinyfish").assertQualified(),
    ).rejects.toEqual(expect.objectContaining({ code: "RESEARCH_PROVIDER_NOT_QUALIFIED" }));
  });

  it("fails the tinyfish lane closed on transport failure and malformed answers", async () => {
    const failing = persistenceFor(null, { message: "connection reset" });
    await expect(
      createResearchProviderQualification(failing.client, "tinyfish").assertQualified(),
    ).rejects.toBeInstanceOf(GrowthIntelligenceError);

    const malformed = persistenceFor({ provider: "tinyfish", available: true });
    await expect(
      createResearchProviderQualification(malformed.client, "tinyfish").assertQualified(),
    ).rejects.toBeInstanceOf(GrowthIntelligenceError);
  });

  it("fails closed on an unknown-provider answer", async () => {
    const unknown = persistenceFor({ provider: "unknown", available: true, blockers: [] });

    await expect(
      createResearchProviderQualification(unknown.client, "tinyfish").check(),
    ).rejects.toEqual(expect.objectContaining({ code: "RESEARCH_PROVIDER_NOT_QUALIFIED" }));
    await expect(
      createResearchProviderQualification(unknown.client, "tinyfish").assertQualified(),
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
