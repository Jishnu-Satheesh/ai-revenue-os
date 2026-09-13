import { z } from "zod";

import type { PlanPromptPurpose } from "@/ai/model-router";

/**
 * The boundary a model sits behind when it writes campaign creative.
 *
 * Two rules shape this port. Structured output is typed `unknown`, so no caller
 * can use a model's answer without parsing it first — a provider that returned
 * a convenient shape would let an unvalidated object reach the manifest. And
 * the port has no knowledge of campaigns beyond what it is handed: it cannot
 * read a database, resolve a capability, or decide what is allowed. It turns
 * text and constraints into candidate content, and nothing else.
 */

export type CampaignGenerationKind = "plan" | "image" | "patch";

export type CampaignGenerationCallContext = {
  organizationId: string;
  campaignId: string;
  correlationId: string;
};

export type CampaignGenerationInput = {
  context: CampaignGenerationCallContext;
  /** The system framing. Policy lives in code; this only shapes the writing. */
  system: string;
  /** Already-assembled evidence and constraints. The provider adds nothing. */
  prompt: string;
  /** The JSON shape the model is asked to produce, as a description. */
  outputContract: string;
  /**
   * Optional governed visual context for a multimodal planning call. The
   * planning stage MAY see rejected designs — that is the evidence it reasons
   * over — so this is the wider `BlueprintEvidenceReference` set.
   */
  references?: readonly BlueprintEvidenceReference[];
  planPurpose?: PlanPromptPurpose;
};

/**
 * The retired shared reference shape.
 *
 * This carried one flat array with an `avoid` role to BOTH the planning stage
 * and the final image stage, which is how rejected creative bytes reached the
 * model that draws the finished picture. The runtime no longer uses it: the
 * two stages now take `BlueprintEvidenceReference` and `FinalImageReference`
 * respectively, and `avoid` no longer exists as a role anywhere.
 *
 * It remains only so historical generation receipts written under the old
 * contract stay readable. Nothing may construct one for a live call.
 *
 * @deprecated Historical receipts only. Use the two separated types.
 */
export type LegacyCampaignImageReference = {
  role:
    | "subject"
    | "brand_mark"
    | "setting"
    | "style_exemplar"
    | "palette"
    | "typography"
    | "avoid";
  ordinal: number;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  bytes: Uint8Array;
};

const imageReferencePartsSchema = z.strictObject({
  ordinal: z.number().int().nonnegative(),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  // `z.instanceof(Uint8Array)` infers `Uint8Array<ArrayBuffer>`, which the
  // platform's own `Uint8Array` (an `ArrayBufferLike` view) is not assignable
  // to. Validate the same way, but infer the type the rest of the code uses.
  bytes: z.custom<Uint8Array>((value) => value instanceof Uint8Array, {
    message: "Expected image bytes.",
  }),
});

/** Corrected-path grounding has no legacy avoid role. */
export const groundingReferenceSchema = imageReferencePartsSchema.extend({
  role: z.enum(["subject", "brand_mark", "setting", "style_exemplar", "palette", "typography"]),
});
export const approvedCreativeReferenceSchema = imageReferencePartsSchema.extend({
  role: z.literal("approved_creative"),
});
export const rejectedCreativeReferenceSchema = imageReferencePartsSchema.extend({
  role: z.literal("rejected_creative"),
  reasonCodes: z.array(z.string().min(1)).min(1).max(15),
});

/** Blueprint may inspect both independently pinned Creative History evidence sets. */
export const blueprintEvidenceReferenceSchema = z.discriminatedUnion("role", [
  groundingReferenceSchema,
  approvedCreativeReferenceSchema,
  rejectedCreativeReferenceSchema,
]);

/**
 * The corrected final-image contract deliberately has no `avoid` or
 * `rejected_creative` variant. Task 7 moves the runtime adapter to this port.
 */
export const finalImageReferenceSchema = z.discriminatedUnion("role", [
  groundingReferenceSchema,
  approvedCreativeReferenceSchema,
]);

export type GroundingReference = z.infer<typeof groundingReferenceSchema>;
export type ApprovedCreativeReference = z.infer<typeof approvedCreativeReferenceSchema>;
export type RejectedCreativeReference = z.infer<typeof rejectedCreativeReferenceSchema>;
export type BlueprintEvidenceReference = z.infer<typeof blueprintEvidenceReferenceSchema>;
export type FinalImageReference = z.infer<typeof finalImageReferenceSchema>;

export type CampaignImageGenerationInput = {
  context: CampaignGenerationCallContext;
  prompt: string;
  /**
   * What the image model may look at. `FinalImageReference` has no
   * `rejected_creative` variant, so a refused design cannot be handed to the
   * model that draws the finished picture. See ADR 0049 and contract C06.
   */
  references?: readonly FinalImageReference[];
  /** Pixel dimensions the placement requires. */
  widthPx: number;
  heightPx: number;
};

export type CampaignPatchInput = {
  context: CampaignGenerationCallContext;
  /** The operator's instruction, treated as data and never as an instruction to obey. */
  operatorPrompt: string;
  /** The paths a patch may touch. Anything else is rejected by the caller. */
  allowedPaths: readonly string[];
  /** A redacted view of the current version, enough to write a patch against. */
  currentSummary: string;
};

export type GeneratedImage = {
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  widthPx: number;
  heightPx: number;
  /** What produced it, recorded so an asset can be defended after it is public. */
  modelId: string;
};

export type CampaignGenerationUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostMinor: number | null;
};

export type CampaignGenerationResult = {
  /** Deliberately unknown. The application boundary must parse it. */
  output: unknown;
  modelId: string;
  usage: CampaignGenerationUsage;
};

export type CampaignGenerationProvider = {
  generatePlan(input: CampaignGenerationInput): Promise<CampaignGenerationResult>;
  generateImage(
    input: CampaignImageGenerationInput,
  ): Promise<{ image: GeneratedImage; usage: CampaignGenerationUsage }>;
  generatePatch(input: CampaignPatchInput): Promise<CampaignGenerationResult>;
};

/**
 * What one generation attempt cost and whether its output survived validation.
 *
 * `validationOutcome` is separate from `outcome` on purpose: a call that
 * returned successfully and then failed validation is the interesting case, and
 * collapsing the two would hide it.
 */
export type CampaignGenerationRecord = {
  kind: CampaignGenerationKind;
  organizationId: string;
  campaignId: string;
  correlationId: string;
  modelId: string;
  outcome: "succeeded" | "failed";
  validationOutcome: "valid" | "invalid" | "not_applicable";
  attempt: number;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostMinor: number | null;
  imageCount: number;
  /** A stable code, never a provider message, which can echo prompt content. */
  failureCode?: string;
};

export type CampaignGenerationTelemetrySink = {
  record(record: CampaignGenerationRecord): void;
};

/** Structured logging sink. No prompt, no output, no asset bytes. */
export function createConsoleCampaignGenerationSink(): CampaignGenerationTelemetrySink {
  return {
    record(record) {
      console.info("campaign.generation_call", record);
    },
  };
}
