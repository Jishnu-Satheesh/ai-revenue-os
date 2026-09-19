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
    renderSidebar(`/organizations/${organizationId}/channels`);

    const labels = screen
      .getAllByTestId("workspace-entry")
      .map((entry) => entry.textContent?.replace("Soon", "").trim());
    expect(labels).toEqual([
      "Overview",
      "Growth Intelligence",
      "Campaigns",
      "Business Memory",
      "Channels",
      "Integration Hub",
      "Guided onboarding",
      "Agents",
      "Executions",
      "Settings",
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
    renderSidebar(`/organizations/${organizationId}/channels`);

    expect(screen.getByRole("link", { name: /^Channels$/ })).toHaveAttribute("data-active", "true");
    expect(screen.getByRole("link", { name: /Campaigns/ })).toHaveAttribute(
      "href",
      `/organizations/${organizationId}/campaigns`,
    );
    // Growth Intelligence is built now, so it is a real organization-scoped link.
    expect(screen.getByRole("link", { name: /Growth Intelligence/ })).toHaveAttribute(
      "href",
      `/organizations/${organizationId}/growth-intelligence`,
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

  it("keeps Campaigns a link of its own while nesting its sections under it", () => {
    renderSidebar(`/organizations/${organizationId}/campaigns`);

    // Adding a menu must not cost a destination: the row still goes where it
    // always went, and the chevron is a separate control.
    expect(screen.getByRole("link", { name: /^Campaigns$/ })).toHaveAttribute(
      "href",
      `/organizations/${organizationId}/campaigns`,
    );
    expect(screen.getByRole("button", { name: "Campaigns sections" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    const children = screen
      .getAllByTestId("workspace-child-entry")
      .map((entry) => entry.textContent?.trim());
    expect(children).toEqual(["Overview", "Asset Library", "Research settings"]);
    expect(screen.getByRole("link", { name: "Asset Library" })).toHaveAttribute(
      "href",
      `/organizations/${organizationId}/assets`,
    );
    // The money fence on research sits beside the work it governs, because the
    // question it answers is asked from here.
    expect(screen.getByRole("link", { name: "Research settings" })).toHaveAttribute(
      "href",
      `/organizations/${organizationId}/campaign-research`,
    );
  });

  it("keeps the group shut until you are inside it", () => {
    renderSidebar(`/organizations/${organizationId}/channels`);

    expect(screen.getByRole("button", { name: "Campaigns sections" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("treats the Asset Library as part of Campaigns", () => {
    renderSidebar(`/organizations/${organizationId}/assets`);

    // The parent stays lit for a child's page, or Campaigns would read as
    // unvisited while its own sub-item is highlighted.
    expect(screen.getByRole("link", { name: /^Campaigns$/ })).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByRole("link", { name: "Asset Library" })).toHaveAttribute(
      "data-active",
      "true",
    );
    // Scoped to the sub-menu: "Overview" also names the workspace's own
    // top-level entry, which is a different destination entirely.
    const overview = screen
      .getAllByTestId("workspace-child-entry")
      .find((entry) => entry.textContent?.trim() === "Overview");
    expect(overview).toHaveAttribute("data-active", "false");
  });

  it("stops lighting the campaigns Overview once a single campaign is open", () => {
    renderSidebar(`/organizations/${organizationId}/campaigns/c1000000-0000-4000-8000-000000000001`);

    // Overview is the portfolio exactly, not everything beneath it.
    const overview = screen
      .getAllByTestId("workspace-child-entry")
      .find((entry) => entry.textContent?.trim() === "Overview");
    expect(overview).toHaveAttribute("data-active", "false");
    // The parent still shows you are inside Campaigns.
    expect(screen.getByRole("link", { name: /^Campaigns$/ })).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  it("hides the workspace group but keeps the switcher off an organization route", () => {
    renderSidebar("/organizations/new");

    expect(screen.queryAllByTestId("workspace-entry")).toHaveLength(0);
    // Without the switcher the create page would be a dead end.
    expect(screen.getByTestId("switcher")).toBeInTheDocument();
  });
});
