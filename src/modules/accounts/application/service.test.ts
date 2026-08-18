import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_APP_URL: "https://app.example.com" } }));
// No key, no adapter: a suite can never mail a real person.
vi.mock("@/modules/accounts/application/email", () => ({
  invitationEmailSender: () => ({ send: async () => ({ sent: false }) }),
}));
vi.mock("@/modules/accounts/application/sign-in-links", () => ({
  mintInvitationSignInUrl: async () => null,
}));

import { DomainError } from "@/lib/errors";
import {
  acceptInvitation,
  createInvitation,
  previewInvitation,
} from "@/modules/accounts/application/service";
import { tokenDigest } from "@/modules/accounts/application/tokens";

const ACCOUNT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN = "A".repeat(43);
const INVITER = { accountName: "Super-admin agency", inviterName: "Jishnu" };

function clientWith(
  rpcResult: { data: unknown; error: unknown },
  user: { email?: string } | null = null,
) {
  const rpc = vi.fn().mockReturnValue({
    maybeSingle: () => Promise.resolve(rpcResult),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(rpcResult).then(resolve),
  });
  const client = {
    rpc,
    auth: { getUser: async () => ({ data: { user } }) },
  } as never;
  return { client, rpc };
}

describe("createInvitation", () => {
  it("sends only the digest to the database, never the token", async () => {
    const { client, rpc } = clientWith({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        email: "sarah@example.com",
        account_role: "member",
        default_organization_role: "operator",
        expires_at: "2026-08-24T00:00:00.000Z",
      },
      error: null,
    });

    const invitation = await createInvitation(
      client,
      ACCOUNT_ID,
      {
        email: "sarah@example.com",
        accountRole: "member",
        defaultOrganizationRole: "operator",
      },
      INVITER,
    );

    const args = rpc.mock.calls[0][1];
    expect(args.p_token_hash).toMatch(/^[0-9a-f]{64}$/);

    // The raw token appears in the returned link and nowhere else.
    const token = invitation.acceptUrl.split("/invitations/")[1];
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenDigest(token)).toBe(args.p_token_hash);
    expect(JSON.stringify(args)).not.toContain(token);
  });

  it("reports a duplicate as the inviter's own mistake, not as a mystery", async () => {
    const { client } = clientWith({ data: null, error: { code: "23505" } });
    await expect(
      createInvitation(
        client,
        ACCOUNT_ID,
        {
          email: "sarah@example.com",
          accountRole: "member",
          defaultOrganizationRole: "viewer",
        },
        INVITER,
      ),
    ).rejects.toMatchObject({
      code: "DOMAIN_ERROR",
      message: "That person already has an invitation or is already a member.",
    });
  });

  it("reports the rate limit with a recovery, rather than a generic failure", async () => {
    const { client } = clientWith({ data: null, error: { code: "53400" } });
    await expect(
      createInvitation(
        client,
        ACCOUNT_ID,
        {
          email: "sarah@example.com",
          accountRole: "member",
          defaultOrganizationRole: "viewer",
        },
        INVITER,
      ),
    ).rejects.toMatchObject({ message: /Too many invitations/ });
  });

  it("refuses an over-privileged invitation as an authorization error", async () => {
    const { client } = clientWith({ data: null, error: { code: "42501" } });
    await expect(
      createInvitation(
        client,
        ACCOUNT_ID,
        {
          email: "sarah@example.com",
          accountRole: "owner",
          defaultOrganizationRole: null,
        },
        INVITER,
      ),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });
  });
});

describe("acceptInvitation", () => {
  /**
   * The security property of this whole route: every refusal reads the same to
   * the caller. Distinguishing them turns the accept endpoint into a probe for
   * valid tokens, and confirms which addresses were invited.
   */
  it.each([
    ["an unknown token", { code: "P0002" }],
    ["a wrong email address", { code: "42501" }],
    ["an unexpected failure", { code: "XX000" }],
  ])("refuses %s with one indistinguishable message", async (_label, error) => {
    const { client } = clientWith({ data: null, error });
    await expect(acceptInvitation(client, TOKEN)).rejects.toMatchObject({
      code: "AUTHORIZATION_ERROR",
      message: "This invitation link is no longer valid.",
    });
  });

  it("looks the invitation up by digest, never by the raw token", async () => {
    const { client, rpc } = clientWith({
      data: { id: ACCOUNT_ID, name: "Super-admin agency" },
      error: null,
    });
    await acceptInvitation(client, TOKEN);
    expect(rpc.mock.calls[0][1]).toEqual({ p_token_hash: tokenDigest(TOKEN) });
    expect(JSON.stringify(rpc.mock.calls[0][1])).not.toContain(TOKEN);
  });

  it("returns the account the invitee just joined", async () => {
    const { client } = clientWith({
      data: { id: ACCOUNT_ID, name: "Super-admin agency" },
      error: null,
    });
    await expect(acceptInvitation(client, TOKEN)).resolves.toEqual({
      accountId: ACCOUNT_ID,
      accountName: "Super-admin agency",
    });
  });
});

describe("previewInvitation", () => {
  it("reports an unknown token as invalid, revealing nothing", async () => {
    const { client } = clientWith({ data: null, error: null });
    const preview = await previewInvitation(client, TOKEN);
    expect(preview).toMatchObject({
      state: "invalid",
      accountName: null,
      invitedEmail: null,
      inviterName: null,
      matchesCaller: false,
    });
  });

  it("carries the signed-in address so the page can name a mismatch", async () => {
    const { client } = clientWith(
      {
        data: {
          state: "valid",
          account_name: "Super-admin agency",
          invited_email: "sarah@example.com",
          inviter_name: "Jishnu",
          account_role: "member",
          default_organization_role: "operator",
          expires_at: "2026-08-24T00:00:00.000Z",
          matches_caller: false,
        },
        error: null,
      },
      { email: "someone-else@example.com" },
    );

    const preview = await previewInvitation(client, TOKEN);
    expect(preview.state).toBe("valid");
    expect(preview.matchesCaller).toBe(false);
    expect(preview.signedInEmail).toBe("someone-else@example.com");
  });

  it("throws on a real read failure rather than silently rendering invalid", async () => {
    const { client } = clientWith({ data: null, error: { code: "08006" } });
    await expect(previewInvitation(client, TOKEN)).rejects.toThrow(DomainError);
  });
});
