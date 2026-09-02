import { z } from "zod";

import { DomainError } from "@/lib/errors";
import { env } from "@/lib/env";

export type GrowthIntelligenceIncrement = "market" | "synthesis" | "triage" | "campaign_draft";

const organizationIdSchema = z.string().uuid();

const incrementLabels: Readonly<Record<GrowthIntelligenceIncrement, string>> = {
  market: "Market Intelligence",
  synthesis: "Growth Intelligence synthesis",
  triage: "Growth Intelligence triage",
  campaign_draft: "Growth Intelligence Campaign drafts",
};

export function parseGrowthIntelligenceOrganizationIds(
  value: string | undefined,
  increment: GrowthIntelligenceIncrement,
): Set<string> {
  if (!value) return new Set();

  const organizationIds = value.split(",").map((organizationId) => organizationId.trim());
  if (organizationIds.some((organizationId) => organizationId.length === 0)) {
    throw new Error(`${incrementLabels[increment]} rollout IDs must not contain empty values.`);
  }

  const enabled = new Set<string>();
  for (const organizationId of organizationIds) {
    enabled.add(organizationIdSchema.parse(organizationId).toLowerCase());
  }
  if (enabled.size !== organizationIds.length) {
    throw new Error(`${incrementLabels[increment]} rollout IDs must not contain duplicates.`);
  }
  return enabled;
}

function configuredOrganizationIds(increment: GrowthIntelligenceIncrement): Set<string> {
  const value = {
    market: env.GROWTH_INTELLIGENCE_MARKET_ORGANIZATION_IDS,
    synthesis: env.GROWTH_INTELLIGENCE_SYNTHESIS_ORGANIZATION_IDS,
    triage: env.GROWTH_INTELLIGENCE_TRIAGE_ORGANIZATION_IDS,
    campaign_draft: env.GROWTH_INTELLIGENCE_CAMPAIGN_DRAFT_ORGANIZATION_IDS,
  }[increment];
  return parseGrowthIntelligenceOrganizationIds(value, increment);
}

export function hasGrowthIntelligenceAccess(
  organizationId: string,
  increment: GrowthIntelligenceIncrement,
  enabledOrganizationIds: ReadonlySet<string> = configuredOrganizationIds(increment),
): boolean {
  return enabledOrganizationIds.has(organizationId.toLowerCase());
}

/** Call only after the request path has resolved organization membership. */
export function assertGrowthIntelligenceAccess(
  organizationId: string,
  increment: GrowthIntelligenceIncrement,
  enabledOrganizationIds: ReadonlySet<string> = configuredOrganizationIds(increment),
): void {
  if (!hasGrowthIntelligenceAccess(organizationId, increment, enabledOrganizationIds)) {
    throw new DomainError(
      "FEATURE_NOT_AVAILABLE",
      `${incrementLabels[increment]} is not available for this organization.`,
    );
  }
}
