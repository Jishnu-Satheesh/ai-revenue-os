// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  resolveLandingPath: vi.fn(),
  getUser: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock("@/modules/organizations/application/landing", () => ({
  resolveLandingPath: mocks.resolveLandingPath,
}));

import HomePage from "@/app/page";
import { hero } from "@/components/marketing/content";

const organizationId = "11111111-1111-4111-8111-111111111111";

afterEach(cleanup);

describe("root landing split", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects a signed-in user to whatever the resolver decides", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });
    mocks.resolveLandingPath.mockResolvedValue(`/organizations/${organizationId}/overview`);

    await expect(HomePage()).rejects.toThrow(`REDIRECT:/organizations/${organizationId}/overview`);
    expect(mocks.resolveLandingPath).toHaveBeenCalledOnce();
  });

  it("renders the public landing page when no session exists", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const view = await HomePage();
    render(await view);
    expect(screen.getByText(hero.headline)).toBeTruthy();
    expect(mocks.resolveLandingPath).not.toHaveBeenCalled();
  });

  it("falls back to the public landing page when the auth probe fails", async () => {
    mocks.getUser.mockRejectedValue(new Error("network down"));

    render(await HomePage());
    await waitFor(() => expect(screen.getByText(hero.headline)).toBeTruthy());
    expect(mocks.resolveLandingPath).not.toHaveBeenCalled();
  });

  it("does not hardcode a destination of its own", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-2" } }, error: null });
    mocks.resolveLandingPath.mockResolvedValue("/organizations/new");

    await expect(HomePage()).rejects.toThrow("REDIRECT:/organizations/new");
  });
});
