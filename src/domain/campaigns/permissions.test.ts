import { describe, expect, it } from "vitest";

import {
  organizationPermissions,
  organizationRolePermissions,
  type OrganizationPermission,
} from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import {
  campaignPermissions,
  hasCampaignPermission,
  rolesWith,
} from "@/domain/campaigns/permissions";

const ROLES: readonly OrganizationRole[] = ["owner", "admin", "operator", "viewer"];

/**
 * Two maps answer the same question, and the campaign routes rely on them
 * agreeing.
 *
 * `campaignRouteContext` reads this module. The account catalogue -- rows in
 * `public.permissions` mirrored by `src/domain/access/permissions.ts` -- is the
 * newer permission-as-data system. Where both name a permission, a divergence
 * means a route admits somebody the other system says may not act, so the tests
 * below pin the overlap rather than trusting a comment.
 *
 * Two kinds of exception are recorded explicitly rather than skipped, so a
 * *new* one cannot appear quietly.
 */

/**
 * Names that are not permission-as-data at all.
 *
 * Every campaign write function -- `approve_campaign_bundle`,
 * `record_campaign_visual_attestation`, the scheduling functions -- checks
 * `private.has_organization_role(...)` against an explicit role array. It never
 * looks up a permission key. So these three names exist only to tell a route
 * which roles to admit, and a catalogue row for them would be a row nothing
 * reads. The permission catalogue migration's own header warns against reading
 * such a row as a claim that a permission is wired in.
 */
const ROLE_ENFORCED_ONLY: readonly string[] = [
  "campaign.attest",
  "campaign.schedule",
  "campaign.cancel",
];

describe("the campaign permission map and the account catalogue", () => {
  it("names every campaign permission in the catalogue, bar those enforced by role", () => {
    const known = new Set<string>(organizationPermissions);
    const absent = campaignPermissions.filter((permission) => !known.has(permission));

    expect([...absent].sort()).toEqual([...ROLE_ENFORCED_ONLY].sort());
  });

  it("grants each shared campaign permission to the same roles in both maps", () => {
    const shared = campaignPermissions.filter(
      (permission) => !ROLE_ENFORCED_ONLY.includes(permission),
    );
    expect(shared.length).toBeGreaterThan(0);

    for (const permission of shared) {
      const here = ROLES.filter((role) => hasCampaignPermission(role, permission));
      const there = ROLES.filter((role) =>
        organizationRolePermissions[role].includes(permission as OrganizationPermission),
      );
      expect(here, `${permission} is granted differently in the two maps`).toEqual(there);
    }
  });

  /**
   * Resolved 2026-09-06 by the product owner: an operator may approve.
   *
   * The three maps disagreed for weeks. This module and
   * `approve_campaign_bundle` both admitted an operator; the account catalogue
   * did not, and was the one nothing enforced. Migration `20260906090000`
   * brought it into line, so this now asserts agreement rather than pinning a
   * divergence.
   */
  it("lets an operator approve, in both maps and in the database's own role list", () => {
    expect([...rolesWith("campaign.approve")]).toEqual(["owner", "admin", "operator"]);
    expect(
      ROLES.filter((role) => organizationRolePermissions[role].includes("campaign.approve")),
    ).toEqual(["owner", "admin", "operator"]);
  });

  /**
   * The operator boundary did not move wholesale. Approving the exact version
   * that will run is a different act from moving money or pushing to a public
   * account, and those stay above the line.
   */
  it("keeps publishing and money above the operator line", () => {
    for (const permission of ["campaign.publish", "budget.modify", "policy.update"] as const) {
      expect(
        organizationRolePermissions.operator.includes(permission as OrganizationPermission),
        `${permission} should stay above operator`,
      ).toBe(false);
    }
  });

  /** Admitting a role the function then refuses is a 403 that reads as a bug. */
  it("admits the three roles the campaign write functions require", () => {
    for (const permission of ROLE_ENFORCED_ONLY) {
      expect([...rolesWith(permission as (typeof campaignPermissions)[number])]).toEqual([
        "owner",
        "admin",
        "operator",
      ]);
    }
  });
});

describe("poster.render", () => {
  /**
   * Producing a poster spends a model call and writes a row nobody can delete,
   * so it sits with the roles that change a campaign. Reading one is
   * `campaign.read`, which a viewer holds.
   */
  it("is granted identically here and in the account catalogue", () => {
    expect([...rolesWith("poster.render")]).toEqual(["owner", "admin", "operator"]);
    expect(
      ROLES.filter((role) => organizationRolePermissions[role].includes("poster.render")),
    ).toEqual(["owner", "admin", "operator"]);
  });

  it("is not held by a viewer", () => {
    expect(hasCampaignPermission("viewer", "poster.render")).toBe(false);
  });
});
