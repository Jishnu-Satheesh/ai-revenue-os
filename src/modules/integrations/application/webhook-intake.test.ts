import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { intakeWebhook } from "@/modules/integrations/application/webhook-intake";

const SECRET = "app-secret";
const ORG = "11111111-1111-4111-8111-111111111111";
const CONNECTION = "22222222-2222-4222-8222-222222222222";

function body(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    object: "instagram",
    entry: [{ id: "17841400000000000", time: 1787000000, changes: [] }],
    ...overrides,
  });
}

function sign(raw: string, secret = SECRET) {
  return `sha256=${createHmac("sha256", secret).update(raw, "utf8").digest("hex")}`;
}

const normalize = (parsed: unknown) => {
  const entry = (parsed as { entry?: { id?: string; time?: number }[] })?.entry?.[0];
  if (!entry?.id) return null;
  return {
    providerAccountId: entry.id,
    eventType: "instagram.mentions",
    eventId: null,
    sentAt: entry.time ? new Date(entry.time * 1000).toISOString() : null,
  };
};

function deps(overrides: Record<string, unknown> = {}) {
  return {
    providerKey: "meta_campaign",
    appSecret: SECRET,
    allowedEventTypes: ["instagram.mentions"],
    accounts: {
      resolve: vi.fn(async () => ({ organizationId: ORG, connectionId: CONNECTION })),
    },
    receipts: {
      record: vi.fn(async () => ({
        outcome: "recorded" as const,
        receiptId: "33333333-3333-4333-8333-333333333333",
      })),
    },
    ...overrides,
  } as never;
}

describe("nothing is read before the signature is proven", () => {
  it("rejects an unsigned delivery without mapping it to anyone", async () => {
    const dependencies = deps();
    const result = await intakeWebhook(
      { rawBody: body(), signatureHeader: null, normalize },
      dependencies,
    );

    expect(result).toEqual({ outcome: "rejected", status: 401, reason: "signature_invalid" });
    // The mapper must never run on an unverified body: doing so would decide
    // whose event this is on the strength of a claim anyone could make.
    expect(
      (dependencies as never as { accounts: { resolve: ReturnType<typeof vi.fn> } }).accounts
        .resolve,
    ).not.toHaveBeenCalled();
  });

  it("gives one answer for every signature failure", async () => {
    const raw = body();
    const forged = await intakeWebhook(
      { rawBody: raw, signatureHeader: sign(raw, "wrong"), normalize },
      deps(),
    );
    const missing = await intakeWebhook({ rawBody: raw, signatureHeader: null, normalize }, deps());

    // Telling a forger which half to fix is a favour they should not get.
    expect(forged).toEqual(missing);
  });

  it("verifies against the exact bytes received, not a re-serialized object", async () => {
    const raw = body();
    // Same data, different bytes: key order and whitespace change the hash.
    const reserialized = JSON.stringify(JSON.parse(raw), null, 2);

    const result = await intakeWebhook(
      { rawBody: reserialized, signatureHeader: sign(raw), normalize },
      deps(),
    );

    expect(result).toMatchObject({ outcome: "rejected", status: 401 });
  });
});

describe("a verified delivery that cannot be placed is kept, not dropped", () => {
  it("quarantines an account nothing maps to", async () => {
    const raw = body();
    const result = await intakeWebhook(
      { rawBody: raw, signatureHeader: sign(raw), normalize },
      deps({ accounts: { resolve: vi.fn(async () => null) } }),
    );

    expect(result).toMatchObject({ outcome: "quarantined", reason: "unknown_account" });
  });

  it("quarantines an event type the contract does not document", async () => {
    const raw = body();
    const result = await intakeWebhook(
      { rawBody: raw, signatureHeader: sign(raw), normalize },
      deps({ allowedEventTypes: ["instagram.comments"] }),
    );

    expect(result).toMatchObject({ outcome: "quarantined", reason: "unknown_event" });
  });

  it("checks the event allowlist before touching the tenant mapping", async () => {
    const dependencies = deps({ allowedEventTypes: [] });
    const raw = body();
    await intakeWebhook({ rawBody: raw, signatureHeader: sign(raw), normalize }, dependencies);

    // An undocumented event is unusable whoever sent it, so there is no reason
    // to look up a tenant for it.
    expect(
      (dependencies as never as { accounts: { resolve: ReturnType<typeof vi.fn> } }).accounts
        .resolve,
    ).not.toHaveBeenCalled();
  });

  it("records a quarantined delivery with no tenant attached", async () => {
    const dependencies = deps({ accounts: { resolve: vi.fn(async () => null) } });
    const raw = body();
    await intakeWebhook({ rawBody: raw, signatureHeader: sign(raw), normalize }, dependencies);

    const record = (dependencies as never as { receipts: { record: ReturnType<typeof vi.fn> } })
      .receipts.record;
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: null, connectionId: null }),
    );
  });
});

describe("a repeated delivery does the work once", () => {
  it("reports a replay rather than accepting it twice", async () => {
    const raw = body();
    const result = await intakeWebhook(
      { rawBody: raw, signatureHeader: sign(raw), normalize },
      deps({ receipts: { record: vi.fn(async () => ({ outcome: "replayed" as const })) } }),
    );

    expect(result).toEqual({ outcome: "replayed" });
  });

  it("falls back to a body digest when the provider supplies no event id", async () => {
    const dependencies = deps();
    const raw = body();
    await intakeWebhook({ rawBody: raw, signatureHeader: sign(raw), normalize }, dependencies);

    const record = (dependencies as never as { receipts: { record: ReturnType<typeof vi.fn> } })
      .receipts.record;
    const call = record.mock.calls[0][0] as { eventKey: string; bodySha256: string };
    expect(call.eventKey).toBe(call.bodySha256);
    expect(call.eventKey).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("an accepted delivery names exactly one tenant", () => {
  it("returns the organization and connection it mapped to", async () => {
    const raw = body();
    const result = await intakeWebhook(
      { rawBody: raw, signatureHeader: sign(raw), normalize },
      deps(),
    );

    expect(result).toMatchObject({
      outcome: "accepted",
      organizationId: ORG,
      connectionId: CONNECTION,
      eventType: "instagram.mentions",
    });
  });

  it("refuses a verified body it cannot read rather than guessing", async () => {
    const raw = JSON.stringify({ nonsense: true });
    const result = await intakeWebhook(
      { rawBody: raw, signatureHeader: sign(raw), normalize },
      deps(),
    );

    expect(result).toMatchObject({ outcome: "rejected", status: 403, reason: "unreadable_body" });
  });
});
