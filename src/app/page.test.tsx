// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";

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

const organizationId = "11111111-1111-4111-8111-111111111111";

afterEach(cleanup);

describe("root app entry", () => {
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

  it("sends a signed-out visit through the resolver to login", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    mocks.resolveLandingPath.mockResolvedValue("/login");

    await expect(HomePage()).rejects.toThrow("REDIRECT:/login");
    expect(mocks.resolveLandingPath).toHaveBeenCalledOnce();
  });

  it("falls back to login when the resolver fails", async () => {
    mocks.getUser.mockRejectedValue(new Error("network down"));
    mocks.resolveLandingPath.mockRejectedValue(new Error("network down"));

    await expect(HomePage()).rejects.toThrow("REDIRECT:/login");
  });

  it("does not hardcode a destination of its own", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-2" } }, error: null });
    mocks.resolveLandingPath.mockResolvedValue("/organizations/new");

    await expect(HomePage()).rejects.toThrow("REDIRECT:/organizations/new");
  });
});
