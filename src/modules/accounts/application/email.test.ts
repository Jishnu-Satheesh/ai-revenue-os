import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const send = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));
vi.mock("@/lib/env", () => ({
  env: { INVITATION_FROM_ADDRESS: "AI Revenue OS <invitations@themarga.in>" },
}));

import {
  createNoopInvitationEmailSender,
  createResendInvitationEmailSender,
} from "@/modules/accounts/application/email";

const request = {
  to: "sarah@example.com",
  invitationId: "11111111-1111-4111-8111-111111111111",
  accountName: "Super-admin agency",
  inviterName: "Jishnu",
  accountRoleLabel: "Member — a seat in the agency",
  organizationRoleLabel: "Operator in every client",
  actionUrl: "https://app.example.com/auth/callback?token_hash=abc&type=invite",
  isOneClick: true,
  expiresAt: "2026-08-24T00:00:00.000Z",
};

afterEach(() => vi.clearAllMocks());

describe("the no-op sender", () => {
  /** The default without a key, which is every test run. */
  it("reports that nothing was sent, rather than pretending", async () => {
    await expect(createNoopInvitationEmailSender().send(request)).resolves.toEqual({ sent: false });
  });
});

describe("the Resend sender", () => {
  it("sends from the verified domain to the invited address", async () => {
    send.mockResolvedValue({ data: { id: "email-1" }, error: null });
    await createResendInvitationEmailSender("re_test").send(request);

    const [payload] = send.mock.calls[0];
    expect(payload.from).toBe("AI Revenue OS <invitations@themarga.in>");
    expect(payload.to).toEqual(["sarah@example.com"]);
    expect(payload.subject).toContain("Super-admin agency");
  });

  it("carries both an HTML and a plain-text body", async () => {
    send.mockResolvedValue({ data: { id: "email-1" }, error: null });
    await createResendInvitationEmailSender("re_test").send(request);

    const [payload] = send.mock.calls[0];
    expect(payload.html).toContain("Super-admin agency");
    expect(payload.text).toContain(request.actionUrl);
  });

  /**
   * A retry must not deliver twice. The key is scoped to the invitation, so the
   * same send collapses while a genuinely new invitation still goes out.
   */
  it("scopes an idempotency key to the invitation", async () => {
    send.mockResolvedValue({ data: { id: "email-1" }, error: null });
    await createResendInvitationEmailSender("re_test").send(request);

    const [, options] = send.mock.calls[0];
    expect(options.idempotencyKey).toBe(`account-invitation/${request.invitationId}`);
  });

  /**
   * The SDK resolves with `{ data, error }` instead of throwing, so an unchecked
   * call looks successful while delivering nothing.
   */
  it("treats a returned error as a failure rather than a success", async () => {
    send.mockResolvedValue({ data: null, error: { name: "validation_error" } });

    await expect(createResendInvitationEmailSender("re_test").send(request)).resolves.toEqual({
      sent: false,
    });
  });

  it("escapes the agency name, so a quote cannot break out of the markup", async () => {
    send.mockResolvedValue({ data: { id: "email-1" }, error: null });
    await createResendInvitationEmailSender("re_test").send({
      ...request,
      accountName: '<script>alert("x")</script>',
    });

    const [payload] = send.mock.calls[0];
    expect(payload.html).not.toContain("<script>");
    expect(payload.html).toContain("&lt;script&gt;");
  });
});
