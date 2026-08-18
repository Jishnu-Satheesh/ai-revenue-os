import { describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
import {
  requireOrganizationAccess,
  requireOrganizationAdminAccess,
  requireOrganizationWriteAccess,
} from "@/modules/organizations/application/authorization";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

function clientReturning(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  // Only `rpc` is reachable from this module; the cast keeps the test honest
  // about that rather than standing up a whole fake client.
  return { client: { rpc } as never, rpc };
}

describe("requireOrganizationAccess", () => {
  it("resolves the role through the database, not the membership table", async () => {
    const { client, rpc } = clientReturning({ data: "operator", error: null });

    const access = await requireOrganizationAccess(client, ORGANIZATION_ID, USER_ID);

    expect(rpc).toHaveBeenCalledWith("current_organization_role", {
      target_organization_id: ORGANIZATION_ID,
    });
    expect(access).toEqual({
      organization_id: ORGANIZATION_ID,
      user_id: USER_ID,
      role: "operator",
    });
  });

  it("admits a role that comes from the account rather than an explicit membership", async () => {
    // The resolver returns a role for an organization the user has no
    // organization_memberships row in. That is the whole point of accounts, and
    // the old table lookup would have refused here.
    const { client } = clientReturning({ data: "admin", error: null });

    await expect(
      requireOrganizationAdminAccess(client, ORGANIZATION_ID, USER_ID),
    ).resolves.toMatchObject({ role: "admin" });
  });

  it("refuses when the resolver returns no role", async () => {
    const { client } = clientReturning({ data: null, error: null });

    await expect(requireOrganizationAccess(client, ORGANIZATION_ID, USER_ID)).rejects.toThrow(
      DomainError,
    );
  });

  it("refuses when the call itself fails, without leaking why", async () => {
    const { client } = clientReturning({ data: null, error: { message: "connection reset" } });

    await expect(requireOrganizationAccess(client, ORGANIZATION_ID, USER_ID)).rejects.toMatchObject(
      {
        code: "AUTHORIZATION_ERROR",
        message: "You do not have access to this organization.",
      },
    );
  });

  it("refuses a role the domain does not recognise rather than trusting it", async () => {
    const { client } = clientReturning({ data: "superuser", error: null });

    await expect(requireOrganizationAccess(client, ORGANIZATION_ID, USER_ID)).rejects.toThrow(
      DomainError,
    );
  });

  it("separates having access from having permission", async () => {
    const { client } = clientReturning({ data: "viewer", error: null });

    await expect(
      requireOrganizationWriteAccess(client, ORGANIZATION_ID, USER_ID),
    ).rejects.toMatchObject({
      code: "AUTHORIZATION_ERROR",
      message: "You do not have permission for this organization action.",
    });
  });

  it("admits every role the caller allows", async () => {
    for (const role of ["owner", "admin", "operator"] as const) {
      const { client } = clientReturning({ data: role, error: null });
      await expect(
        requireOrganizationWriteAccess(client, ORGANIZATION_ID, USER_ID),
      ).resolves.toMatchObject({ role });
    }
  });
});
