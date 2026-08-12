import { describe, expect, it } from "vitest";

import { isOrganizationPath, organizationIdFromPathname, overviewPath } from "@/lib/routes";

const organizationId = "11111111-1111-4111-8111-111111111111";

describe("organization route helpers", () => {
  it("extracts scope only from valid organization routes", () => {
    expect(organizationIdFromPathname(`/organizations/${organizationId}/overview`)).toBe(
      organizationId,
    );
    expect(organizationIdFromPathname(`/organizations/${organizationId}`)).toBe(organizationId);
    // `new` is the create wizard, not a tenant, so it must never read as scope.
    expect(organizationIdFromPathname("/organizations/new")).toBeNull();
    expect(organizationIdFromPathname("/organizations/not-a-uuid/overview")).toBeNull();
    expect(organizationIdFromPathname("/organizations")).toBeNull();
    expect(organizationIdFromPathname("/")).toBeNull();
  });

  it("builds the canonical Overview URL and reports scope", () => {
    expect(overviewPath(organizationId)).toBe(`/organizations/${organizationId}/overview`);
    expect(isOrganizationPath(`/organizations/${organizationId}/economics`)).toBe(true);
    expect(isOrganizationPath("/organizations/new")).toBe(false);
  });
});
