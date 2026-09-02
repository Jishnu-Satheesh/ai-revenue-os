import "server-only";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";

import { createModelRouter, refinePrompt, type ModelRouter } from "@/ai/model-router";
import { env } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { SubjectDescriptionDrafter } from "@/modules/campaigns/application/subject-service";

const TIMEOUT_MS = 90_000;

export type SubjectTextGenerator = (input: {
  modelId: string;
  system: string;
  prompt: string;
  temperature: number;
  maxOutputTokens: number;
  abortSignal: AbortSignal;
}) => Promise<{
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}>;

export type SubjectDescriptionDrafterOptions = {
  apiKey?: string;
  router?: ModelRouter;
  generate?: SubjectTextGenerator;
  log?: Pick<typeof logger, "error">;
};

export function createSubjectDescriptionDrafter(
  options: SubjectDescriptionDrafterOptions = {},
): SubjectDescriptionDrafter {
  const apiKey = options.apiKey ?? env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey && !options.generate) {
    throw new DomainError("INTEGRATION_ERROR", "No subject drafting model is configured.");
  }

  const router =
    options.router ??
    createModelRouter({
      textModel: env.CAMPAIGN_TEXT_MODEL,
      patchModel: env.CAMPAIGN_PATCH_MODEL,
    });
  const generate = options.generate ?? googleTextGenerator(apiKey!);
  const log = options.log ?? logger;

  return {
    async draft(input) {
      // Subject drafting is literal extraction and rewriting, not creative
      // campaign planning, so it uses the low-temperature patch route.
      const route = router.resolve("patch");
      const refined = refinePrompt({
        route,
        role: input.system,
        body: input.prompt,
        outputContract: input.outputContract,
      });

      try {
        const result = await generate({
          modelId: route.modelId,
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
        return { output, modelId: route.modelId };
      } catch (error) {
        log.error("campaign.subject_description_draft_failed", {
          organizationId: input.organizationId,
          correlationId: input.correlationId,
          errorCode: error instanceof Error ? error.name : "unknown",
        });
        throw new DomainError("INTEGRATION_ERROR", "The subject description could not be drafted.");
      }
    },
  };
}

function googleTextGenerator(apiKey: string): SubjectTextGenerator {
  const google = createGoogleGenerativeAI({ apiKey });
  return async (input) =>
    generateText({
      model: google(input.modelId),
      system: input.system,
      prompt: input.prompt,
      temperature: input.temperature,
      maxOutputTokens: input.maxOutputTokens,
      abortSignal: input.abortSignal,
    });
}

function stripCodeFence(text: string): string {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  return fenced ? fenced[1]! : text;
}
