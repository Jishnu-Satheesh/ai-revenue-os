// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const organizationId = "11111111-1111-4111-8111-111111111111";
const mocks = vi.hoisted(() => ({ pathname: "" }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/components/layout/organization-switcher", () => ({
  OrganizationSwitcher: () => <div data-testid="switcher" />,
}));
// Both read the account through react-query, which this suite deliberately does
// not stand up: their own suites cover them.
vi.mock("@/components/accounts/invite-member-dialog", () => ({
  InviteMemberDialog: () => <div data-testid="invite-member-entry" />,
}));
vi.mock("@/components/accounts/sidebar-identity", () => ({
  SidebarIdentity: () => <div data-testid="sidebar-identity" />,
}));

import { Sidebar } from "@/components/layout/sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";

function renderSidebar(pathname: string) {
  mocks.pathname = pathname;
  return render(
    <SidebarProvider>
      <Sidebar />
    </SidebarProvider>,
  );
}

describe("Sidebar", () => {
  afterEach(() => cleanup());

  it("renders the workspace entries in order for an organization route", () => {
    renderSidebar(`/organizations/${organizationId}/economics`);

    const labels = screen
      .getAllByTestId("workspace-entry")
      .map((entry) => entry.textContent?.replace("Soon", "").trim());
    expect(labels).toEqual([
      "Overview",
      "Opportunities",
      "Campaigns",
      "Business Memory",
      "Channels",
      "Channel economics",
      "Integration Hub",
      "Guided onboarding",
      "Agents",
      "Executions",
    ]);
    expect(screen.getByRole("link", { name: /Overview/ })).toHaveAttribute(
      "href",
      `/organizations/${organizationId}/overview`,
    );
    expect(screen.getByRole("link", { name: /Business Memory/ })).toHaveAttribute(
      "href",
      `/organizations/${organizationId}/memory`,
    );
    expect(screen.getByRole("link", { name: /^Channels$/ })).toHaveAttribute(
      "href",
      `/organizations/${organizationId}/channels`,
    );
  });

  it("marks the active entry and never activates or links an unbuilt one", () => {
    renderSidebar(`/organizations/${organizationId}/economics`);

    expect(screen.getByRole("link", { name: /Channel economics/ })).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByRole("link", { name: /Campaigns/ })).toHaveAttribute(
      "href",
      `/organizations/${organizationId}/campaigns`,
    );
    // Opportunities is built now, so it is a real organization-scoped link.
    expect(screen.getByRole("link", { name: /Opportunities/ })).toHaveAttribute(
      "href",
      `/organizations/${organizationId}/opportunities`,
    );
    // An unbuilt destination must not be an anchor: the previous sidebar linked
    // these to routes that do not exist, so every click was a 404.
    for (const label of ["Agents", "Executions"]) {
      const entry = screen.getByText(label).closest("a, button");
      expect(entry?.tagName).toBe("BUTTON");
      expect(entry).toBeDisabled();
      expect(entry).not.toHaveAttribute("data-active", "true");
    }
    expect(screen.getAllByText("Soon")).toHaveLength(2);
  });

  it("hides the workspace group but keeps the switcher off an organization route", () => {
    renderSidebar("/organizations/new");

    expect(screen.queryAllByTestId("workspace-entry")).toHaveLength(0);
    // Without the switcher the create page would be a dead end.
    expect(screen.getByTestId("switcher")).toBeInTheDocument();
  });
});
