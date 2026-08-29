import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import ChannelEconomicsChannelPage from "@/app/(platform)/organizations/[organizationId]/economics/channels/[channelId]/page";

const ORGANIZATION = "44444444-4444-4444-8444-444444444444";
const CHANNEL = "55555555-5555-4555-8555-555555555555";

describe("channel economics channel redirect", () => {
  it("redirects to the merged channel detail page", async () => {
    await expect(
      ChannelEconomicsChannelPage({
        params: Promise.resolve({ organizationId: ORGANIZATION, channelId: CHANNEL }),
      }),
    ).rejects.toThrow(`REDIRECT:/organizations/${ORGANIZATION}/channels/${CHANNEL}`);
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/organizations/${ORGANIZATION}/channels/${CHANNEL}`,
    );
  });
});
