import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveLandingPath: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/modules/organizations/application/landing", () => ({
  resolveLandingPath: mocks.resolveLandingPath,
}));

import HomePage from "@/app/page";

const organizationId = "11111111-1111-4111-8111-111111111111";

describe("root landing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects to whatever the resolver decides", async () => {
    mocks.resolveLandingPath.mockResolvedValue("/organizations/new");
    await expect(HomePage()).rejects.toThrow("REDIRECT:/organizations/new");
  });

  // The root holds no rules of its own; every landing question is answered in
  // one place so the callback, the archive action, and this route agree.
  it("does not hardcode a destination of its own", async () => {
    mocks.resolveLandingPath.mockResolvedValue(`/organizations/${organizationId}/overview`);
    await expect(HomePage()).rejects.toThrow(`REDIRECT:/organizations/${organizationId}/overview`);
    expect(mocks.resolveLandingPath).toHaveBeenCalledOnce();
  });
});
