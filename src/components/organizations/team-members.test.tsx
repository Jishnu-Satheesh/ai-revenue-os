// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: "owner" as string | null,
  members: [] as unknown[],
  invitations: [] as unknown[],
  reissueOrganizationInvitation: vi.fn(),
  revokeOrganizationInvitation: vi.fn(),
  updateTeamMemberRole: vi.fn(),
  removeTeamMember: vi.fn(),
}));

vi.mock("@/components/organizations/organization-session", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/organizations/organization-session")
  >("@/components/organizations/organization-session");
  return {
    ...actual,
    useOrganizationSession: () => ({ data: { organizationId: "org", role: mocks.role } }),
    useTeamMembers: () => ({ data: mocks.members, isPending: false, error: null }),
    usePendingOrganizationInvitations: () => ({
      data: mocks.invitations,
      isPending: false,
      error: null,
    }),
    reissueOrganizationInvitation: mocks.reissueOrganizationInvitation,
    revokeOrganizationInvitation: mocks.revokeOrganizationInvitation,
    updateTeamMemberRole: mocks.updateTeamMemberRole,
    removeTeamMember: mocks.removeTeamMember,
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TeamMembers } from "@/components/organizations/team-members";

const ORG_ID = "22222222-2222-4222-8222-222222222222";

function renderTable() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TeamMembers organizationId={ORG_ID} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.role = "owner";
  mocks.members = [];
  mocks.invitations = [];
});

describe("TeamMembers", () => {
  it("explains itself to someone without team permissions instead of showing an empty table", () => {
    mocks.role = "viewer";
    renderTable();

    expect(screen.getByText(/team management is limited/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("renders one row per explicit member with name, email, and role", () => {
    mocks.members = [
      {
        userId: "44444444-4444-4344-8344-444444444444",
        email: "owner@example.com",
        displayName: "Owner O",
        role: "owner",
        createdAt: "2026-09-17T00:00:00.000Z",
      },
    ];
    renderTable();

    expect(screen.getByText("Owner O")).toBeInTheDocument();
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(screen.getByLabelText(/role for owner o/i)).toBeInTheDocument();
  });

  it("shows pending invitations with a chip and only resend and revoke", () => {
    mocks.invitations = [
      {
        id: "33333333-3333-4333-8333-333333333333",
        email: "invitee@example.com",
        role: "viewer",
        expiresAt: "2026-09-24T00:00:00.000Z",
        createdAt: "2026-09-17T00:00:00.000Z",
        invitedByName: "Owner O",
        isExpired: false,
      },
    ];
    renderTable();

    expect(screen.getByText("Invitation pending")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /resend invitation to invitee@example.com/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /revoke invitation to invitee@example.com/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/role for/i)).not.toBeInTheDocument();
  });

  it("offers adding a member to someone who may invite", () => {
    renderTable();

    fireEvent.click(screen.getByTestId("add-member-entry"));
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/role in this client/i)).toBeInTheDocument();
  });

  it("revokes through a confirmation, so a stray click destroys nothing", async () => {
    mocks.invitations = [
      {
        id: "33333333-3333-4333-8333-333333333333",
        email: "invitee@example.com",
        role: "viewer",
        expiresAt: "2026-09-24T00:00:00.000Z",
        createdAt: "2026-09-17T00:00:00.000Z",
        invitedByName: "Owner O",
        isExpired: false,
      },
    ];
    mocks.revokeOrganizationInvitation.mockResolvedValue(undefined);
    renderTable();

    fireEvent.click(screen.getByRole("button", { name: /revoke invitation to invitee/i }));
    fireEvent.click(screen.getByRole("button", { name: /^revoke$/i }));

    await waitFor(() =>
      expect(mocks.revokeOrganizationInvitation).toHaveBeenCalledWith(
        ORG_ID,
        "33333333-3333-4333-8333-333333333333",
      ),
    );
  });
});
