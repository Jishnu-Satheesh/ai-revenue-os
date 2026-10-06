import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { assertWorkerWatchManageAuthority } from "./worker-watch-authorization";

const ORG = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";
type Rows = Record<string, Record<string, unknown>[]>;

function client(rows: Rows, failedTable?: string) {
  return { from(table: string) {
    const filters: Record<string, unknown> = {};
    const builder = {
      select: () => builder,
      eq: (key: string, value: unknown) => { filters[key] = value; return builder; },
      maybeSingle: async () => ({
        data: failedTable === table ? null : (rows[table] ?? []).find((row) =>
          Object.entries(filters).every(([key, value]) => row[key] === value)) ?? null,
        error: failedTable === table ? { code: "42501" } : null,
      }),
    };
    return builder;
  } };
}

function baseRows(): Rows {
  return {
    organizations: [{ id: ORG, account_id: ACCOUNT }],
    organization_memberships: [{ organization_id: ORG, user_id: ACTOR, role: "operator" }],
    account_memberships: [],
  };
}

describe("worker watch source actor grant reads", () => {
  it("allows a current exact organization manager", async () => {
    await expect(assertWorkerWatchManageAuthority(client(baseRows()) as never,
      { organizationId: ORG, actorId: ACTOR })).resolves.toBe("operator");
  });

  it("resolves the highest account and explicit roles through the existing role rank", async () => {
    const rows = baseRows();
    rows.organization_memberships[0].role = "viewer";
    rows.account_memberships = [{ account_id: ACCOUNT, user_id: ACTOR,
      account_role: "owner", default_organization_role: null }];
    await expect(assertWorkerWatchManageAuthority(client(rows) as never,
      { organizationId: ORG, actorId: ACTOR })).resolves.toBe("owner");
  });

  it("retains an invited account member's current default organization grant", async () => {
    const rows = baseRows();
    rows.organization_memberships = [];
    rows.account_memberships = [{ account_id: ACCOUNT, user_id: ACTOR,
      account_role: "member", default_organization_role: "operator" }];
    await expect(assertWorkerWatchManageAuthority(client(rows) as never,
      { organizationId: ORG, actorId: ACTOR })).resolves.toBe("operator");
  });

  it("refuses a viewer and a revoked actor instead of trusting the queued role", async () => {
    const rows = baseRows();
    rows.organization_memberships[0].role = "viewer";
    await expect(assertWorkerWatchManageAuthority(client(rows) as never,
      { organizationId: ORG, actorId: ACTOR })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
    rows.organization_memberships = [];
    await expect(assertWorkerWatchManageAuthority(client(rows) as never,
      { organizationId: ORG, actorId: ACTOR })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it("cannot inherit grants from another organization, account, or actor", async () => {
    const rows = baseRows();
    rows.organization_memberships = [
      { organization_id: ACCOUNT, user_id: ACTOR, role: "owner" },
      { organization_id: ORG, user_id: ACCOUNT, role: "owner" },
    ];
    rows.account_memberships = [
      { account_id: ORG, user_id: ACTOR, account_role: "owner", default_organization_role: null },
      { account_id: ACCOUNT, user_id: ORG, account_role: "owner", default_organization_role: null },
    ];
    await expect(assertWorkerWatchManageAuthority(client(rows) as never,
      { organizationId: ORG, actorId: ACTOR })).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });

  it.each(["organizations", "organization_memberships", "account_memberships"])(
    "fails closed when %s cannot be read", async (table) => {
      await expect(assertWorkerWatchManageAuthority(client(baseRows(), table) as never,
        { organizationId: ORG, actorId: ACTOR })).rejects.toMatchObject({ code: "INTEGRATION_ERROR" });
    },
  );

  it("refuses malformed current grants", async () => {
    const rows = baseRows();
    rows.organization_memberships[0].role = "invented_manager";
    await expect(assertWorkerWatchManageAuthority(client(rows) as never,
      { organizationId: ORG, actorId: ACTOR })).rejects.toMatchObject({ code: "INTEGRATION_ERROR" });
  });
});
