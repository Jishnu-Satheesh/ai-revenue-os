import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createModelRouter } from "@/ai/model-router";
import { validManifest } from "@/domain/campaigns/test-manifest";
import { createVariantPlanner } from "@/modules/campaigns/infrastructure/variant-planner";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_ID = "c1000000-0000-4000-8000-000000000001";
const CORRELATION_ID = "f1000000-0000-4000-8000-000000000001";
const generatePlan = vi.fn();
const generateImage = vi.fn();
const upload = vi.fn();
let png: Buffer;

beforeAll(async () => {
  png = await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: { r: 30, g: 20, b: 10 } },
  })
    .png()
    .toBuffer();
});

beforeEach(() => {
  generatePlan.mockReset();
  generateImage.mockReset();
  upload.mockReset();
  generatePlan.mockResolvedValue({
    output: {
      hook: "A different lunch",
      caption: "The approved lunch, restated.",
      callToAction: "Book a table",
      hashtags: ["#lunch"],
    },
    modelId: "gemini-plan",
    usage: { inputTokens: 1, outputTokens: 1, estimatedCostMinor: 2 },
  });
  generateImage.mockResolvedValue({
    image: {
      bytes: png,
      mimeType: "image/png",
      widthPx: 1024,
      heightPx: 1024,
      modelId: "gemini-image",
    },
    usage: { inputTokens: null, outputTokens: null, estimatedCostMinor: 3 },
  });
  upload.mockResolvedValue({ ok: true });
});

describe("variant planner image grounding", () => {
  it("uses the shared textless blueprint prompt and governed references, never alt text", async () => {
    const manifest = validManifest();
    const references = [
      {
        role: "subject" as const,
        ordinal: 0,
        mimeType: "image/png" as const,
        bytes: new Uint8Array([1, 2, 3]),
      },
    ];
    const planner = createVariantPlanner(
      {
        provider: { generatePlan, generateImage, generatePatch: vi.fn() },
        router: createModelRouter({ textModel: "gemini-plan", imageModel: "gemini-image" }),
        storage: { upload },
      },
      { organizationId: ORGANIZATION_ID, campaignId: CAMPAIGN_ID, correlationId: CORRELATION_ID },
    );

    await planner.draw({
      manifest,
      directionId: manifest.directions[0]!.id,
      attemptOrdinal: 1,
      signal: new AbortController().signal,
      imageGuidance: {
        subjectDescription: "Kingfish curry in a clay pot.",
        resolution: {
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
          avoidReferences: [],
          negativeRules: [],
        },
        references,
        blueprint: {
          composition: "Centered plate.",
          framing: "Tight overhead crop.",
          lighting: "Soft daylight.",
          cameraTreatment: "Natural 50mm treatment.",
          palette: ["brick red"],
          focalPoint: "The curry.",
          surfaceNotes: [],
          propNotes: [],
          avoid: ["busy tableware"],
        },
        hardConstraints: ["Never imply a health claim."],
      },
    });

    const call = generateImage.mock.calls[0]?.[0] as {
      prompt: string;
      references: typeof references;
    };
    expect(call.prompt).toContain("<art_direction_blueprint>");
    expect(call.prompt).toContain("Do not render text of any kind, in any script");
    expect(call.prompt).toContain("Kingfish curry in a clay pot");
    expect(call.prompt).not.toContain(manifest.assets[0]!.altText);
    expect(call.references).toEqual(references);
  });
});
