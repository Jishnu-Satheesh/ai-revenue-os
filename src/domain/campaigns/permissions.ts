import type { OrganizationRole } from "@/domain/organizations/types";

/**
 * Who may do what to a campaign.
 *
 * Publishing to a public account and spending money are Tier 3 actions, so the
 * roles that may attest and approve are the same ones that may create and edit:
 * owner, admin, and operator. A viewer reads everything and changes nothing.
 *
 * This mapping is advisory to the UI and authoritative to the service, and the
 * database enforces it again. Three layers sounds redundant until one of them
 * is bypassed, which is the case the redundancy exists for.
 */
export const campaignPermissions = [
  "campaign.read",
  "campaign.create",
  "campaign.edit",
  "campaign.attest",
  "campaign.approve",
  "campaign.schedule",
  "campaign.cancel",
] as const;

export type CampaignPermission = (typeof campaignPermissions)[number];

const OPERATOR_PERMISSIONS: readonly CampaignPermission[] = campaignPermissions;

const permissionsByRole: Readonly<Record<OrganizationRole, readonly CampaignPermission[]>> = {
  owner: OPERATOR_PERMISSIONS,
  admin: OPERATOR_PERMISSIONS,
  operator: OPERATOR_PERMISSIONS,
  viewer: ["campaign.read"],
};

export function hasCampaignPermission(
  role: OrganizationRole,
  permission: CampaignPermission,
): boolean {
  return permissionsByRole[role].includes(permission);
}

/** The roles a route should admit for a given permission. */
export function rolesWith(permission: CampaignPermission): readonly OrganizationRole[] {
  return (Object.keys(permissionsByRole) as OrganizationRole[]).filter((role) =>
    hasCampaignPermission(role, permission),
  );
}
