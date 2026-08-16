import "server-only";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { experimental_generateImage as generateImage, generateText } from "ai";

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

const TIMEOUT_MS = 90_000;

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

      try {
        const result = await generateImage({
          model: google.image(route.modelId),
          prompt: input.prompt,
          size: `${input.widthPx}x${input.heightPx}` as `${number}x${number}`,
          abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        });

        const image: GeneratedImage = {
          bytes: result.image.uint8Array,
          mimeType: "image/png",
          widthPx: input.widthPx,
          heightPx: input.heightPx,
          modelId: route.modelId,
        };

        return { image, usage: usageFrom(undefined) };
      } catch (error) {
        if (error instanceof DomainError) throw error;
        providerFailure();
      }
    },
  };
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
