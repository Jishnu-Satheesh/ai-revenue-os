// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: null as unknown,
  invitations: [] as unknown[],
  postInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  reissueInvitation: vi.fn(),
}));

vi.mock("@/components/accounts/account-session", async () => {
  const actual = await vi.importActual<typeof import("@/components/accounts/account-session")>(
    "@/components/accounts/account-session",
  );
  return {
    ...actual,
    useAccountSession: () => ({ data: mocks.session, isPending: false }),
    usePendingInvitations: () => ({ data: mocks.invitations, isPending: false }),
    postInvitation: mocks.postInvitation,
    revokeInvitation: mocks.revokeInvitation,
    reissueInvitation: mocks.reissueInvitation,
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { InviteMemberDialog } from "@/components/accounts/invite-member-dialog";
import { SidebarProvider } from "@/components/ui/sidebar";

function sessionWith(permissions: string[]) {
  return {
    account: { id: "a".repeat(8), name: "Super-admin agency", slug: "super-admin-agency" },
    membership: { accountRole: "owner" },
    profile: { id: "u", email: "jishnu@example.com", displayName: "Jishnu", avatarUrl: null },
    permissions,
  };
}

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SidebarProvider>
        <InviteMemberDialog />
      </SidebarProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.invitations = [];
});

describe("InviteMemberDialog", () => {
  /**
   * The gate that matters. A control that can never become enabled is worse than
   * absent, and showing it would advertise an action the server will refuse.
   */
  it("is absent entirely for someone without permission to invite", () => {
    mocks.session = sessionWith(["account.read", "member.read"]);
    renderDialog();
    expect(screen.queryByTestId("invite-member-entry")).not.toBeInTheDocument();
  });

  it("is absent while the account is unknown, rather than guessing", () => {
    mocks.session = undefined;
    renderDialog();
    expect(screen.queryByTestId("invite-member-entry")).not.toBeInTheDocument();
  });

  it("appears for someone who may invite", () => {
    mocks.session = sessionWith(["member.invite", "member.read"]);
    renderDialog();
    expect(screen.getByTestId("invite-member-entry")).toBeInTheDocument();
  });

  it("asks for both roles, because they are two different questions", async () => {
    mocks.session = sessionWith(["member.invite", "member.read"]);
    renderDialog();
    fireEvent.click(screen.getByTestId("invite-member-entry"));

    expect(screen.getByLabelText(/role in the agency/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/role inside each client/i)).toBeInTheDocument();
  });

  it("shows client scope as locked, so the future is visible rather than a surprise", async () => {
    mocks.session = sessionWith(["member.invite", "member.read"]);
    renderDialog();
    fireEvent.click(screen.getByTestId("invite-member-entry"));

    expect(screen.getByText(/all clients, including ones added later/i)).toBeInTheDocument();
    expect(screen.getByText(/choosing specific clients is coming later/i)).toBeInTheDocument();
  });

  it("says no email was sent, rather than implying one was", async () => {
    mocks.session = sessionWith(["member.invite", "member.read"]);
    mocks.postInvitation.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      email: "sarah@example.com",
      accountRole: "member",
      defaultOrganizationRole: "operator",
      expiresAt: "2026-08-24T00:00:00.000Z",
      acceptUrl: "https://app.example.com/invitations/abc",
    });

    renderDialog();
    fireEvent.click(screen.getByTestId("invite-member-entry"));
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "sarah@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create invitation link/i }));

    await waitFor(() => expect(screen.getByText(/no email was sent/i)).toBeInTheDocument());
    expect(screen.getByLabelText(/invitation link/i)).toHaveValue(
      "https://app.example.com/invitations/abc",
    );
  });

  it("warns that the link is shown once, before the user can lose it", async () => {
    mocks.session = sessionWith(["member.invite", "member.read"]);
    mocks.postInvitation.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      email: "sarah@example.com",
      accountRole: "member",
      defaultOrganizationRole: "operator",
      expiresAt: "2026-08-24T00:00:00.000Z",
      acceptUrl: "https://app.example.com/invitations/abc",
    });

    renderDialog();
    fireEvent.click(screen.getByTestId("invite-member-entry"));
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "sarah@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create invitation link/i }));

    await waitFor(() => expect(screen.getByText(/shown once/i)).toBeInTheDocument());
  });

  it("surfaces a refusal instead of failing silently", async () => {
    mocks.session = sessionWith(["member.invite", "member.read"]);
    mocks.postInvitation.mockRejectedValue(
      new Error("That person already has an invitation or is already a member."),
    );

    renderDialog();
    fireEvent.click(screen.getByTestId("invite-member-entry"));
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "sarah@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create invitation link/i }));

    await waitFor(() => expect(screen.getByText(/already has an invitation/i)).toBeInTheDocument());
  });

  it("offers withdraw on a pending invitation, so a typo is recoverable", async () => {
    mocks.session = sessionWith(["member.invite", "member.read"]);
    mocks.invitations = [
      {
        id: "22222222-2222-4222-8222-222222222222",
        email: "typo@example.com",
        accountRole: "member",
        defaultOrganizationRole: "operator",
        expiresAt: "2026-08-24T00:00:00.000Z",
        createdAt: "2026-08-17T00:00:00.000Z",
        invitedByName: "Jishnu",
        isExpired: false,
      },
    ];

    renderDialog();
    fireEvent.click(screen.getByTestId("invite-member-entry"));

    expect(screen.getByText("typo@example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /withdraw/i }));
    // react-query hands the mutation function extra arguments, so assert on the
    // one the component actually chose.
    await waitFor(() => expect(mocks.revokeInvitation).toHaveBeenCalled());
    expect(mocks.revokeInvitation.mock.calls[0][0]).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("marks an invitation past its date as expired even while it is still listed", async () => {
    mocks.session = sessionWith(["member.invite", "member.read"]);
    mocks.invitations = [
      {
        id: "33333333-3333-4333-8333-333333333333",
        email: "stale@example.com",
        accountRole: "member",
        defaultOrganizationRole: "viewer",
        expiresAt: "2026-08-01T00:00:00.000Z",
        createdAt: "2026-07-25T00:00:00.000Z",
        invitedByName: "Jishnu",
        isExpired: true,
      },
    ];

    renderDialog();
    fireEvent.click(screen.getByTestId("invite-member-entry"));

    expect(screen.getByText(/expired/i)).toBeInTheDocument();
  });

  it("explains an empty pending list rather than showing nothing", async () => {
    mocks.session = sessionWith(["member.invite", "member.read"]);
    renderDialog();
    fireEvent.click(screen.getByTestId("invite-member-entry"));

    expect(screen.getByText(/nobody is waiting on an invitation/i)).toBeInTheDocument();
  });
});
