import { DomainError } from "@/lib/errors";
import {
  isResearchProviderQualified,
  RESEARCH_PROVIDER_REQUIRED_USES,
  type ResearchProviderQualification,
} from "@/domain/growth-intelligence/research-budget";
import type {
  ResearchAdapter,
  ResearchAdapterAvailability,
} from "@/modules/growth-intelligence/infrastructure/research/ports";
import { researchRequestSchema } from "@/modules/growth-intelligence/infrastructure/research/ports";

/**
 * Paid research runs on Brave Web Search only under an account agreement
 * that explicitly permits snippet storage, commercial inference through
 * Gemini, organization display, derived claims, synthesis reuse and agreed
 * retention. An ordinary subscription is not assumed to grant these rights.
 * Google Search grounding and the unavailable Exa adapter are excluded from
 * this market-research pipeline. (Amendment A, 2026-09-09, permits Google
 * Search grounding on the channel-recommendations narration path only; that
 * exception lives outside this adapter and changes nothing here.)
 */
export const QUALIFIED_RESEARCH_PROVIDER = "brave" as const;

/**
 * Durable research provider once its qualification is staged (agreement with
 * storage rights, rates, credential, model bounds, passing canary). Brave
 * stays the ephemeral-preview provider; it never authorizes TinyFish runs
 * and TinyFish never authorizes Brave runs — the selector below enforces
 * the match per call.
 */
export const QUALIFIED_TINYFISH_RESEARCH_PROVIDER = "tinyfish" as const;

export { RESEARCH_PROVIDER_REQUIRED_USES };

/**
 * Static baseline: this process stages no qualification, holds no
 * credential, and runs no canary (fixtures only, gates stay off), so the
 * adapter reports blocked until a staged qualification says otherwise.
 */
export const UNQUALIFIED_RESEARCH_AVAILABILITY: ResearchAdapterAvailability = {
  available: false,
  provider: QUALIFIED_RESEARCH_PROVIDER,
};

/**
 * Maps a checked qualification onto adapter availability. Only the safe
 * blocker codes travel; credentials and contract text never reach this
 * layer.
 */
export function resolveResearchAdapterAvailability(
  qualification: ResearchProviderQualification,
): ResearchAdapterAvailability {
  return {
    available: isResearchProviderQualified(qualification),
    provider: QUALIFIED_RESEARCH_PROVIDER,
  };
}

export function getQualifiedMarketResearchAdapter(
  availability: ResearchAdapterAvailability = UNQUALIFIED_RESEARCH_AVAILABILITY,
  candidate?: ResearchAdapter,
  expectedProvider: string = QUALIFIED_RESEARCH_PROVIDER,
): ResearchAdapter {
  if (
    candidate &&
    availability.available &&
    availability.provider === expectedProvider
  ) {
    return candidate;
  }
  return {
    availability,
    async searchAndFetch(input) {
      researchRequestSchema.parse(input);
      throw new DomainError(
        "FEATURE_NOT_AVAILABLE",
        "Market research is not enabled for this organization.",
      );
    },
  };
}
