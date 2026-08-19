import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createMetaWebhookAccountMapper,
  normalizeMetaDelivery,
} from "@/modules/integrations/infrastructure/webhook-receipts";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "99999999-9999-4999-8999-999999999999";
const CONNECTION = "22222222-2222-4222-8222-222222222222";

function mapper(rows: Record<string, unknown>[]) {
  return createMetaWebhookAccountMapper({
    from: () => ({
      select: () => ({
        eq: () => ({ eq: async () => ({ data: rows, error: null }) }),
      }),
    }),
  } as never);
}

describe("a delivery is attributed to one tenant or to none", () => {
  it("resolves a single mapping", async () => {
    const result = await mapper([{ organization_id: ORG, connection_id: CONNECTION }]).resolve({
      providerKey: "meta_campaign",
      providerAccountId: "178414",
    });

    expect(result).toEqual({ organizationId: ORG, connectionId: CONNECTION });
  });

  it("refuses to choose when two organizations claim the same account", async () => {
    // A configuration fault, and picking either one delivers a customer's
    // event to somebody else.
    const result = await mapper([
      { organization_id: ORG, connection_id: CONNECTION },
      { organization_id: OTHER_ORG, connection_id: CONNECTION },
    ]).resolve({ providerKey: "meta_campaign", providerAccountId: "178414" });

    expect(result).toBeNull();
  });

  it("returns null when nothing maps, rather than throwing", async () => {
    const result = await mapper([]).resolve({
      providerKey: "meta_campaign",
      providerAccountId: "178414",
    });

    expect(result).toBeNull();
  });
});

describe("Meta's envelope is read only where it is unambiguous", () => {
  it("names the event from the object and the changed field", () => {
    expect(
      normalizeMetaDelivery({
        object: "instagram",
        entry: [{ id: "178414", time: 1787000000, changes: [{ field: "mentions" }] }],
      }),
    ).toMatchObject({ providerAccountId: "178414", eventType: "instagram.mentions" });
  });

  it("keeps the object alone when no field changed", () => {
    expect(normalizeMetaDelivery({ object: "instagram", entry: [{ id: "178414" }] })).toMatchObject(
      { eventType: "instagram" },
    );
  });

  it("refuses a batch spanning two accounts rather than picking one", () => {
    // One delivery, two tenants: there is no single right answer, and guessing
    // is exactly the failure this path exists to prevent.
    expect(
      normalizeMetaDelivery({
        object: "instagram",
        entry: [{ id: "178414" }, { id: "999999" }],
      }),
    ).toBeNull();
  });

  it("accepts a batch of several entries for the same account", () => {
    expect(
      normalizeMetaDelivery({
        object: "instagram",
        entry: [
          { id: "178414", changes: [{ field: "mentions" }] },
          { id: "178414", changes: [{ field: "mentions" }] },
        ],
      }),
    ).toMatchObject({ providerAccountId: "178414" });
  });

  it("refuses an envelope that is not Meta's shape", () => {
    expect(normalizeMetaDelivery({ nonsense: true })).toBeNull();
    expect(normalizeMetaDelivery({ object: "instagram", entry: [] })).toBeNull();
    expect(normalizeMetaDelivery(null)).toBeNull();
  });

  it("converts the provider's epoch seconds to a UTC instant", () => {
    expect(
      normalizeMetaDelivery({ object: "instagram", entry: [{ id: "1", time: 1787000000 }] })
        ?.sentAt,
    ).toBe(new Date(1787000000 * 1000).toISOString());
  });
});
