import "server-only";

import { z } from "zod";

import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import {
  isResearchProviderQualified,
  researchProviderQualificationSchema,
  type ResearchProviderQualification,
} from "@/domain/growth-intelligence/research-budget";

export type ResearchQualificationPersistence = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * Safe copy for each fail-closed blocker. These lines name the missing
 * requirement so an operator knows what to fix; they carry no credentials,
 * contract text, rates, or payload data.
 */
const BLOCKER_COPY: Record<string, string> = {
  qualification_missing: "No provider agreement is on file for market research.",
  agreement_missing: "The provider agreement reference is missing.",
  agreement_expired: "The provider agreement has expired.",
  required_rights_missing: "The provider agreement does not grant every required use.",
  rates_missing: "Provider pricing is not configured.",
  credential_missing: "Provider credentials are not configured.",
  model_bounds_missing: "Billable model bounds are not configured.",
  controlled_canary_missing: "A controlled canary run has not passed.",
};

export function describeQualificationBlockers(blockers: readonly string[]): string[] {
  return blockers.map((blocker) => BLOCKER_COPY[blocker] ?? "Market research is not enabled.");
}

export type ResearchProviderQualificationCheck = {
  qualification: ResearchProviderQualification;
  blockers: string[];
};

/**
 * Reads the staged provider qualification through the safe availability RPC.
 * The RPC answers with blocker codes only; qualification rows, credentials
 * and contract text stay outside every grant by design.
 */
export function createResearchProviderQualification(persistence: ResearchQualificationPersistence) {
  async function check(): Promise<ResearchProviderQualificationCheck> {
    let result: { data: unknown; error: unknown };
    try {
      result = await persistence.rpc("check_research_provider_qualification", {});
    } catch {
      throw new GrowthIntelligenceError(
        "RESEARCH_PROVIDER_NOT_QUALIFIED",
        "Market research is not enabled for this organization.",
      );
    }
    if (result.error) {
      throw new GrowthIntelligenceError(
        "RESEARCH_PROVIDER_NOT_QUALIFIED",
        "Market research is not enabled for this organization.",
      );
    }
    const parsed = researchProviderQualificationSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new GrowthIntelligenceError(
        "RESEARCH_PROVIDER_NOT_QUALIFIED",
        "Market research is not enabled for this organization.",
      );
    }
    return { qualification: parsed.data, blockers: [...parsed.data.blockers] };
  }

  return {
    check,

    /**
     * Fails closed: any blocker, any malformed answer, or any transport
     * failure refuses the paid path with a safe explanation.
     */
    async assertQualified(): Promise<void> {
      const { qualification } = await check();
      if (!isResearchProviderQualified(qualification)) {
        throw new GrowthIntelligenceError(
          "RESEARCH_PROVIDER_NOT_QUALIFIED",
          "Market research is not enabled for this organization.",
        );
      }
    },
  };
}
