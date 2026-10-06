import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";

import { OVERCLAIM_PATTERNS, overclaimGuidance } from "@/domain/campaigns/measurement";
import { DomainError } from "@/lib/errors";
import { env } from "@/lib/env";
import { createModelRouter, type ModelRouter } from "@/ai/model-router";
import type { DraftLessonInput } from "@/modules/campaigns/application/learning-service";

/**
 * Drafting the one sentence of a learning proposal that is not computed.
 *
 * Everything else in a proposal is derived: the hypothesis, the observation and
 * the suggested next test are composed from the settled outcome by
 * deterministic code. Only the lesson is prose, and only because a lesson is a
 * reading of a result rather than the result itself.
 *
 * **The model does not decide whether the campaign worked.** The verdict is
 * already settled and is handed to it as a fact. Its job is to say what that
 * verdict means for the next campaign, in the operator's language.
 *
 * `validateLearningLesson` is the fence, not this prompt. It rejects wording
 * that overclaims against the verdict, generalises beyond one campaign, or
 * cites evidence the proposal does not carry -- and `proposeLearning` allows
 * exactly one repair pass before writing nothing at all. The instructions below
 * are there to make a clean first draft likely, not to make an unclean one
 * impossible.
 */

const DRAFT_TIMEOUT_MS = 60_000;

/**
 * Stated to the model as rules, and enforced afterwards regardless.
 *
 * The verdict wording matters most: "inconclusive" is the honest answer for a
 * campaign whose evidence did not clear the bar, and a lesson that reads it as
 * a win is precisely the claim this repository refuses to make.
 */
const LESSON_RULES: readonly string[] = Object.freeze([
  "Write two or three sentences, in plain language an owner would use.",
  "The verdict is already decided and is given to you. Never argue with it, soften it, or restate an inconclusive result as a success.",
  "Say what this suggests for the next campaign. Do not claim what this campaign earned.",
  "Write about this one campaign. Never say 'always', 'every time', or 'from now on'.",
  "Do not name identifiers, ids, or reference codes of any kind.",
  "Do not invent numbers. Use only the figures given, and only as they are given.",
]);

/**
 * The refused vocabulary, stated up front.
 *
 * The first production run of this worker drafted a lesson containing
 * "because", was rejected, redrafted, was rejected again, and wrote nothing at
 * all. Both refusals were correct -- an `execution_only` campaign measured
 * nothing, so no sentence may explain why anything happened. What was wrong was
 * asking for prose about a result while never mentioning that one causal word
 * ends the attempt. A fence the writer cannot see is a trap, not a rule.
 *
 * Built from `OVERCLAIM_PATTERNS`, so the list a model is warned about and the
 * list the validator enforces cannot drift apart.
 */
function forbiddenWordingRule(): string {
  const words = OVERCLAIM_PATTERNS.map((entry) => entry.says).join(", ");
  return `Never use any of these, in any form: ${words}. A lesson containing one of them is rejected outright, however reasonable the sentence around it.`;
}

export type LearningDrafterOptions = {
  apiKey?: string;
  router?: ModelRouter;
};

export function buildLearningPrompt(input: DraftLessonInput): string {
  const { context } = input;

  const facts = [
    `Verdict: ${context.verdict}`,
    `Primary metric: ${context.primaryMetricKey}`,
    `Attribution method: ${context.attributionMethod}`,
    `Measurement window: ${context.outcomeWindowDays} days`,
    `Baseline: ${context.baselineSource}, ${context.baselineLookbackDays} days`,
    `Planned exposures: ${context.plannedExposureCount}`,
    `Realized exposures: ${context.realizedExposureCount}`,
    `Evidence tier: ${context.evidenceTier ?? "none recorded"}`,
  ];

  if (context.limitations.length > 0) {
    facts.push(`Limitations: ${context.limitations.join("; ")}`);
  }

  const repair =
    input.repairHints.length > 0
      ? [
          "",
          "A previous draft was rejected for using the following. Rewrite without them:",
          ...input.repairHints.map((hint) => `- ${overclaimGuidance(hint)}`),
        ]
      : [];

  return [
    "A campaign has finished and its result has been settled by the platform.",
    "Write the lesson an operator should take from it.",
    "",
    "What was measured:",
    ...facts.map((fact) => `- ${fact}`),
    "",
    "Rules:",
    ...LESSON_RULES.map((rule) => `- ${rule}`),
    `- ${forbiddenWordingRule()}`,
    ...repair,
  ].join("\n");
}

export function createGeminiLearningDrafter(options: LearningDrafterOptions = {}) {
  const apiKey = options.apiKey ?? env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is required to draft a learning proposal.");
  }
  const google = createGoogleGenerativeAI({ apiKey });
  const router =
    options.router ??
    createModelRouter({
      textModel: env.CAMPAIGN_TEXT_MODEL,
      imageModel: env.CAMPAIGN_IMAGE_MODEL,
    });

  return async function draftLesson(input: DraftLessonInput): Promise<string> {
    // The `plan` route, because drafting a lesson is the same kind of work the
    // planner does: bounded prose from given facts. There is no separate task
    // for it, and inventing one would add a routing entry nothing configures.
    const route = router.resolve("plan");

    try {
      const result = await generateText({
        model: google(route.modelId),
        prompt: buildLearningPrompt(input),
        abortSignal: AbortSignal.timeout(DRAFT_TIMEOUT_MS),
      });

      const lesson = result.text.trim();
      // An empty draft is not a lesson. Returning it would send blank prose to
      // a validator that has nothing to object to, and write an empty proposal.
      if (lesson === "") {
        throw new DomainError("INTEGRATION_ERROR", "The model returned no lesson to propose.");
      }
      return lesson;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      // The provider's message can echo the prompt, which carries the campaign's
      // own measured figures.
      throw new DomainError(
        "INTEGRATION_ERROR",
        "The learning proposal could not be drafted.",
        error instanceof Error ? error : undefined,
      );
    }
  };
}
