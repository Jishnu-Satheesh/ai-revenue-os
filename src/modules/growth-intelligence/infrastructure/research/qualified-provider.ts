import { DomainError } from "@/lib/errors";
import type {
  ResearchAdapter,
  ResearchAdapterAvailability,
} from "@/modules/growth-intelligence/infrastructure/research/ports";
import { researchRequestSchema } from "@/modules/growth-intelligence/infrastructure/research/ports";

export const EXA_ENTERPRISE_MARKET_RESEARCH_QUALIFICATION = {
  provider: "exa",
  status: "blocked",
  reviewedAt: "2026-09-01",
  blockers: [
    "commercial_approval_missing",
    "enterprise_terms_unexecuted",
    "zero_retention_unverified",
    "derived_claim_storage_rights_unverified",
    "credential_missing",
    "controlled_canary_missing",
  ],
} as const;

const availability: ResearchAdapterAvailability = { available: false, provider: "exa" };

export function getQualifiedMarketResearchAdapter(): ResearchAdapter {
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
