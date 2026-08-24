import "server-only";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, type UserContent } from "ai";

import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import { createModelRouter, refinePrompt, type ModelRouter } from "@/ai/model-router";
import type {
  CampaignGenerationInput,
  CampaignGenerationProvider,
  CampaignGenerationResult,
  CampaignGenerationUsage,
  CampaignImageGenerationInput,
  CampaignPatchInput,
  GeneratedImage,
} from "@/ai/campaign-generation-provider";

const REFERENCE_ROLE_ORDER = {
  subject: 0,
  brand_mark: 1,
  setting: 2,
  style_exemplar: 3,
  palette: 4,
  typography: 5,
  avoid: 6,
} as const;

/**
 * The configured campaign generation adapter, on Google Gemini.
 *
 * It converts prompts into candidate content and nothing more. It does not know
 * what a manifest is, cannot read a database, and returns `unknown` for every
 * structured answer so the application boundary is forced to parse. If this file
 * ever imports a campaign schema, the boundary has been broken.
 *
 * Model choice and prompt shaping both come from the router, so switching the
 * model for one task carries its prompt adjustments with it.
 */

/**
 * Text and images do not take the same amount of time, so they do not get the
 * same budget. An image model composing a 1024px frame routinely runs past a
 * minute under load, and cutting it off at the text timeout turns a slow
 * success into a failed run that has already been paid for.
 */
const TIMEOUT_MS = 90_000;
const IMAGE_TIMEOUT_MS = 300_000;

/**
 * Never let a provider message escape.
 *
 * Provider errors routinely quote the prompt back, and the prompt carries
 * business context and sometimes customer-written text. The caller gets a
 * stable message; the detail stays in the provider's own logs.
 */
function providerFailure(cause?: unknown): never {
  // The message is withheld; the class and HTTP status are not. Those are the
  // provider's own metadata rather than an echo of the prompt, and without
  // them a failed generation is unexplainable after the fact — which is how a
  // rate limit and a malformed request end up looking identical.
  const status = (cause as { statusCode?: number; status?: number } | undefined) ?? {};
  logger.error("campaign.generation_provider_failed", {
    errorCode: cause instanceof Error ? cause.name : "unknown",
    httpStatus: status.statusCode ?? status.status,
  });
  throw new DomainError(
    "INTEGRATION_ERROR",
    "The generation provider could not complete this request.",
  );
}

/** The three types a campaign asset may carry. Anything else is not usable. */
function imageMimeType(value: string | undefined): GeneratedImage["mimeType"] {
  if (value === "image/png" || value === "image/jpeg" || value === "image/webp") return value;
  providerFailure(new Error("UnsupportedImageType"));
}

function usageFrom(usage: { inputTokens?: number; outputTokens?: number } | undefined) {
  return {
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    // The SDK does not price a call, and a zero would claim it was free.
    estimatedCostMinor: null,
  } satisfies CampaignGenerationUsage;
}

export type GeminiCampaignProviderOptions = {
  apiKey?: string;
  router?: ModelRouter;
};

export function createGeminiCampaignGenerationProvider(
  options: GeminiCampaignProviderOptions = {},
): CampaignGenerationProvider {
  const apiKey = options.apiKey ?? env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new DomainError("INTEGRATION_ERROR", "No Google Generative AI credential is configured.");
  }

  const google = createGoogleGenerativeAI({ apiKey });
  const router =
    options.router ??
    createModelRouter({
      textModel: env.CAMPAIGN_TEXT_MODEL,
      planModel: env.CAMPAIGN_PLAN_MODEL,
      patchModel: env.CAMPAIGN_PATCH_MODEL,
      repairModel: env.CAMPAIGN_REPAIR_MODEL,
      imageModel: env.CAMPAIGN_IMAGE_MODEL,
    });

  async function callText(
    task: "plan" | "patch" | "repair",
    role: string,
    body: string,
    outputContract: string,
    repairFailures?: readonly string[],
  ): Promise<CampaignGenerationResult> {
    // Resolution happens before the try, so an unconfigured model surfaces as
    // the configuration error it is rather than a generic provider failure.
    const route = router.resolve(task);
    const refined = refinePrompt({ route, role, body, outputContract, repairFailures });

    try {
      const result = await generateText({
        model: google(route.modelId),
        system: refined.system,
        prompt: refined.prompt,
        temperature: route.temperature,
        maxOutputTokens: route.maxOutputTokens,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      });

      // Parsed here only to fail fast on non-JSON. The *shape* remains the
      // application's problem: this returns `unknown` either way.
      let output: unknown;
      try {
        output = JSON.parse(stripCodeFence(result.text));
      } catch {
        output = null;
      }

      return { output, modelId: route.modelId, usage: usageFrom(result.usage) };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      providerFailure(error);
    }
  }

  return {
    generatePlan(input: CampaignGenerationInput) {
      return callText("plan", input.system, input.prompt, input.outputContract);
    },

    generatePatch(input: CampaignPatchInput) {
      // The operator's words are fenced and labelled as data. They describe a
      // desired change; they are not a command this system agrees to run, and
      // the allowlist downstream is what actually decides.
      const body = [
        "<operator_request>",
        input.operatorPrompt,
        "</operator_request>",
        "",
        "<current_version>",
        input.currentSummary,
        "</current_version>",
        "",
        "You may only propose replacements at these paths:",
        input.allowedPaths.map((path) => `- ${path}`).join("\n"),
      ].join("\n");

      return callText(
        "patch",
        "You translate a requested change into a minimal set of typed replacements.",
        body,
        '{"operations":[{"path":string,"operation":"replace","value":string|string[]|null}],"summary":string}',
      );
    },

    async generateImage(input: CampaignImageGenerationInput) {
      const route = router.resolve("image");

      // One retry, and only for a call that never answered. By the time images
      // are being drawn the plan has already been generated and paid for, so
      // discarding the whole run because one request hung is the expensive
      // choice. A refusal or a bad image type is not retried: those are
      // answers, and asking again would just buy the same answer twice.
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await drawOnce(route, input);
        } catch (error) {
          const timedOut =
            error instanceof Error &&
            (error.name === "TimeoutError" || error.name === "AbortError");
          if (!timedOut || attempt === 2) throw error;
          logger.warn("campaign.image_retry_after_timeout", { errorCode: error.name });
        }
      }
    },
  };

  async function drawOnce(
    route: { modelId: string },
    input: CampaignImageGenerationInput,
  ): Promise<{ image: GeneratedImage; usage: ReturnType<typeof usageFrom> }> {
    {
      try {
        // Gemini's image models return the picture as a file part of an
        // ordinary generation, not through the Imagen predict endpoint that
        // `google.image()` targets. Pointing the wrong API at the model fails
        // for a reason that has nothing to do with the prompt.
        const framedPrompt = [
          input.prompt,
          "",
          `Compose for a ${input.widthPx}x${input.heightPx} pixel frame.`,
        ].join("\n");
        const references = [...(input.references ?? [])].sort(
          (left, right) =>
            REFERENCE_ROLE_ORDER[left.role] - REFERENCE_ROLE_ORDER[right.role] ||
            left.ordinal - right.ordinal,
        );
        const content: UserContent = [
          { type: "text", text: framedPrompt },
          ...references.flatMap((reference) => [
            {
              type: "text" as const,
              text: `<reference role="${reference.role}" ordinal="${reference.ordinal}">`,
            },
            {
              type: "file" as const,
              data: reference.bytes,
              mediaType: reference.mimeType,
            },
          ]),
        ];
        const result = await generateText({
          model: google(route.modelId),
          messages: [{ role: "user", content }],
          providerOptions: { google: { responseModalities: ["TEXT", "IMAGE"] } },
          abortSignal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
        });

        const file = result.files.find((candidate) => candidate.mediaType?.startsWith("image/"));
        if (!file) {
          // A text-only answer means the model declined or explained itself.
          // Treating that as a provider fault keeps the caller's handling the
          // same, and the reason stays out of the message either way.
          providerFailure(new Error("NoImageReturned"));
        }

        const image: GeneratedImage = {
          bytes: file.uint8Array,
          // What the model actually returned, narrowed to the three types the
          // bundle may carry. Intake re-encodes and re-measures regardless, so
          // an unexpected type is a rejection rather than something to coerce.
          mimeType: imageMimeType(file.mediaType),
          widthPx: input.widthPx,
          heightPx: input.heightPx,
          modelId: route.modelId,
        };

        return { image, usage: usageFrom(result.usage) };
      } catch (error) {
        if (error instanceof DomainError) throw error;
        if (
          error instanceof Error &&
          (error.name === "TimeoutError" || error.name === "AbortError")
        ) {
          throw error;
        }
        providerFailure(error);
      }
    }
  }
}

/**
 * A repair pass, routed to its own model and temperature.
 *
 * Exposed separately from the port because repair is not a new proposal: it is
 * the same artifact with named failures to correct, and it must be told exactly
 * that or it rewrites the parts that were already fine.
 */
export function createGeminiRepairCall(options: GeminiCampaignProviderOptions = {}) {
  const provider = createGeminiCampaignGenerationProvider(options);
  const apiKey = options.apiKey ?? env.GOOGLE_GENERATIVE_AI_API_KEY;
  const google = createGoogleGenerativeAI({ apiKey: apiKey! });
  const router =
    options.router ??
    createModelRouter({
      textModel: env.CAMPAIGN_TEXT_MODEL,
      repairModel: env.CAMPAIGN_REPAIR_MODEL,
      patchModel: env.CAMPAIGN_PATCH_MODEL,
      imageModel: env.CAMPAIGN_IMAGE_MODEL,
    });

  return {
    provider,
    async repair(input: {
      body: string;
      outputContract: string;
      failures: readonly string[];
    }): Promise<CampaignGenerationResult> {
      const route = router.resolve("repair");
      const refined = refinePrompt({
        route,
        role: "You correct a rejected campaign artifact.",
        body: input.body,
        outputContract: input.outputContract,
        repairFailures: input.failures,
      });

      try {
        const result = await generateText({
          model: google(route.modelId),
          system: refined.system,
          prompt: refined.prompt,
          temperature: route.temperature,
          maxOutputTokens: route.maxOutputTokens,
          abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        });

        let output: unknown;
        try {
          output = JSON.parse(stripCodeFence(result.text));
        } catch {
          output = null;
        }

        return { output, modelId: route.modelId, usage: usageFrom(result.usage) };
      } catch (error) {
        if (error instanceof DomainError) throw error;
        providerFailure();
      }
    },
  };
}

/** Models wrap JSON in a fence often enough to be worth handling once, here. */
function stripCodeFence(text: string): string {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  return fenced ? fenced[1]! : text;
}
