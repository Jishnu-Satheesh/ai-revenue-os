import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  recordOrganizationAccess,
  resolveLandingPath,
} from "@/modules/organizations/application/landing";

const organizationId = "11111111-1111-4111-8111-111111111111";

function fakeClient(user: { id: string } | null, rpcResult: { data?: unknown; error?: unknown }) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    rpc: vi
      .fn()
      .mockResolvedValue({ data: rpcResult.data ?? null, error: rpcResult.error ?? null }),
  };
}

describe("resolveLandingPath", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends anonymous visitors to login without reading organizations", async () => {
    const supabase = fakeClient(null, { data: organizationId });
    expect(await resolveLandingPath(supabase as never)).toBe("/login");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("sends a member to the resolved organization's Overview", async () => {
    const supabase = fakeClient({ id: "user-1" }, { data: organizationId });
    expect(await resolveLandingPath(supabase as never)).toBe(
      `/organizations/${organizationId}/overview`,
    );
    expect(supabase.rpc).toHaveBeenCalledWith("resolve_landing_organization");
  });

  it("sends a member with nothing resolvable to the create wizard", async () => {
    expect(await resolveLandingPath(fakeClient({ id: "user-1" }, { data: null }) as never)).toBe(
      "/organizations/new",
    );
  });

  it("treats a failed read as nothing resolvable rather than crashing the landing", async () => {
    const supabase = fakeClient({ id: "user-1" }, { error: { message: "boom" } });
    expect(await resolveLandingPath(supabase as never)).toBe("/organizations/new");
  });
});

describe("recordOrganizationAccess", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records a visit against the organization in scope", async () => {
    const supabase = fakeClient({ id: "user-1" }, {});
    await recordOrganizationAccess(supabase as never, organizationId);
    expect(supabase.rpc).toHaveBeenCalledWith("touch_organization_access", {
      target_organization_id: organizationId,
    });
  });

  it("ignores a malformed identifier instead of calling the database", async () => {
    const supabase = fakeClient({ id: "user-1" }, {});
    await recordOrganizationAccess(supabase as never, "not-a-uuid");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("never turns a losing position into a broken page", async () => {
    const supabase = fakeClient({ id: "user-1" }, { error: { message: "denied" } });
    await expect(
      recordOrganizationAccess(supabase as never, organizationId),
    ).resolves.toBeUndefined();
  });
});
