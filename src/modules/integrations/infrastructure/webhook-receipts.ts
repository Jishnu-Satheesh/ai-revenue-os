import "server-only";

import { z } from "zod";

import type {
  NormalizedDelivery,
  WebhookAccountMapper,
  WebhookReceiptStore,
} from "@/modules/integrations/application/webhook-intake";

/**
 * Storage and mapping for inbound provider deliveries.
 *
 * Both run under the service role, because a webhook arrives with no session
 * and the tenant is exactly what has yet to be established. That is also why
 * neither is reachable from a request path: the only caller is the webhook
 * route, which has already proven the payload's signature.
 */

type RpcResult<T> = { data: T | null; error: { message?: string } | null };

export type WebhookPersistence = {
  rpc(
    name: "record_provider_webhook_receipt",
    args: Record<string, unknown>,
  ): Promise<RpcResult<unknown>>;
  from(table: "integration_account_mappings"): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        eq(
          column: string,
          value: string,
        ): PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>;
      };
    };
  };
};

const recordResultSchema = z.union([
  z.object({ outcome: z.literal("replayed") }),
  z.object({ outcome: z.literal("recorded"), receipt_id: z.string().uuid() }),
]);

export function createWebhookReceiptStore(persistence: WebhookPersistence): WebhookReceiptStore {
  return {
    async record(input) {
      const { data, error } = await persistence.rpc("record_provider_webhook_receipt", {
        input_receipt: {
          provider_key: input.providerKey,
          organization_id: input.organizationId,
          connection_id: input.connectionId,
          event_key: input.eventKey,
          body_sha256: input.bodySha256,
          event_type: input.eventType,
          provider_sent_at: input.providerSentAt,
          status: input.status,
          quarantine_reason: input.quarantineReason,
        },
      });
      if (error) throw new Error("The webhook delivery could not be recorded.");

      const parsed = recordResultSchema.safeParse(data);
      if (!parsed.success) throw new Error("The webhook delivery could not be recorded.");

      return parsed.data.outcome === "replayed"
        ? { outcome: "replayed" }
        : { outcome: "recorded", receiptId: parsed.data.receipt_id };
    },
  };
}

const mappingSchema = z.object({
  organization_id: z.string().uuid(),
  connection_id: z.string().uuid(),
});

export function createMetaWebhookAccountMapper(
  persistence: WebhookPersistence,
): WebhookAccountMapper {
  return {
    async resolve({ providerKey, providerAccountId }) {
      const { data, error } = await persistence
        .from("integration_account_mappings")
        .select("organization_id, connection_id")
        .eq("provider_key", providerKey)
        .eq("external_account_id", providerAccountId);
      if (error) throw new Error("The provider account could not be resolved.");

      const rows = (data ?? []).flatMap((row) => {
        const parsed = mappingSchema.safeParse(row);
        return parsed.success ? [parsed.data] : [];
      });

      // Exactly one, or none. Two organizations claiming the same provider
      // account is a configuration fault, and picking one would deliver a
      // customer's event to somebody else.
      if (rows.length !== 1) return null;

      return {
        organizationId: rows[0].organization_id,
        connectionId: rows[0].connection_id,
      };
    },
  };
}

/**
 * Meta's delivery envelope, reduced to what intake needs.
 *
 * Meta batches: one delivery carries an `entry` array, and each entry names the
 * account it concerns. Only the first entry is taken, because a single delivery
 * whose entries span two accounts cannot be attributed to one tenant — and
 * guessing which one is the failure mode this whole path exists to avoid.
 */
const metaEnvelopeSchema = z.object({
  object: z.string(),
  entry: z
    .array(
      z.object({
        id: z.string().min(1),
        time: z.number().int().optional(),
        changes: z.array(z.object({ field: z.string() })).optional(),
      }),
    )
    .min(1),
});

export function normalizeMetaDelivery(body: unknown): NormalizedDelivery | null {
  const parsed = metaEnvelopeSchema.safeParse(body);
  if (!parsed.success) return null;

  const entries = parsed.data.entry;
  const accountIds = new Set(entries.map((entry) => entry.id));
  // A batch spanning accounts has no single tenant, so it is unreadable rather
  // than arbitrarily attributed.
  if (accountIds.size !== 1) return null;

  const entry = entries[0];
  const field = entry.changes?.[0]?.field;

  return {
    providerAccountId: entry.id,
    // Namespaced by the object so `instagram` comments and `page` comments are
    // different events, as the contract records them.
    eventType: field ? `${parsed.data.object}.${field}` : parsed.data.object,
    // Meta does not supply a per-delivery id; intake falls back to a body hash.
    eventId: null,
    sentAt: entry.time ? new Date(entry.time * 1000).toISOString() : null,
  };
}
