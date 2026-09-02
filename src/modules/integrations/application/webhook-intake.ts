import { createHash } from "node:crypto";

import { verifyWebhookSignature } from "@/domain/integrations/webhook-signature";

/**
 * What happens to an inbound provider delivery, in the order it must happen.
 *
 * Signature first, always. Everything after it reads fields from the body, and
 * an unverified body is attacker-controlled input — deciding which organization
 * it belongs to before proving who sent it would let anyone address any tenant.
 *
 * Then the allowlist, then the tenant mapping, then the replay guard. A payload
 * that verifies but cannot be placed is quarantined rather than dropped: a
 * genuine provider event that nobody can map is a gap in our own configuration,
 * and discarding it loses state the provider will not send again.
 *
 * Refusals never say why in a way that distinguishes tenants. "This account is
 * not mapped here" and "this account does not exist" are the same answer to a
 * caller, because the difference between them is a fact about another customer.
 */

export type WebhookIntakeOutcome =
  | { outcome: "handshake"; challenge: string }
  | { outcome: "rejected"; status: 401 | 403; reason: string }
  | { outcome: "replayed" }
  | { outcome: "quarantined"; reason: "unknown_account" | "unknown_event"; receiptId: string }
  | {
      outcome: "accepted";
      receiptId: string;
      organizationId: string;
      connectionId: string;
      eventType: string;
    };

export type WebhookAccountMapper = {
  /**
   * The single organization and connection this provider account belongs to.
   * Null when nothing maps, which is a configuration gap, not a tenant hint.
   */
  resolve(input: {
    providerKey: string;
    providerAccountId: string;
  }): Promise<{ organizationId: string; connectionId: string } | null>;
};

export type WebhookReceiptStore = {
  record(input: {
    providerKey: string;
    organizationId: string | null;
    connectionId: string | null;
    eventKey: string;
    bodySha256: string;
    eventType: string;
    providerSentAt: string | null;
    status: string;
    quarantineReason: string | null;
  }): Promise<{ outcome: "recorded"; receiptId: string } | { outcome: "replayed" }>;
};

export type WebhookIntakeDependencies = {
  providerKey: string;
  appSecret: string;
  /** Event types the checked-in contract documents. Anything else is unknown. */
  allowedEventTypes: readonly string[];
  accounts: WebhookAccountMapper;
  receipts: WebhookReceiptStore;
};

/** What a verified body must contain before any of it can be believed. */
export type NormalizedDelivery = {
  providerAccountId: string;
  eventType: string;
  /** The provider's own event id where it supplies one. */
  eventId: string | null;
  sentAt: string | null;
};

export async function intakeWebhook(
  input: {
    /** Exactly the bytes received. A re-serialized object has a different hash. */
    rawBody: string;
    signatureHeader: string | null;
    /** Parsed out of the verified body by a provider-specific normalizer. */
    normalize: (body: unknown) => NormalizedDelivery | null;
  },
  dependencies: WebhookIntakeDependencies,
): Promise<WebhookIntakeOutcome> {
  const signature = verifyWebhookSignature({
    rawBody: input.rawBody,
    headerValue: input.signatureHeader,
    secret: dependencies.appSecret,
  });

  if (!signature.verified) {
    // One status and one wording for every signature failure. Distinguishing
    // "missing" from "mismatch" to a caller tells a forger which half to fix.
    return { outcome: "rejected", status: 401, reason: "signature_invalid" };
  }

  const bodySha256 = createHash("sha256").update(input.rawBody, "utf8").digest("hex");

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.rawBody);
  } catch {
    return { outcome: "rejected", status: 403, reason: "unreadable_body" };
  }

  const delivery = input.normalize(parsed);
  if (!delivery) {
    return { outcome: "rejected", status: 403, reason: "unreadable_body" };
  }

  // A verified delivery always earns a receipt, even an unusable one, so the
  // replay guard covers quarantined events too and an operator can see them.
  const eventKey = delivery.eventId ?? bodySha256;

  if (!dependencies.allowedEventTypes.includes(delivery.eventType)) {
    return quarantine({
      dependencies,
      delivery,
      bodySha256,
      eventKey,
      reason: "unknown_event",
    });
  }

  const mapped = await dependencies.accounts.resolve({
    providerKey: dependencies.providerKey,
    providerAccountId: delivery.providerAccountId,
  });

  if (!mapped) {
    return quarantine({
      dependencies,
      delivery,
      bodySha256,
      eventKey,
      reason: "unknown_account",
    });
  }

  const recorded = await dependencies.receipts.record({
    providerKey: dependencies.providerKey,
    organizationId: mapped.organizationId,
    connectionId: mapped.connectionId,
    eventKey,
    bodySha256,
    eventType: delivery.eventType,
    providerSentAt: delivery.sentAt,
    status: "accepted",
    quarantineReason: null,
  });

  if (recorded.outcome === "replayed") return { outcome: "replayed" };

  return {
    outcome: "accepted",
    receiptId: recorded.receiptId,
    organizationId: mapped.organizationId,
    connectionId: mapped.connectionId,
    eventType: delivery.eventType,
  };
}

async function quarantine(input: {
  dependencies: WebhookIntakeDependencies;
  delivery: NormalizedDelivery;
  bodySha256: string;
  eventKey: string;
  reason: "unknown_account" | "unknown_event";
}): Promise<WebhookIntakeOutcome> {
  const recorded = await input.dependencies.receipts.record({
    providerKey: input.dependencies.providerKey,
    organizationId: null,
    connectionId: null,
    eventKey: input.eventKey,
    bodySha256: input.bodySha256,
    eventType: input.delivery.eventType,
    providerSentAt: input.delivery.sentAt,
    status: `quarantined_${input.reason}`,
    quarantineReason: input.reason,
  });

  if (recorded.outcome === "replayed") return { outcome: "replayed" };
  return { outcome: "quarantined", reason: input.reason, receiptId: recorded.receiptId };
}
