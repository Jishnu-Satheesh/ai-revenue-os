import { describe, expect, it, vi } from "vitest";

import {
  readChannelReadiness,
  type ReadinessRpcSource,
} from "@/modules/campaigns/infrastructure/readiness-reader";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "d1000000-0000-4000-8000-000000000001";
const input = { organizationId: ORGANIZATION_ID, bundleVersionId: VERSION_ID };

function source(data: unknown, error: unknown = null) {
  const rpc = vi.fn(async () => ({ data, error }));
  return { source: { rpc } as unknown as ReadinessRpcSource, rpc };
}

const blockedInstagram = {
  channel: "instagram",
  capabilityKey: "publish_instagram",
  actionCount: 3,
  anyRequired: true,
  firstScheduledFor: "2026-09-01T14:00:00+00:00",
  accountLabel: null,
  restrictionCodes: [],
  verdict: "blocked",
  codes: ["capability_not_granted"],
};

describe("reading channel readiness", () => {
  it("asks about the version with the capability key each channel actually needs", async () => {
    const { source: rpcSource, rpc } = source([blockedInstagram]);

    await readChannelReadiness(rpcSource, input);

    expect(rpc).toHaveBeenCalledWith("campaign_version_channel_readiness", {
      target_organization_id: ORGANIZATION_ID,
      target_bundle_version_id: VERSION_ID,
      input_channel_capabilities: {
        instagram: "publish_instagram",
        facebook: "publish_facebook",
      },
    });
  });

  it("returns the verdict and the stable codes behind it", async () => {
    const { source: rpcSource } = source([blockedInstagram]);

    const readiness = await readChannelReadiness(rpcSource, input);

    expect(readiness).toEqual([blockedInstagram]);
  });

  it("reports no channels as an empty list, which is not the same as unknown", async () => {
    const { source: rpcSource } = source([]);

    await expect(readChannelReadiness(rpcSource, input)).resolves.toEqual([]);
  });
});

describe("an unanswerable question never becomes a green light", () => {
  it("returns null when the database refuses", async () => {
    const { source: rpcSource } = source(null, { code: "42501" });

    await expect(readChannelReadiness(rpcSource, input)).resolves.toBeNull();
  });

  it("returns null rather than guessing at a row it does not recognize", async () => {
    const { source: rpcSource } = source([{ channel: "instagram", verdict: "probably_fine" }]);

    await expect(readChannelReadiness(rpcSource, input)).resolves.toBeNull();
  });

  it("returns null when the answer is not a list at all", async () => {
    const { source: rpcSource } = source({ instagram: "ready" });

    await expect(readChannelReadiness(rpcSource, input)).resolves.toBeNull();
  });
});
