// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: undefined as unknown, isPending: false }));

vi.mock("@/components/accounts/account-session", () => ({
  useAccountSession: () => ({ data: mocks.session, isPending: mocks.isPending }),
}));

import { SidebarIdentity } from "@/components/accounts/sidebar-identity";
import { SidebarProvider } from "@/components/ui/sidebar";

function renderIdentity() {
  return render(
    <SidebarProvider>
      <SidebarIdentity />
    </SidebarProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.isPending = false;
});

describe("SidebarIdentity", () => {
  /**
   * This footer used to render "Agency operator / Workspace admin" to everyone,
   * regardless of who was signed in. Harmless with one user; a lie about
   * identity the moment a second person joins.
   */
  it("names the signed-in person and their agency", () => {
    mocks.session = {
      account: { id: "a", name: "Super-admin agency", slug: "super-admin-agency" },
      membership: { accountRole: "owner" },
      profile: { id: "u", email: "jishnu@example.com", displayName: "Jishnu", avatarUrl: null },
      permissions: [],
    };

    renderIdentity();

    expect(screen.getByText("Jishnu")).toBeInTheDocument();
    expect(screen.getByText(/agency owner · super-admin agency/i)).toBeInTheDocument();
  });

  it("distinguishes a member from an owner", () => {
    mocks.session = {
      account: { id: "a", name: "Super-admin agency", slug: "super-admin-agency" },
      membership: { accountRole: "member" },
      profile: { id: "u", email: "sarah@example.com", displayName: "Sarah", avatarUrl: null },
      permissions: [],
    };

    renderIdentity();

    expect(screen.getByText(/agency member/i)).toBeInTheDocument();
  });

  it("falls back to the email address when no display name exists", () => {
    mocks.session = {
      account: { id: "a", name: "Super-admin agency", slug: "super-admin-agency" },
      membership: { accountRole: "member" },
      profile: { id: "u", email: "sarah@example.com", displayName: null, avatarUrl: null },
      permissions: [],
    };

    renderIdentity();

    expect(screen.getByText("sarah@example.com")).toBeInTheDocument();
  });

  it("shows nothing rather than a placeholder while the account is unknown", () => {
    mocks.session = undefined;
    renderIdentity();
    expect(screen.queryByTestId("sidebar-identity")).not.toBeInTheDocument();
  });

  it("reserves the row while loading, so the footer does not jump", () => {
    mocks.session = undefined;
    mocks.isPending = true;
    const { container } = renderIdentity();
    expect(container.querySelector('[data-slot="skeleton"]')).toBeTruthy();
  });
});
