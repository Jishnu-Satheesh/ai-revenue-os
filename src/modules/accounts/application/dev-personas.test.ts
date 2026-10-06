import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://app.example.com" } }));

import {
  DEV_PERSONA_EMAILS,
  ensureDevPersona,
  mintDevPersonaSignInUrl,
  type DevPersonaAdminClient,
  type DevPersonaMembershipStore,
} from "@/modules/accounts/application/dev-personas";

const ORGANIZATION_ID = "2dda45b8-82db-4f5f-b17d-611b9bbb7846";

function fakeAdmin(users: { id: string; email?: string }[] = []) {
  const store = [...users];
  const calls = { created: [] as string[] };
  const admin: DevPersonaAdminClient = {
    listUsers: async () => ({ data: { users: store }, error: null }),
    createUser: async (params: { email: string }) => {
      calls.created.push(params.email);
      const user = { id: `user-for-${params.email}`, email: params.email };
      store.push(user);
      return { data: { user }, error: null };
    },
    generateLink: async () => ({
      data: { properties: { hashed_token: "token-1" } },
      error: null,
    }),
  };
  return { admin, calls };
}

function fakeMemberships() {
  const upserts: { organizationId: string; userId: string; role: string }[] = [];
  const memberships: DevPersonaMembershipStore = {
    upsertMembership: async (input) => {
      upserts.push(input);
    },
  };
  return { memberships, upserts };
}

describe("dev personas", () => {
  it("reuses the existing persona user without creating one", async () => {
    const { admin, calls } = fakeAdmin([{ id: "user-1", email: "dev.owner@lunes.test" }]);
    const { memberships, upserts } = fakeMemberships();

    const persona = await ensureDevPersona(
      { admin, memberships },
      { organizationId: ORGANIZATION_ID, role: "owner" },
    );

    expect(persona).toEqual({ userId: "user-1", email: "dev.owner@lunes.test" });
    expect(calls.created).toEqual([]);
    expect(upserts).toEqual([{ organizationId: ORGANIZATION_ID, userId: "user-1", role: "owner" }]);
  });

  it("creates a confirmed namespaced user when none exists", async () => {
    const created: { email: string; email_confirm: boolean; user_metadata: unknown }[] = [];
    const admin: DevPersonaAdminClient = {
      listUsers: async () => ({ data: { users: [] }, error: null }),
      createUser: (async (params: {
        email: string;
        email_confirm: boolean;
        user_metadata: Record<string, unknown>;
      }) => {
        created.push(params);
        return { data: { user: { id: "user-9", email: params.email } }, error: null };
      }) as DevPersonaAdminClient["createUser"],
      generateLink: async () => ({
        data: { properties: { hashed_token: "token-1" } },
        error: null,
      }),
    };
    const { memberships, upserts } = fakeMemberships();

    const persona = await ensureDevPersona(
      { admin, memberships },
      { organizationId: ORGANIZATION_ID, role: "viewer" },
    );

    expect(persona).toEqual({ userId: "user-9", email: "dev.viewer@lunes.test" });
    expect(created).toEqual([
      { email: "dev.viewer@lunes.test", email_confirm: true, user_metadata: { dev_persona: true } },
    ]);
    expect(upserts).toEqual([
      { organizationId: ORGANIZATION_ID, userId: "user-9", role: "viewer" },
    ]);
  });

  it("mints a callback URL carrying only the token", async () => {
    const { admin } = fakeAdmin();

    const url = await mintDevPersonaSignInUrl(
      { admin },
      { email: DEV_PERSONA_EMAILS.operator, next: "/organizations/abc/settings" },
    );

    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/auth/callback");
    expect(parsed.searchParams.get("token_hash")).toBe("token-1");
    expect(parsed.searchParams.get("type")).toBe("magiclink");
    expect(parsed.searchParams.get("next")).toBe("/organizations/abc/settings");
    expect(url).not.toContain("dev.operator@lunes.test");
  });

  it("refuses to mint for a non-persona address without calling generateLink", async () => {
    const { admin } = fakeAdmin();
    const generateLink = vi.spyOn(admin, "generateLink");

    await expect(
      mintDevPersonaSignInUrl(
        { admin },
        { email: "someone.real@example.com", next: "/organizations/abc/settings" },
      ),
    ).rejects.toThrow();
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("fails closed when the user list cannot be read", async () => {
    const admin: DevPersonaAdminClient = {
      listUsers: async () => ({ data: null, error: { message: "down" } }),
      createUser: vi.fn() as unknown as DevPersonaAdminClient["createUser"],
      generateLink: vi.fn() as unknown as DevPersonaAdminClient["generateLink"],
    };
    const { memberships } = fakeMemberships();

    await expect(
      ensureDevPersona({ admin, memberships }, { organizationId: ORGANIZATION_ID, role: "owner" }),
    ).rejects.toThrow();
    expect(admin.createUser).not.toHaveBeenCalled();
  });
});
