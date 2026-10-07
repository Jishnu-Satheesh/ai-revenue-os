import { DomainError } from "@/lib/errors";
import { env } from "@/lib/env";
import { parseOrganizationAllowlist, resolveOrganizationAllowlist } from "@/lib/rollout-allowlist";

/**
 * The production rollout gate for Campaigns.
 *
 * It is fail-closed: an unset variable enables nobody. That is deliberate for a
 * feature that can publish to a public account and spend money — the safe
 * default for "we forgot to configure it" has to be off.
 *
 * The gate is checked *after* membership, never before. Refusing an unknown
 * organization with "not enabled" and a non-member with "no access" would let
 * an outsider tell the two apart and enumerate which organizations exist.
 */

const CAMPAIGNS_ALLOWLIST = {
  variableName: "CAMPAIGNS_V1_ORGANIZATION_IDS",
  label: "Campaign rollout organization IDs",
} as const;

export function parseCampaignOrganizationIds(value: string | undefined): Set<string> {
  return parseOrganizationAllowlist(value, CAMPAIGNS_ALLOWLIST);
}

export function isCampaignsEnabled(
  organizationId: string,
  enabledOrganizationIds = resolveOrganizationAllowlist(
    env.CAMPAIGNS_V1_ORGANIZATION_IDS,
    CAMPAIGNS_ALLOWLIST,
  ),
): boolean {
  return enabledOrganizationIds.has(organizationId.toLowerCase());
}

export function assertCampaignsEnabled(
  organizationId: string,
  enabledOrganizationIds = resolveOrganizationAllowlist(
    env.CAMPAIGNS_V1_ORGANIZATION_IDS,
    CAMPAIGNS_ALLOWLIST,
  ),
): void {
  if (!isCampaignsEnabled(organizationId, enabledOrganizationIds)) {
    throw new DomainError(
      "FEATURE_NOT_AVAILABLE",
      "Campaigns are not available for this organization.",
    );
  }
}
