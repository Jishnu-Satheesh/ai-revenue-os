import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_APP_URL: "https://app.example.com",
    INVITATION_FROM_ADDRESS: "Lunes AI <admin@lunes.in>",
    RESEND_API_KEY: undefined,
  },
}));

const emailSend = vi.fn();
vi.mock("@/modules/accounts/application/email", () => ({
  organizationInvitationEmailSender: () => ({ send: emailSend }),
}));

vi.mock("@/modules/accounts/application/sign-in-links", () => ({
  mintInvitationSignInUrl: () => Promise.resolve(null),
}));

import {
  acceptOrganizationInvitation,
  createOrganizationInvitation,
  listOrganizationTeam,
  listPendingOrganizationInvitations,
  previewOrganizationInvitation,
  reissueOrganizationInvitation,
  removeOrganizationMember,
  revokeOrganizationInvitation,
  updateOrganizationMemberRole,
} from "@/modules/organizations/application/invitations";

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const INVITE_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4344-8344-444444444444";

const context = { organizationName: "Client Alpha", inviterName: "Owner O" };

function invitationRow(overrides = {}) {
  return {
    id: INVITE_ID,
    organization_id: ORG_ID,
    email: "invitee@example.com",
    role: "viewer",
    expires_at: "2026-09-24T00:00:00.000Z",
    created_at: "2026-09-17T00:00:00.000Z",
    status: "pending",
    invited_by: USER_ID,
    ...overrides,
  };
}

/** A supabase client shaped exactly like the calls the service makes. */
function stubClient({ rpcImpl, fromImpl }: { rpcImpl?: unknown; fromImpl?: unknown } = {}) {
  const resolved = (rpcImpl ?? { data: null, error: null }) as { data: unknown; error: unknown };
  // The service awaits some calls directly and others through `.maybeSingle()`.
  const rpc = vi.fn(() => ({ ...resolved, maybeSingle: () => Promise.resolve(resolved) }));
  const from = vi.fn(() => fromImpl);
  return {
    rpc,
    from,
    auth: { getUser: () => Promise.resolve({ data: { user: { email: "me@example.com" } } }) },
  } as never;
}

function tableStub(rows: unknown, error: unknown = null) {
  const response = { data: rows, error };
  const chain: Record<string, (...args: never[]) => unknown> = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    update: () => chain,
    delete: () => chain,
    in: () => Promise.resolve({ data: [], error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(response).then(resolve),
  };
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  emailSend.mockResolvedValue({ sent: false });
});

describe("createOrganizationInvitation", () => {
  it("returns the token-bearing invitation with the organization accept URL", async () => {
    const supabase = stubClient({ rpcImpl: { data: invitationRow(), error: null } });

    const invitation = await createOrganizationInvitation(
      supabase,
      ORG_ID,
      { email: "invitee@example.com", role: "viewer" },
      context,
    );

    expect(invitation.email).toBe("invitee@example.com");
    expect(invitation.role).toBe("viewer");
    expect(invitation.acceptUrl).toContain("/organization-invitations/");
    expect(invitation.emailSent).toBe(false);
    expect(emailSend).toHaveBeenCalledOnce();
  });

  it("reports an existing explicit member specifically", async () => {
    const supabase = stubClient({
      rpcImpl: { data: null, error: { code: "23505", message: "dup" } },
    });

    await expect(
      createOrganizationInvitation(supabase, ORG_ID, { email: "x@y.zz", role: "viewer" }, context),
    ).rejects.toThrow("already a member of this client");
  });

  it("reports an overreaching role as an authorization failure", async () => {
    const supabase = stubClient({
      rpcImpl: { data: null, error: { code: "42501", message: "nope" } },
    });

    await expect(
      createOrganizationInvitation(supabase, ORG_ID, { email: "x@y.zz", role: "owner" }, context),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });
});

describe("reissue and revoke", () => {
  it("refuses a reissue scoped to another organization", async () => {
    const supabase = stubClient({
      rpcImpl: { data: invitationRow({ organization_id: "other-org" }), error: null },
    });

    await expect(
      reissueOrganizationInvitation(supabase, ORG_ID, INVITE_ID, context),
    ).rejects.toThrow("no longer pending");
    expect(emailSend).not.toHaveBeenCalled();
  });

  it("refuses a revoke scoped to another organization", async () => {
    const supabase = stubClient({
      rpcImpl: { data: invitationRow({ organization_id: "other-org" }), error: null },
    });

    await expect(revokeOrganizationInvitation(supabase, ORG_ID, INVITE_ID)).rejects.toThrow(
      "no longer pending",
    );
  });
});

describe("listPendingOrganizationInvitations", () => {
  it("maps rows and evaluates expiry itself", async () => {
    const supabase = stubClient({
      fromImpl: tableStub([
        invitationRow({ expires_at: "2020-01-01T00:00:00.000Z" }),
        invitationRow({
          id: "55555555-5555-4555-8555-555555555555",
          email: "fresh@example.com",
          expires_at: "2999-01-01T00:00:00.000Z",
        }),
      ]),
    });

    const [stale, fresh] = await listPendingOrganizationInvitations(supabase, ORG_ID);

    expect(stale?.isExpired).toBe(true);
    expect(fresh?.isExpired).toBe(false);
    expect(fresh?.role).toBe("viewer");
  });
});

describe("listOrganizationTeam", () => {
  it("maps explicit rows with addresses", async () => {
    const supabase = stubClient({
      rpcImpl: {
        data: [
          {
            user_id: USER_ID,
            email: "owner@example.com",
            display_name: "Owner O",
            role: "owner",
            created_at: "2026-09-17T00:00:00.000Z",
          },
        ],
        error: null,
      },
    });

    const [member] = await listOrganizationTeam(supabase, ORG_ID);

    expect(member).toMatchObject({ email: "owner@example.com", role: "owner" });
  });
});

describe("member writes", () => {
  it("translates the last-owner guard into words", async () => {
    const supabase = stubClient({
      fromImpl: tableStub(null, { code: "P0001", message: "last owner" }),
    });

    await expect(updateOrganizationMemberRole(supabase, ORG_ID, USER_ID, "viewer")).rejects.toThrow(
      "keep at least one owner",
    );
  });

  it("treats a silent zero-row removal as a refusal", async () => {
    const supabase = stubClient({ fromImpl: tableStub([]) });

    await expect(removeOrganizationMember(supabase, ORG_ID, USER_ID)).rejects.toMatchObject({
      code: "AUTHORIZATION_ERROR",
    });
  });
});

describe("previewOrganizationInvitation", () => {
  it("maps the organization preview shape", async () => {
    const supabase = stubClient({
      rpcImpl: {
        data: {
          state: "valid",
          organization_id: ORG_ID,
          organization_name: "Client Alpha",
          invited_email: "invitee@example.com",
          inviter_name: "Owner O",
          role: "operator",
          expires_at: "2026-09-24T00:00:00.000Z",
          matches_caller: true,
        },
        error: null,
      },
    });

    const preview = await previewOrganizationInvitation(supabase, "x".repeat(43));

    expect(preview).toMatchObject({
      state: "valid",
      organizationName: "Client Alpha",
      role: "operator",
      matchesCaller: true,
      signedInEmail: "me@example.com",
    });
  });
});

describe("acceptOrganizationInvitation", () => {
  it("returns the organization the invitee joined", async () => {
    const supabase = stubClient({
      rpcImpl: { data: { id: ORG_ID, name: "Client Alpha" }, error: null },
    });

    await expect(acceptOrganizationInvitation(supabase, "x".repeat(43))).resolves.toEqual({
      organizationId: ORG_ID,
      organizationName: "Client Alpha",
    });
  });

  it("refuses opaquely on failure", async () => {
    const supabase = stubClient({
      rpcImpl: { data: null, error: { code: "42501", message: "mismatch" } },
    });

    await expect(acceptOrganizationInvitation(supabase, "x".repeat(43))).rejects.toThrow(
      "no longer valid",
    );
  });
});
