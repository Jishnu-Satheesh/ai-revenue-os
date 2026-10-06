import "server-only";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";
import { z } from "zod";

import {
  revenueAssumptionRangeSchema,
  type RevenueAssumptionRange,
} from "@/domain/organizations/revenue-scenario";
import { env } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Fail-closed rough-estimate proposal boundary (§16 amendment).
 *
 * The model may propose response fractions ONLY as explicit low/high ranges
 * bound to cited loss findings. It never emits revenue figures, confidence,
 * or shares: deterministic code attaches validated ranges and computes every
 * displayed figure. Any provider failure, non-JSON output, or schema-invalid
 * row is a DomainError the route degrades to the hold-current-level scenario
 * with an explicit note — never a fake number.
 */

export const REVENUE_PROPOSAL_MODEL_VERSION = "revenue-proposals@1";
export const REVENUE_PROPOSAL_TIMEOUT_MS = 30_000;
export const REVENUE_PROPOSAL_MAX_ACTIONS = 10;
const MAX_OUTPUT_TOKENS = 1_500;

const proposalLossSchema = z
  .strictObject({
    findingId: z.string().uuid(),
    minorUnits: z.number().int().min(0),
  })
  .strict();

const proposalActionSchema = z
  .strictObject({
    actionId: z.string().trim().min(1).max(120),
    title: z.string().trim().min(1).max(200),
    kind: z.enum(["recommendation", "proposal", "insight"]),
  })
  .strict();

export const revenueProposalRequestSchema = z
  .strictObject({
    currency: z.string().trim().length(3),
    losses: z.array(proposalLossSchema).min(1).max(24),
    actions: z.array(proposalActionSchema).min(1).max(REVENUE_PROPOSAL_MAX_ACTIONS),
  })
  .strict();

export type RevenueProposalRequest = z.output<typeof revenueProposalRequestSchema>;

const proposalOutputSchema = z.array(revenueAssumptionRangeSchema).max(24);

function promptFor(input: RevenueProposalRequest): string {
  const losses = input.losses
    .map((loss) => `- finding ${loss.findingId}: past observed loss ${loss.minorUnits} minor units`)
    .join("\n");
  const actions = input.actions
    .map((action) => `- action ${action.actionId} (${action.kind}): ${action.title}`)
    .join("\n");
  return [
    "You propose rough recovery-fraction ranges for a revenue scenario. Rules:",
    "1. Reply with a JSON array only, no prose, no code fences.",
    "2. Each entry MUST cite exactly one listed finding id and repeat its listed amount exactly as citedBasisMinorUnits with the currency below.",
    "3. low/high are fractions from 0 to 1 with low <= high. Wide bands are expected; false precision is a defect.",
    "4. Never emit revenue figures, confidence, shares, or anything outside the listed findings and actions.",
    `Currency: ${input.currency}.`,
    "Listed past losses (observed, never a promise of full recovery):",
    losses,
    "Unquantified actions:",
    actions,
  ].join("\n");
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```[a-zA-Z]*\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
}

export type RevenueProposalProvider = {
  readonly modelProvider: string;
  readonly modelName: string;
  readonly modelVersion: string;
  propose(input: {
    request: RevenueProposalRequest;
    correlationId: string;
  }): Promise<RevenueAssumptionRange[]>;
};

export function createFailClosedRevenueProposalProvider(): RevenueProposalProvider {
  return {
    modelProvider: "fail-closed",
    modelName: "none",
    modelVersion: REVENUE_PROPOSAL_MODEL_VERSION,
    async propose() {
      throw new DomainError("INTEGRATION_ERROR", "Rough-estimate proposals are not configured.");
    },
  };
}

export function createGoogleRevenueProposalProvider(
  config: { modelId?: string } = {},
): RevenueProposalProvider {
  const apiKey = env.GOOGLE_GENERATIVE_AI_API_KEY;
  const modelId = config.modelId ?? env.AI_DEFAULT_MODEL;
  if (!apiKey || !modelId) {
    throw new DomainError("INTEGRATION_ERROR", "Rough-estimate proposals are not configured.");
  }
  return {
    modelProvider: "google",
    modelName: modelId,
    modelVersion: REVENUE_PROPOSAL_MODEL_VERSION,
    async propose(input) {
      const parsed = revenueProposalRequestSchema.safeParse(input.request);
      if (!parsed.success) {
        throw new DomainError("VALIDATION_ERROR", "The proposal request was not usable.");
      }
      const google = createGoogleGenerativeAI({ apiKey });
      let text: string;
      try {
        const result = await generateText({
          model: google(modelId),
          system:
            "You propose governed revenue-scenario assumption ranges only. Ranges cannot approve, publish, spend, rank, price, or claim realized outcomes.",
          prompt: promptFor(parsed.data),
          temperature: 0.1,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          abortSignal: AbortSignal.timeout(REVENUE_PROPOSAL_TIMEOUT_MS),
        });
        text = result.text;
      } catch (error) {
        logger.error("organization_home.revenue_proposal_provider_failed", {
          correlationId: input.correlationId,
          errorCode: error instanceof Error ? error.name : "unknown",
        });
        throw new DomainError(
          "INTEGRATION_ERROR",
          "Rough-estimate proposals are temporarily unavailable.",
        );
      }
      let payload: unknown;
      try {
        payload = JSON.parse(stripFences(text));
      } catch {
        throw new DomainError(
          "INTEGRATION_ERROR",
          "Rough-estimate proposals are temporarily unavailable.",
        );
      }
      const ranges = proposalOutputSchema.safeParse(payload);
      if (!ranges.success) {
        throw new DomainError(
          "INTEGRATION_ERROR",
          "Rough-estimate proposals are temporarily unavailable.",
        );
      }
      return ranges.data;
    },
  };
}

export function createRevenueProposalProvider(
  config: { modelId?: string } = {},
): RevenueProposalProvider {
  const modelId = config.modelId ?? env.AI_DEFAULT_MODEL;
  if (!env.GOOGLE_GENERATIVE_AI_API_KEY || !modelId) {
    return createFailClosedRevenueProposalProvider();
  }
  return createGoogleRevenueProposalProvider({ modelId });
}
