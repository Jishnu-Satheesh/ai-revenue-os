import type { AccountRole, OrganizationRole } from "@/domain/organizations/types";

/**
 * The permission vocabulary and its role mapping.
 *
 * The database holds the authoritative copy in `public.permissions`,
 * `public.account_role_permissions`, and `public.organization_role_permissions`,
 * seeded by migration. This file is a mirror so the browser can hide a control a
 * role cannot use, and `permissions.drift.test.ts` fails if the two disagree.
 *
 * **This file never grants anything.** A browser that disagrees with the database
 * renders the wrong button; it does not widen access. Enforcement is RLS, and
 * for account-scoped writes the account triggers.
 *
 * Pure data with no server dependency. Never import the server-only error module
 * or anything under `@/lib` from here.
 *
 * See `specs/017-account-identity-and-access.md` and
 * `adrs/0023-permission-as-data-authorization.md`.
 */

export const accountPermissions = [
  "account.read",
  "account.update",
  "member.read",
  "member.invite",
  "member.manage_role",
  "member.remove",
  "organization.create",
] as const;

export type AccountPermission = (typeof accountPermissions)[number];

export const organizationPermissions = [
  "organization.read",
  "organization.update",
  "organization.archive",
  "onboarding.manage",
  "integration.read",
  "integration.connect",
  "integration.disconnect",
  "memory.read",
  "memory.read_sensitive",
  "memory.write",
  "memory.verify",
  "memory.supersede",
  "memory.promote_fact",
  "opportunity.read",
  "opportunity.approve",
  "campaign.read",
  "campaign.create",
  "campaign.edit",
  "campaign.approve",
  "campaign.publish",
  "economics.read",
  "economics.write",
  "policy.read",
  "policy.update",
  "budget.modify",
  "audit.read",
] as const;

export type OrganizationPermission = (typeof organizationPermissions)[number];

export type Permission = AccountPermission | OrganizationPermission;

/**
 * Every key carries a description because the catalogue is meant to be read by a
 * human deciding what a role should be able to do, not only by code.
 */
export const permissionDescriptions: Readonly<Record<Permission, string>> = {
  "account.read": "See the agency and who belongs to it.",
  "account.update": "Rename the agency and change its settings.",
  "member.read": "See the agency's members and pending invitations.",
  "member.invite": "Invite a new member to the agency.",
  "member.manage_role": "Change what an existing member is allowed to do.",
  "member.remove": "Remove a member from the agency.",
  "organization.create": "Add a new client organization to the agency.",

  "organization.read": "Open this client and read its workspace.",
  "organization.update": "Change this client's profile, branches, goals, and constraints.",
  "organization.archive": "Archive this client.",
  "onboarding.manage": "Work through guided onboarding and answer data requests.",
  "integration.read": "See connections, data sources, and their health.",
  "integration.connect": "Connect a provider or register a data source.",
  "integration.disconnect": "Disconnect a provider and revoke its credentials.",
  "memory.read": "Read business memory that is not sensitive.",
  "memory.read_sensitive": "Read confidential and customer-content memory.",
  "memory.write": "Record notes and documents into business memory.",
  "memory.verify": "Confirm or reject a proposed memory item.",
  "memory.supersede": "Replace a memory item with a corrected version.",
  "memory.promote_fact": "Promote a memory item into a business fact.",
  "opportunity.read": "Read the revenue opportunity feed.",
  "opportunity.approve": "Approve or reject a proposed opportunity.",
  "campaign.read": "Read campaigns and their versions.",
  "campaign.create": "Create a campaign from a brief or an opportunity.",
  "campaign.edit": "Revise a campaign that has not been approved.",
  "campaign.approve": "Approve an exact campaign version for execution.",
  "campaign.publish": "Publish an approved campaign to a provider.",
  "economics.read": "Read channel economics and contribution margin.",
  "economics.write": "Record cost components and economic inputs.",
  "policy.read": "Read governance policies and approval thresholds.",
  "policy.update": "Change governance policies and approval thresholds.",
  "budget.modify": "Change spend limits and budgets.",
  "audit.read": "Read the audit and decision timeline.",
};

/**
 * Account roles. `owner` and `admin` hold the same permissions today because
 * account deletion and billing do not exist as capabilities yet, so there is
 * nothing to withhold. What actually separates them is enforced elsewhere and
 * deliberately not modelled as a permission: only an owner may appoint another
 * owner, which the `account_memberships` role-ceiling trigger decides.
 */
const accountMemberPermissions = [
  "account.read",
  "member.read",
] as const satisfies readonly AccountPermission[];

const accountAdminPermissions = [
  ...accountMemberPermissions,
  "account.update",
  "member.invite",
  "member.manage_role",
  "member.remove",
  "organization.create",
] as const satisfies readonly AccountPermission[];

export const accountRolePermissions: Readonly<Record<AccountRole, readonly AccountPermission[]>> = {
  owner: accountAdminPermissions,
  admin: accountAdminPermissions,
  member: accountMemberPermissions,
};

/**
 * Organization roles are strictly nested: viewer ⊂ operator ⊂ admin ⊂ owner.
 * Composing each from the one below makes that structural rather than a claim
 * kept true by hand, and `permissions.test.ts` asserts it holds.
 *
 * `memory.read_sensitive` is the boundary worth noticing: an operator may write,
 * verify, supersede, and promote memory but may not read confidential or
 * customer-content items. RLS enforces that again independently.
 */
const viewerPermissions = [
  "organization.read",
  "integration.read",
  "memory.read",
  "opportunity.read",
  "campaign.read",
  "economics.read",
  "policy.read",
  "audit.read",
] as const satisfies readonly OrganizationPermission[];

const operatorPermissions = [
  ...viewerPermissions,
  "onboarding.manage",
  "memory.write",
  "memory.verify",
  "memory.supersede",
  "memory.promote_fact",
  "campaign.create",
  "campaign.edit",
  "economics.write",
] as const satisfies readonly OrganizationPermission[];

const adminPermissions = [
  ...operatorPermissions,
  "organization.update",
  "integration.connect",
  "integration.disconnect",
  "memory.read_sensitive",
  "opportunity.approve",
  "campaign.approve",
  "campaign.publish",
  "policy.update",
  "budget.modify",
] as const satisfies readonly OrganizationPermission[];

const ownerPermissions = [
  ...adminPermissions,
  "organization.archive",
] as const satisfies readonly OrganizationPermission[];

export const organizationRolePermissions: Readonly<
  Record<OrganizationRole, readonly OrganizationPermission[]>
> = {
  owner: ownerPermissions,
  admin: adminPermissions,
  operator: operatorPermissions,
  viewer: viewerPermissions,
};

/** Unknown roles refuse rather than defaulting to allowed. */
export function hasAccountPermission(role: AccountRole, permission: AccountPermission): boolean {
  return accountRolePermissions[role]?.includes(permission) ?? false;
}

export function hasOrganizationPermission(
  role: OrganizationRole,
  permission: OrganizationPermission,
): boolean {
  return organizationRolePermissions[role]?.includes(permission) ?? false;
}
