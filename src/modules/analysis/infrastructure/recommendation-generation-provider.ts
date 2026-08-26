import "server-only";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";

import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";

/**
 * The narrator's courier, on Google Gemini.
 *
 * It converts a prompt into a model reply parsed to `unknown` and nothing
 * more. It does not know what a recommendation is, cannot read a database,
 * and never imports a domain schema, so the application boundary is forced to
 * parse. If this file ever imports from `src/domain` or the workflows, the
 * boundary has been broken.
 */

// Gemini 3.7 Flash's default reasoning pass exceeded the former 90-second
// deadline on a bounded twelve-finding narration. Keep the provider bounded,
// but leave enough room inside the task's existing 300-second ceiling for the
// model response and the database admission round-trip.
export const RECOMMENDATION_GENERATION_TIMEOUT_MS = 180_000;

/**
 * Never let a provider message escape.
 *
 * Provider errors routinely quote the prompt back, and the prompt carries
 * business context and sometimes customer-written text. The caller gets a
 * stable message; the detail stays in this provider's own structured log.
 */
function providerFailure(cause?: unknown): never {
  // The message is withheld; the class and HTTP status are not. Without them a
  // rate limit and a malformed request end up looking identical.
  const status = (cause as { statusCode?: number; status?: number } | undefined) ?? {};
  logger.error("analysis.recommendation_provider_failed", {
    errorCode: cause instanceof Error ? cause.name : "unknown",
    httpStatus: status.statusCode ?? status.status,
  });
  throw new DomainError(
    "INTEGRATION_ERROR",
    "The generation provider could not complete this request.",
  );
}

/** Models wrap JSON in a fence often enough to be worth handling once, here. */
function stripCodeFence(text: string): string {
  const fenced = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  return fenced ? fenced[1]! : text;
}

/**
 * Parse a model reply into JSON, or refuse it.
 *
 * A bare value and a fenced block are both accepted because models produce
 * both in practice. Anything else — a chatty preamble, an apology, prose with
 * JSON buried in it — is refused whole: half-parsing a near-miss would hand
 * the caller something that looks like an answer but is not.
 *
 * The rejection message is fixed text. Provider replies are quoted back into
 * error messages too often for the raw answer to be safe here.
 */
export function extractJsonText(raw: string): unknown {
  try {
    return JSON.parse(stripCodeFence(raw));
  } catch {
    throw new DomainError(
      "INTEGRATION_ERROR",
      "The generation provider returned text that was not usable JSON.",
    );
  }
}

export type RecommendationGenerationProvider = {
  providerName: "google";
  modelId: string;
  generate(system: string, user: string): Promise<unknown>;
};

export function createRecommendationGenerationProvider(config: {
  modelId: string;
}): RecommendationGenerationProvider {
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
          abortSignal: AbortSignal.timeout(RECOMMENDATION_GENERATION_TIMEOUT_MS),
        });
        return extractJsonText(result.text);
      } catch (error) {
        if (error instanceof DomainError) throw error;
        providerFailure(error);
      }
    },
  };
}
