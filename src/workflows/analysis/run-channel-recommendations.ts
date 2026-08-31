import { z } from "zod";

import {
  narrationSubmissionSchema,
  type NarratedItem,
  type NarrationSubmission,
} from "@/domain/analysis/recommendations";
import {
  buildNarrationPrompt,
  sha256Hex,
  type NarrationPromptFinding,
} from "@/workflows/analysis/recommendation-prompt";

/**
 * The narration worker.
 *
 * The same shape as the channel analysis worker one file over: claim a lease,
 * read what the run found, hand it to a model, and give the reply to a fenced
 * database function that checks every rule again. The worker is not the
 * authority on what may be recorded as a recommendation — the schema and the
 * fence are, which is why a model reply that survives this module has already
 * been parsed twice before anything is stored.
 *
 * See `specs/018-governed-channel-intelligence.md` sections 11.3–11.4 and
 * ADR 0037.
 */

export const channelRecommendationsTaskSchema = z
  .object({
    organizationId: z.string().uuid(),
    /** The run's own scope is authoritative; this only says who asked. */
    channelId: z.string().uuid().nullable(),
    analysisRunId: z.string().uuid(),
    correlationId: z.string().uuid(),
  })
  .strict();

export type ChannelRecommendationsPayload = z.infer<typeof channelRecommendationsTaskSchema>;

/** The window the claim bound, echoed back so the prompt matches the run. */
export type ChannelRecommendationWindow = {
  windowStart: string;
  windowEnd: string;
  periodGrain: string;
};

export type ChannelRecommendationsClaim =
  | { outcome: "acquired"; window: ChannelRecommendationWindow }
  | {
      outcome: "completed" | "not_found" | "not_ready" | "in_progress" | "conflict";
      window?: ChannelRecommendationWindow;
    };

/**
 * Every code `fail_channel_recommendations` accepts (Task 2's ruled
 * vocabulary). The brief called the invalid-narration code `NARRATION_INVALID`;
 * the fence refuses any name outside this list with 22023, so an unusable
 * submission reports as `NARRATION_VALIDATION_FAILED` instead.
 */
export type ChannelRecommendationFailureCode =
  | "MODEL_PROVIDER_UNAVAILABLE"
  | "NARRATION_VALIDATION_FAILED"
  | "NARRATION_PROCESSING_FAILED";

export class ChannelRecommendationsFailure extends Error {
  constructor(public readonly code: ChannelRecommendationFailureCode) {
    super(code);
    this.name = "ChannelRecommendationsFailure";
  }
}

/**
 * The narrator's courier, structurally typed so Task 8 can pass the Gemini
 * adapter without this module importing server-only infrastructure.
 */
export type NarrationGenerator = {
  providerName: string;
  modelId: string;
  generate(system: string, user: string): Promise<unknown>;
};

export type ChannelRecommendationsDependencies = {
  claim(input: {
    organizationId: string;
    analysisRunId: string;
    correlationId: string;
    claimToken: string;
  }): Promise<ChannelRecommendationsClaim>;
  loadFindings(input: {
    organizationId: string;
    analysisRunId: string;
  }): Promise<readonly NarrationPromptFinding[]>;
  generator: NarrationGenerator;
  complete(input: {
    organizationId: string;
    analysisRunId: string;
    claimToken: string;
    provider: string;
    modelId: string;
    promptVersion: number;
    promptDigest: string;
    outputDigest: string;
    resultDigest: string;
    items: readonly NarratedItem[];
  }): Promise<void>;
  fail(input: {
    organizationId: string;
    analysisRunId: string;
    claimToken: string;
    code: ChannelRecommendationFailureCode;
    resultDigest: string;
  }): Promise<void>;
};

function failureDigest(code: ChannelRecommendationFailureCode): string {
  // The same convention as the analysis worker: a failure still carries a
  // digest, and it identifies the failure rather than pretending to identify
  // a submission nobody filed.
  return sha256Hex(`channel-recommendations-failure:${code}`);
}

/**
 * A provider reply becomes a submission or nothing at all.
 *
 * The explicit shape check first is deliberate (carried from the Task 6
 * review): bare scalars survive JSON.parse, so `42` arrives here as a number,
 * and refusing it before `.parse` keeps the schema from ever being asked to
 * make sense of something that was never an object.
 */
function parseSubmission(reply: unknown): NarrationSubmission | null {
  if (typeof reply !== "object" || reply === null || Array.isArray(reply)) return null;
  const parsed = narrationSubmissionSchema.safeParse(reply);
  return parsed.success ? parsed.data : null;
}

/**
 * Key-sorted canonical JSON of a parsed value.
 *
 * The provider dep returns a *parsed* reply (`extractJsonText`), not raw text,
 * so there is no raw text to digest here. Canonical JSON over the parsed value
 * is the identity this layer can actually compute: deterministic for identical
 * content regardless of the key order the model happened to emit.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function generateOnce(
  generator: NarrationGenerator,
  prompt: { system: string; user: string },
): Promise<unknown> {
  try {
    return await generator.generate(prompt.system, prompt.user);
  } catch {
    // The provider's own errors stay in its structured log; nothing about the
    // reply or the business context escapes through this module.
    throw new ChannelRecommendationsFailure("MODEL_PROVIDER_UNAVAILABLE");
  }
}

export async function runChannelRecommendations(
  input: unknown,
  dependencies: ChannelRecommendationsDependencies,
): Promise<{
  outcome: "completed" | "failed" | "skipped";
  recommendationCount: number;
  /** Present only on `failed`. The same code the fence recorded, so the caller
   * can name the reason without reading `private.channel_recommendation_operations`. */
  failureCode?: ChannelRecommendationFailureCode;
}> {
  const payload = channelRecommendationsTaskSchema.parse(input);
  const claimToken = crypto.randomUUID();
  const claim = await dependencies.claim({
    organizationId: payload.organizationId,
    analysisRunId: payload.analysisRunId,
    correlationId: payload.correlationId,
    claimToken,
  });
  if (claim.outcome !== "acquired") {
    // Recommendations already filed means the run finished this stage, not
    // that it was skipped; every other refusal leaves the stage untouched.
    return {
      outcome: claim.outcome === "completed" ? "completed" : "skipped",
      recommendationCount: 0,
    };
  }

  try {
    let findings: readonly NarrationPromptFinding[];
    try {
      findings = await dependencies.loadFindings({
        organizationId: payload.organizationId,
        analysisRunId: payload.analysisRunId,
      });
    } catch {
      throw new ChannelRecommendationsFailure("NARRATION_PROCESSING_FAILED");
    }
    // An empty folder cannot produce a citable sentence — every item needs at
    // least one finding id the fence can resolve — so generating over it would
    // only buy a guaranteed rejection.
    if (findings.length === 0) {
      throw new ChannelRecommendationsFailure("NARRATION_PROCESSING_FAILED");
    }

    const prompt = buildNarrationPrompt({
      windowStart: claim.window.windowStart,
      windowEnd: claim.window.windowEnd,
      periodGrain: claim.window.periodGrain,
      findings,
    });

    let reply = await generateOnce(dependencies.generator, prompt);
    let submission = parseSubmission(reply);
    if (submission === null) {
      // Exactly one retry: models correct a format miss far more often than
      // two consecutive misses mean a third would help.
      reply = await generateOnce(dependencies.generator, prompt);
      submission = parseSubmission(reply);
    }
    if (submission === null) {
      throw new ChannelRecommendationsFailure("NARRATION_VALIDATION_FAILED");
    }

    await dependencies.complete({
      organizationId: payload.organizationId,
      analysisRunId: payload.analysisRunId,
      claimToken,
      provider: dependencies.generator.providerName,
      modelId: dependencies.generator.modelId,
      promptVersion: prompt.promptVersion,
      promptDigest: sha256Hex(JSON.stringify({ system: prompt.system, user: prompt.user })),
      outputDigest: sha256Hex(canonicalJson(reply)),
      resultDigest: sha256Hex(JSON.stringify(submission)),
      items: submission.items,
    });

    return { outcome: "completed", recommendationCount: submission.items.length };
  } catch (error) {
    const code: ChannelRecommendationFailureCode =
      error instanceof ChannelRecommendationsFailure ? error.code : "NARRATION_PROCESSING_FAILED";
    await dependencies.fail({
      organizationId: payload.organizationId,
      analysisRunId: payload.analysisRunId,
      claimToken,
      code,
      resultDigest: failureDigest(code),
    });
    return { outcome: "failed", recommendationCount: 0, failureCode: code };
  }
}
