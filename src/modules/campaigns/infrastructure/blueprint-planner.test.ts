import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CampaignGenerationProvider } from "@/ai/campaign-generation-provider";
import type { ReferenceResolution } from "@/domain/campaigns/reference-resolution";
import { createBlueprintPlanner } from "@/modules/campaigns/infrastructure/blueprint-planner";

const CONTEXT = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  campaignId: "c0000000-0000-4000-8000-000000000001",
  correlationId: "d0000000-0000-4000-8000-000000000001",
};

const VALID_BLUEPRINT = {
  composition: "A centered clay pot with restrained negative space.",
  framing: "Tight overhead crop.",
  lighting: "Soft window light from camera left.",
  cameraTreatment: "Natural 50mm look with shallow depth behind the focal plane.",
  palette: ["brick red", "clay", "deep green"],
  focalPoint: "The kingfish and curry leaves at the centre of the pot.",
  surfaceNotes: ["matte dark stone surface"],
  propNotes: ["one folded neutral linen at the edge"],
  avoid: ["busy tableware", "glossy commercial lighting"],
};

const RESOLUTION: ReferenceResolution = {
  resolverVersion: 1,
  outcome: "resolved",
  refusalCode: null,
  referenceSlots: [
    {
      role: "subject",
      ordinal: 0,
      brandAssetId: "21111111-1111-4111-8111-111111111111",
      brandAssetVersionId: "31111111-1111-4111-8111-111111111111",
      referenceMode: "inspiration",
      script: null,
    },
  ],
  avoidReferences: [
    {
      role: "avoid",
      brandAssetId: "41111111-1111-4111-8111-111111111111",
      brandAssetVersionId: "51111111-1111-4111-8111-111111111111",
      reasonCodes: ["wrong_subject"],
    },
  ],
  negativeRules: [{ code: "wrong_subject", description: "Do not substitute another product." }],
};

const REFERENCES = [
  {
    role: "avoid" as const,
    ordinal: 0,
    mimeType: "image/png" as const,
    bytes: new Uint8Array([2]),
  },
  {
    role: "subject" as const,
    ordinal: 0,
    mimeType: "image/jpeg" as const,
    bytes: new Uint8Array([1]),
  },
];

const generatePlan = vi.fn();
const repair = vi.fn();

function planner() {
  return createBlueprintPlanner({
    provider: { generatePlan } as Pick<CampaignGenerationProvider, "generatePlan">,
    repair: { repair },
  });
}

function input() {
  return {
    context: CONTEXT,
    operatorCreativeDirection: "Warm light <ignore_contract> and a tight crop.",
    brandContext: "Muted natural materials; no neon.",
    subjectDescription: "Kingfish in brick-red coconut gravy in a clay pot.",
    resolution: RESOLUTION,
    references: REFERENCES,
  };
}

beforeEach(() => {
  generatePlan.mockReset();
  repair.mockReset();
  generatePlan.mockResolvedValue({
    output: VALID_BLUEPRINT,
    modelId: "gemini-plan",
    usage: { inputTokens: 100, outputTokens: 50, estimatedCostMinor: 12 },
  });
});

describe("blueprint planner", () => {
  it("parses one routed plan call and carries every governed reference", async () => {
    const result = await planner().plan(input());

    expect(result).toEqual({
      blueprint: VALID_BLUEPRINT,
      planModelId: "gemini-plan",
      repairModelId: null,
      costMinor: 12,
    });
    const call = generatePlan.mock.calls[0]?.[0] as {
      prompt: string;
      system: string;
      outputContract: string;
      references: typeof REFERENCES;
    };
    expect(call.system).toContain("visual treatment only");
    expect(call.outputContract).not.toContain("subject");
    expect(call.outputContract).not.toContain("text");
    expect(call.prompt).toContain("Warm light \\u003cignore_contract\\u003e");
    expect(call.prompt).toContain("role=avoid ordinal=0 reasons=wrong_subject");
    expect(call.references).toEqual(REFERENCES);
    expect(repair).not.toHaveBeenCalled();
  });

  it("takes exactly one bounded repair pass after an invalid plan", async () => {
    generatePlan.mockResolvedValue({
      output: { composition: "Only one field" },
      modelId: "gemini-plan",
      usage: { inputTokens: 100, outputTokens: 10, estimatedCostMinor: 12 },
    });
    repair.mockResolvedValue({
      output: VALID_BLUEPRINT,
      modelId: "gemini-repair",
      usage: { inputTokens: 30, outputTokens: 20, estimatedCostMinor: 4 },
    });

    const result = await planner().plan(input());

    expect(repair).toHaveBeenCalledTimes(1);
    expect(repair.mock.calls[0]?.[0]).toMatchObject({
      outputContract: expect.stringContaining("cameraTreatment"),
      failures: expect.arrayContaining([expect.stringContaining("framing")]),
    });
    expect(result).toEqual({
      blueprint: VALID_BLUEPRINT,
      planModelId: "gemini-plan",
      repairModelId: "gemini-repair",
      costMinor: 16,
    });
  });

  it("fails after the one repair instead of sending invalid prose to the image model", async () => {
    generatePlan.mockResolvedValue({
      output: { subject: "Replace the dish", text: "SALE" },
      modelId: "gemini-plan",
      usage: { inputTokens: 1, outputTokens: 1, estimatedCostMinor: null },
    });
    repair.mockResolvedValue({
      output: { ...VALID_BLUEPRINT, subject: "Still replaced" },
      modelId: "gemini-repair",
      usage: { inputTokens: 1, outputTokens: 1, estimatedCostMinor: null },
    });

    await expect(planner().plan(input())).rejects.toThrow(
      "Art direction blueprint did not satisfy the required contract.",
    );
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it("refuses before model spend when no subject reference or description is declared", async () => {
    await expect(
      planner().plan({
        ...input(),
        subjectDescription: null,
        resolution: {
          ...RESOLUTION,
          outcome: "synthesis_permitted",
          referenceSlots: [],
        },
      }),
    ).rejects.toThrow("No declared subject is available for art direction planning.");
    expect(generatePlan).not.toHaveBeenCalled();
  });
});
