// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const currentId = "11111111-1111-4111-8111-111111111111";
const nextId = "22222222-2222-4222-8222-222222222222";
const mocks = vi.hoisted(() => ({ pathname: "", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push }),
}));

import { OrganizationSwitcher } from "@/components/layout/organization-switcher";
import { SidebarProvider } from "@/components/ui/sidebar";

function renderSwitcher() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SidebarProvider>
        <OrganizationSwitcher />
      </SidebarProvider>
    </QueryClientProvider>,
  );
}

/** Radix opens on pointerdown or a key, never a bare click. Enter also proves
 * the switcher stays reachable without a mouse. */
function openMenu(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: "Enter" });
}

function respondWith(organizations: unknown) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ organizations }), { status: 200 }),
  );
}

afterEach(() => cleanup());

describe("OrganizationSwitcher", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.push.mockReset();
    mocks.pathname = `/organizations/${currentId}/memory`;
  });

  it("switches to the target organization's Overview", async () => {
    respondWith([
      { id: currentId, name: "North Star Cafe", slug: "north-star-cafe" },
      { id: nextId, name: "Harbor Bakery", slug: "harbor-bakery" },
    ]);
    renderSwitcher();

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith("/api/organizations"));
    openMenu(await screen.findByRole("button", { name: /North Star Cafe/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Harbor Bakery/ }));

    // Never the equivalent page: the target organization may hold no economics
    // data and may not grant the same features.
    expect(mocks.push).toHaveBeenCalledWith(`/organizations/${nextId}/overview`);
  });

  it("offers organization creation from the menu", async () => {
    respondWith([{ id: currentId, name: "North Star Cafe", slug: "north-star-cafe" }]);
    renderSwitcher();

    openMenu(await screen.findByRole("button", { name: /North Star Cafe/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Create organization/ }));

    expect(mocks.push).toHaveBeenCalledWith("/organizations/new");
  });

  it("renders on a scope-less route and reports an empty list", async () => {
    mocks.pathname = "/organizations/new";
    respondWith([]);
    renderSwitcher();

    openMenu(await screen.findByRole("button", { name: /Select organization/ }));
    expect(await screen.findByText(/No organizations yet/i)).toBeInTheDocument();
  });

  it("keeps read failures generic", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
    renderSwitcher();

    openMenu(await screen.findByRole("button", { name: /Select organization/ }));
    expect(await screen.findByText(/organizations could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/500/)).not.toBeInTheDocument();
  });
});

describe("OrganizationSwitcher, the organization's own mark", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.pathname = `/organizations/${currentId}/memory`;
  });

  function respondWithLogo(logo: { url: string; label: string } | null) {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).endsWith("/brand")) {
        return new Response(
          JSON.stringify({ guidelines: { palette: {}, rules: [], restrictedTerms: [] }, logos: [], displayLogo: logo }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          organizations: [{ id: currentId, name: "Al Noor Kitchen", slug: "al-noor" }],
        }),
        { status: 200 },
      );
    });
  }

  it("shows the organization's own mark when one is set", async () => {
    respondWithLogo({ url: "https://signed.example/logo.png", label: "Al Noor wordmark" });
    renderSwitcher();

    const mark = await screen.findByRole("img", { name: "Al Noor wordmark" });
    expect(mark).toHaveAttribute("src", "https://signed.example/logo.png");
  });

  it("shows the platform's own glyph when no logo is set", async () => {
    // Never a placeholder that looks like a brand nobody supplied.
    respondWithLogo(null);
    renderSwitcher();

    await screen.findByText("Al Noor Kitchen");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("falls back to the glyph rather than breaking the sidebar when the logo cannot be read", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).endsWith("/brand")) return new Response("{}", { status: 500 });
      return new Response(
        JSON.stringify({
          organizations: [{ id: currentId, name: "Al Noor Kitchen", slug: "al-noor" }],
        }),
        { status: 200 },
      );
    });
    renderSwitcher();

    // A signing failure costs the logo and nothing else.
    await screen.findByText("Al Noor Kitchen");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
