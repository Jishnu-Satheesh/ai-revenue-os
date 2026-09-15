import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createMetaOrganicResolver } from "@/modules/campaigns/infrastructure/meta-adapter-resolver";
import type { PlannedPublish } from "@/modules/campaigns/infrastructure/dispatch-planner";

const ORGANIZATION_ID = "fb450000-0000-4000-8000-000000000101";
const OTHER_ORGANIZATION_ID = "fb450000-0000-4000-8000-000000000102";
const ACTION_RUN_ID = "fb450000-0000-4000-8000-000000000201";

const REQUEST: PlannedPublish = {
  igUserId: "17841400000000000",
  imageUrl: "https://example.test/signed.jpg",
  caption: "A caption that was reviewed.",
  placement: "feed_image",
  mimeType: "image/jpeg",
};

function sensitive(value: string) {
  return {
    get value() {
      return value;
    },
    toJSON(): never {
      throw new Error("A credential must never be serialised.");
    },
  };
}

function resolver(
  overrides: Partial<Parameters<typeof createMetaOrganicResolver>[0]> = {},
) {
  return createMetaOrganicResolver({
    // A contract that is inside its review window.
    readContract: () => ({ apiVersion: "v24.0" }) as never,
    connections: {
      read: async () => ({
        connectionId: "fb450000-0000-4000-8000-000000000301",
        credentialHandle: { reference: "fb450000-0000-4000-8000-000000000401" },
      }),
    },
    credentials: { resolve: async () => sensitive("token-for-this-tenant") },
    requests: new Map([[ACTION_RUN_ID, REQUEST]]),
    correlationId: "fb450000-0000-4000-8000-000000000501",
    createClient: () => ({}) as never,
    ...overrides,
  });
}

describe("Meta organic adapter resolver", () => {
  it("offers only the organic tool keys, never a paid one", () => {
    const { resolver: subject, status } = resolver();

    expect(status).toBe("ready");
    // Paid is held deliberately. An ads dispatch has to keep refusing by name
    // until a connection is qualified for it.
    expect([...subject.supportedToolKeys()].sort()).toEqual([
      "meta.publish_image",
      "meta.publish_story",
    ]);
  });

  it("resolves an adapter for an organization with a granted connection", async () => {
    const { resolver: subject } = resolver();

    const adapter = await subject.resolve({
      organizationId: ORGANIZATION_ID,
      toolKey: "meta.publish_image",
    });

    expect(adapter?.toolKey).toBe("meta.publish_image");
  });

  it("asks for the capability the planner actually emitted", async () => {
    const read = vi.fn().mockResolvedValue({
      connectionId: "c",
      credentialHandle: { reference: "r" },
    });
    const { resolver: subject } = resolver({ connections: { read } });

    await subject.resolve({ organizationId: ORGANIZATION_ID, toolKey: "meta.publish_image" });

    // The grant is per capability, not per provider. Reading a connection
    // without checking what it is allowed to do would publish on a connection
    // granted only for reading.
    expect(read).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      capabilityKey: "meta.instagram.publish",
    });
  });

  it("returns nothing when the organization has no granted connection", async () => {
    const { resolver: subject } = resolver({ connections: { read: async () => null } });

    expect(
      await subject.resolve({ organizationId: ORGANIZATION_ID, toolKey: "meta.publish_image" }),
    ).toBeNull();
  });

  it("resolves each organization's own credential", async () => {
    const resolve = vi.fn().mockResolvedValue(sensitive("token"));
    const { resolver: subject } = resolver({
      connections: {
        read: async ({ organizationId }) => ({
          connectionId: `connection-${organizationId}`,
          credentialHandle: { reference: `handle-${organizationId}` },
        }),
      },
      credentials: { resolve },
    });

    await subject.resolve({ organizationId: ORGANIZATION_ID, toolKey: "meta.publish_image" });
    await subject.resolve({ organizationId: OTHER_ORGANIZATION_ID, toolKey: "meta.publish_image" });

    // The whole reason this is a resolver and not a shared adapter: one token
    // reused across tenants would publish everyone's work to one account.
    expect(resolve.mock.calls[0]?.[0]).toMatchObject({
      organizationId: ORGANIZATION_ID,
      handle: { reference: `handle-${ORGANIZATION_ID}` },
    });
    expect(resolve.mock.calls[1]?.[0]).toMatchObject({
      organizationId: OTHER_ORGANIZATION_ID,
      handle: { reference: `handle-${OTHER_ORGANIZATION_ID}` },
    });
  });

  it("returns nothing when the credential cannot be resolved", async () => {
    const { resolver: subject } = resolver({
      credentials: {
        resolve: async () => {
          throw new Error("NOT_FOUND");
        },
      },
    });

    // A revoked or missing secret is a disconnected organization, not a crash
    // that abandons every other tenant in the sweep.
    expect(
      await subject.resolve({ organizationId: ORGANIZATION_ID, toolKey: "meta.publish_image" }),
    ).toBeNull();
  });

  it("supports nothing at all when the provider contract is out of review", () => {
    const { resolver: subject, status, reason } = resolver({
      readContract: () => {
        throw new Error("meta provider contract expired");
      },
    });

    // The contract is a review gate, not decoration. An expired one means
    // nobody has confirmed recently that these endpoints still work as
    // recorded, so the deployment performs no Meta call at all.
    expect(status).toBe("contract_unusable");
    expect(reason).toContain("expired");
    expect(subject.supportedToolKeys()).toEqual([]);
  });

  it("never reaches a credential while the contract is out of review", async () => {
    const credentialResolve = vi.fn();
    const { resolver: subject } = resolver({
      readContract: () => {
        throw new Error("expired");
      },
      credentials: { resolve: credentialResolve },
    });

    expect(
      await subject.resolve({ organizationId: ORGANIZATION_ID, toolKey: "meta.publish_image" }),
    ).toBeNull();
    expect(credentialResolve).not.toHaveBeenCalled();
  });

  it("refuses an action whose request the planner never built", async () => {
    const { resolver: subject } = resolver({ requests: new Map() });
    const adapter = await subject.resolve({
      organizationId: ORGANIZATION_ID,
      toolKey: "meta.publish_image",
    });

    // Publishing an action the planner could not describe would mean sending
    // something nobody reviewed.
    await expect(
      adapter?.invoke({
        organizationId: ORGANIZATION_ID,
        actionRunId: ACTION_RUN_ID,
        idempotencyKey: "k",
        reservation: { amountMinor: null, currency: null },
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/request/i);
  });
});
