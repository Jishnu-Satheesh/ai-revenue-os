import { DomainError } from "@/lib/errors";
import { env } from "@/lib/env";
import { parseOrganizationAllowlist, resolveOrganizationAllowlist } from "@/lib/rollout-allowlist";

export type GrowthIntelligenceIncrement = "market" | "synthesis" | "triage" | "campaign_draft";

const incrementLabels: Readonly<Record<GrowthIntelligenceIncrement, string>> = {
  market: "Market Intelligence",
  synthesis: "Growth Intelligence synthesis",
  triage: "Growth Intelligence triage",
  campaign_draft: "Growth Intelligence Campaign drafts",
};

const incrementVariables: Readonly<Record<GrowthIntelligenceIncrement, string>> = {
  market: "GROWTH_INTELLIGENCE_MARKET_ORGANIZATION_IDS",
  synthesis: "GROWTH_INTELLIGENCE_SYNTHESIS_ORGANIZATION_IDS",
  triage: "GROWTH_INTELLIGENCE_TRIAGE_ORGANIZATION_IDS",
  campaign_draft: "GROWTH_INTELLIGENCE_CAMPAIGN_DRAFT_ORGANIZATION_IDS",
};

export function parseGrowthIntelligenceOrganizationIds(
  value: string | undefined,
  increment: GrowthIntelligenceIncrement,
): Set<string> {
  return parseOrganizationAllowlist(value, {
    variableName: incrementVariables[increment],
    label: `${incrementLabels[increment]} rollout IDs`,
  });
}

function configuredOrganizationIds(increment: GrowthIntelligenceIncrement): Set<string> {
  const value = {
    market: env.GROWTH_INTELLIGENCE_MARKET_ORGANIZATION_IDS,
    synthesis: env.GROWTH_INTELLIGENCE_SYNTHESIS_ORGANIZATION_IDS,
    triage: env.GROWTH_INTELLIGENCE_TRIAGE_ORGANIZATION_IDS,
    campaign_draft: env.GROWTH_INTELLIGENCE_CAMPAIGN_DRAFT_ORGANIZATION_IDS,
  }[increment];
  return resolveOrganizationAllowlist(value, {
    variableName: incrementVariables[increment],
    label: `${incrementLabels[increment]} rollout IDs`,
  });
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
