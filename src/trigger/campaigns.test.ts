import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Campaign generation Trigger registration", () => {
  it("registers all generation paths as identifier-only schema tasks on one queue", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/campaigns.ts"), "utf8");

    expect(source.match(/schemaTask\(\{/g)).toHaveLength(5);
    for (const id of [
      'id: "campaign.generate-bundle"',
      'id: "campaign.revise-bundle"',
      'id: "campaign.generate-variants"',
      'id: "campaign.create-from-opportunity"',
      'id: "campaign.render-poster"',
    ]) {
      expect(source).toContain(id);
    }
    expect(source.match(/queue: campaignGenerationQueue/g)).toHaveLength(3);
    expect(source).toContain("queue: campaignDraftQueue");
    // Rendering has its own lane. It calls no model and spends nothing, so
    // putting it behind image generation's concurrency of 1 would make the
    // cheap half of the studio wait on the expensive half for no reason.
    expect(source).toContain("queue: campaignRenderQueue");
    expect(source).toContain("campaignGenerationPayloadSchema");
    expect(source).toContain("campaignRevisionPayloadSchema");
    expect(source).toContain("campaignVariantPayloadSchema");
    expect(source).toContain("campaignPosterRenderPayloadSchema");
  });

  it("wires variants through the same governed reference receipt and blueprint path as bundles", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/campaigns.ts"), "utf8");
    const variants = source.slice(
      source.indexOf("export const generateCampaignVariantsTask"),
      source.indexOf("function campaignRouter"),
    );

    for (const dependency of [
      "createGenerationContextLoader",
      "createReferenceCandidateReader",
      "createSupabaseReferenceObjectReader",
      "createGenerationReferenceContextWriter",
      "createBlueprintPlanner",
      "createVariantPlanner",
    ]) {
      expect(variants).toContain(dependency);
    }
    expect(variants).toContain("provider: generation.provider");
    expect(variants).toContain("repair: generation");
    expect(variants).not.toContain("provider: createGeminiCampaignGenerationProvider()");
  });

  it("keeps privileged dependency construction behind payload validation", async () => {
    const source = await readFile(resolve(process.cwd(), "src/trigger/campaigns.ts"), "utf8");

    for (const parser of [
      "parseCampaignGenerationPayload(payload)",
      "parseCampaignRevisionPayload(payload)",
      "parseCampaignVariantPayload(payload)",
      "createFromOpportunityPayloadSchema.parse(payload)",
    ]) {
      const parsedAt = source.indexOf(parser, source.indexOf("run: async"));
      const clientAt = source.indexOf("createCampaignWorkerServiceClient()", parsedAt);
      expect(parsedAt).toBeGreaterThan(-1);
      expect(clientAt).toBeGreaterThan(parsedAt);
    }
  });
});
