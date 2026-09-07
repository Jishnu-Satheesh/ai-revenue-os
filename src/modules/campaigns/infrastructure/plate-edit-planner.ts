import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";

import { DomainError } from "@/lib/errors";
import { env } from "@/lib/env";
import { createModelRouter, type ModelRouter } from "@/ai/model-router";
import type { PlateEditPlanner } from "@/workflows/campaigns/edit-plate";

/**
 * Asking a model for the edited image, and nothing more.
 *
 * It returns bytes and a model id. It does not decide whether the edit is
 * acceptable, does not crop, and does not composite -- the caller does all
 * three, and the caller is what makes the region boundary hold. A planner that
 * returned "approved: true" would be a model choosing a verdict, which this
 * architecture does not allow anywhere.
 *
 * The parent image is attached as a file part and the prompt is the delimited
 * block `buildPlateEditPrompt` produced. Everything hostile an operator could
 * write is already inside that block; nothing here needs to defend against it,
 * because `compositeMaskedEdit` copies the parent back over every pixel outside
 * the marked regions regardless of what comes back.
 */

const EDIT_TIMEOUT_MS = 120_000;

function providerFailure(error: unknown): never {
  // The provider's message can echo prompt content, so it is never surfaced.
  throw new DomainError(
    "INTEGRATION_ERROR",
    "The image model could not complete the edit.",
    error instanceof Error ? error : undefined,
  );
}

export type PlateEditPlannerOptions = {
  apiKey?: string;
  router?: ModelRouter;
};

export function createGeminiPlateEditPlanner(
  options: PlateEditPlannerOptions = {},
): PlateEditPlanner {
  const apiKey = options.apiKey ?? env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is required to edit a plate.");
  }
  const google = createGoogleGenerativeAI({ apiKey });
  const router =
    options.router ??
    createModelRouter({
      textModel: env.CAMPAIGN_TEXT_MODEL,
      imageModel: env.CAMPAIGN_IMAGE_MODEL,
    });

  return {
    async draw(input) {
      const route = router.resolve("image");

      try {
        const result = await generateText({
          model: google(route.modelId),
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: input.prompt },
                { type: "file", data: input.parent, mediaType: input.parentMimeType },
              ],
            },
          ],
          providerOptions: { google: { responseModalities: ["TEXT", "IMAGE"] } },
          // The caller's signal and a ceiling. A run cancelled by an operator
          // must stop paying for an image nobody will look at.
          abortSignal: AbortSignal.any([input.signal, AbortSignal.timeout(EDIT_TIMEOUT_MS)]),
        });

        const file = result.files.find((candidate) => candidate.mediaType?.startsWith("image/"));
        // A text-only answer means the model declined or explained itself. It
        // is a provider failure to the caller either way, and the explanation
        // stays out of the message because it can quote the prompt.
        if (!file) providerFailure(new Error("NoImageReturned"));

        return {
          bytes: file.uint8Array,
          modelId: route.modelId,
          // The SDK does not price a call, and a zero would claim it was free.
          costMinor: null,
        };
      } catch (error) {
        if (error instanceof DomainError) throw error;
        providerFailure(error);
      }
    },
  };
}
