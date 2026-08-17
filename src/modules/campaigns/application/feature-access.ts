import { z } from "zod";

import { DomainError } from "@/lib/errors";
import { env } from "@/lib/env";

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

const organizationIdSchema = z.string().uuid();

export function parseCampaignOrganizationIds(value: string | undefined): Set<string> {
  if (!value) return new Set();

  const organizationIds = value.split(",").map((organizationId) => organizationId.trim());

  if (organizationIds.some((organizationId) => organizationId.length === 0)) {
    throw new Error("Campaign rollout organization IDs must not contain empty values.");
  }

  const enabled = new Set<string>();
  for (const organizationId of organizationIds) {
    enabled.add(organizationIdSchema.parse(organizationId).toLowerCase());
  }

  if (enabled.size !== organizationIds.length) {
    throw new Error("Campaign rollout organization IDs must not contain duplicates.");
  }

  return enabled;
}

export function isCampaignsEnabled(
  organizationId: string,
  enabledOrganizationIds = parseCampaignOrganizationIds(env.CAMPAIGNS_V1_ORGANIZATION_IDS),
): boolean {
  return enabledOrganizationIds.has(organizationId.toLowerCase());
}

export function assertCampaignsEnabled(
  organizationId: string,
  enabledOrganizationIds = parseCampaignOrganizationIds(env.CAMPAIGNS_V1_ORGANIZATION_IDS),
): void {
  if (!isCampaignsEnabled(organizationId, enabledOrganizationIds)) {
    throw new DomainError(
      "FEATURE_NOT_AVAILABLE",
      "Campaigns are not available for this organization.",
    );
  }
}
