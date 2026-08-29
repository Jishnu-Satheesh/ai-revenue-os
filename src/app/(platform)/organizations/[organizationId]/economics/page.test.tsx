import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import ChannelEconomicsPage from "@/app/(platform)/organizations/[organizationId]/economics/page";

const ORGANIZATION = "44444444-4444-4444-8444-444444444444";

describe("channel economics redirect", () => {
  it("redirects to the merged channels page", async () => {
    await expect(
      ChannelEconomicsPage({ params: Promise.resolve({ organizationId: ORGANIZATION }) }),
    ).rejects.toThrow(`REDIRECT:/organizations/${ORGANIZATION}/channels`);
    expect(mocks.redirect).toHaveBeenCalledWith(`/organizations/${ORGANIZATION}/channels`);
  });
});
