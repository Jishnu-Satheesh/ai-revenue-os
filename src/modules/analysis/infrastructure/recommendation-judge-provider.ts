import "server-only";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";

import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";

/**
 * The judge's courier, on Google Gemini.
 *
 * Structurally the narrator's courier with a different name in the logs: it
 * converts a prompt into a model reply parsed to `unknown` and nothing more.
 * It does not know what an evaluation is, cannot read a database, and never
 * imports a domain schema. If this file ever imports from `src/domain`, the
 * boundary has been broken.
 */

const TIMEOUT_MS = 90_000;

function providerFailure(cause?: unknown): never {
  const status = (cause as { statusCode?: number; status?: number } | undefined) ?? {};
  logger.error("analysis.judge_provider_failed", {
    errorCode: cause instanceof Error ? cause.name : "unknown",
    httpStatus: status.statusCode ?? status.status,
  });
  throw new DomainError(
    "INTEGRATION_ERROR",
    "The evaluation provider could not complete this request.",
  );
}

function stripCodeFence(text: string): string {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  return fenced ? fenced[1]! : text;
}

export function extractJudgeJson(raw: string): unknown {
  try {
    return JSON.parse(stripCodeFence(raw));
  } catch {
    throw new DomainError(
      "INTEGRATION_ERROR",
      "The evaluation provider returned text that was not usable JSON.",
    );
  }
}

export type JudgeProvider = {
  providerName: "google";
  modelId: string;
  generate(system: string, user: string): Promise<unknown>;
};

export function createRecommendationJudgeProvider(config: {
  modelId: string;
}): JudgeProvider {
  const apiKey = env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new DomainError("INTEGRATION_ERROR", "No Google Generative AI credential is configured.");
  }

  const google = createGoogleGenerativeAI({ apiKey });

  return {
    providerName: "google",
    modelId: config.modelId,

    async generate(system: string, user: string): Promise<unknown> {
      try {
        const result = await generateText({
          model: google(config.modelId),
          system,
          prompt: user,
          abortSignal: AbortSignal.timeout(TIMEOUT_MS),
        });
        return extractJudgeJson(result.text);
      } catch (error) {
        if (error instanceof DomainError) throw error;
        providerFailure(error);
      }
    },
  };
}
