import { describe, expect, it } from "vitest";

import {
  accountPermissions,
  accountRolePermissions,
  hasAccountPermission,
  hasOrganizationPermission,
  organizationPermissions,
  organizationRolePermissions,
  permissionDescriptions,
  type Permission,
} from "@/domain/access/permissions";
import type { AccountRole, OrganizationRole } from "@/domain/organizations/types";

const organizationRolesByRank: readonly OrganizationRole[] = [
  "viewer",
  "operator",
  "admin",
  "owner",
];

describe("the permission vocabulary", () => {
  it("describes every permission, because the catalogue is meant to be read", () => {
    for (const key of [...accountPermissions, ...organizationPermissions]) {
      expect(permissionDescriptions[key as Permission]?.length ?? 0).toBeGreaterThan(2);
    }
  });

  it("keeps the two scopes disjoint", () => {
    const account = new Set<string>(accountPermissions);
    for (const key of organizationPermissions) expect(account.has(key)).toBe(false);
  });
});

describe("organization role permissions", () => {
  it("nests strictly: each role holds everything the role below it holds", () => {
    for (let index = 1; index < organizationRolesByRank.length; index += 1) {
      const lower = new Set(organizationRolePermissions[organizationRolesByRank[index - 1]]);
      const higher = new Set(organizationRolePermissions[organizationRolesByRank[index]]);
      for (const permission of lower) expect(higher.has(permission)).toBe(true);
    }
  });

  it("gives an owner the entire vocabulary", () => {
    expect([...organizationRolePermissions.owner].sort()).toEqual(
      [...organizationPermissions].sort(),
    );
  });

  it("stops an operator short of approving, publishing, and moving money", () => {
    for (const permission of [
      "campaign.approve",
      "campaign.publish",
      "budget.modify",
      "policy.update",
      "organization.archive",
    ] as const) {
      expect(hasOrganizationPermission("operator", permission)).toBe(false);
    }
  });

  it("lets an operator do the daily work", () => {
    for (const permission of [
      "memory.write",
      "memory.verify",
      "memory.supersede",
      "memory.promote_fact",
      "campaign.create",
      "campaign.edit",
      "economics.write",
      "onboarding.manage",
    ] as const) {
      expect(hasOrganizationPermission("operator", permission)).toBe(true);
    }
  });

  it("keeps sensitive memory above the operator line", () => {
    expect(hasOrganizationPermission("operator", "memory.read_sensitive")).toBe(false);
    expect(hasOrganizationPermission("viewer", "memory.read_sensitive")).toBe(false);
    expect(hasOrganizationPermission("admin", "memory.read_sensitive")).toBe(true);
    expect(hasOrganizationPermission("owner", "memory.read_sensitive")).toBe(true);
  });

  it("gives a viewer reads and nothing else", () => {
    for (const permission of organizationPermissions) {
      const allowed = hasOrganizationPermission("viewer", permission);
      if (allowed) expect(permission.endsWith(".read")).toBe(true);
    }
  });

  it("reserves archiving for the owner alone", () => {
    expect(hasOrganizationPermission("owner", "organization.archive")).toBe(true);
    for (const role of ["admin", "operator", "viewer"] as const) {
      expect(hasOrganizationPermission(role, "organization.archive")).toBe(false);
    }
  });
});

describe("account role permissions", () => {
  it("keeps a plain member out of agency administration", () => {
    for (const permission of [
      "member.invite",
      "member.manage_role",
      "member.remove",
      "organization.create",
      "account.update",
    ] as const) {
      expect(hasAccountPermission("member", permission)).toBe(false);
    }
  });

  it("lets a member see the agency they belong to", () => {
    expect(hasAccountPermission("member", "account.read")).toBe(true);
    expect(hasAccountPermission("member", "member.read")).toBe(true);
  });

  it("lets owners and admins invite", () => {
    expect(hasAccountPermission("owner", "member.invite")).toBe(true);
    expect(hasAccountPermission("admin", "member.invite")).toBe(true);
  });

  it("nests: an admin holds everything a member holds", () => {
    for (const permission of accountRolePermissions.member) {
      expect(hasAccountPermission("admin", permission)).toBe(true);
    }
  });

  /**
   * Owner and admin are equal here on purpose: account deletion and billing do
   * not exist yet, so there is nothing to withhold. What separates them -- only
   * an owner may appoint an owner -- is enforced by the account role-ceiling
   * trigger, not by a permission. Asserted so that stays a decision rather than
   * something a reader mistakes for an oversight.
   */
  it("currently gives owner and admin the same permissions", () => {
    expect([...accountRolePermissions.owner].sort()).toEqual(
      [...accountRolePermissions.admin].sort(),
    );
  });
});

describe("unknown roles", () => {
  it("refuse rather than defaulting to allowed", () => {
    expect(hasOrganizationPermission("root" as OrganizationRole, "memory.read")).toBe(false);
    expect(hasAccountPermission("root" as AccountRole, "account.read")).toBe(false);
  });
});
