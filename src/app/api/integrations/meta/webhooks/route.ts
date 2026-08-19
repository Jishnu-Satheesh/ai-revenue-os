import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { evaluateWebhookHandshake } from "@/domain/integrations/webhook-signature";
import { intakeWebhook } from "@/modules/integrations/application/webhook-intake";
import {
  createMetaWebhookAccountMapper,
  createWebhookReceiptStore,
  normalizeMetaDelivery,
} from "@/modules/integrations/infrastructure/webhook-receipts";
import { createCampaignWorkerServiceClient } from "@/lib/supabase/service";
import { getMetaCampaignProviderContract } from "@/modules/integrations/providers/meta/contract";

/**
 * Meta's inbound webhook.
 *
 * Public by necessity — Meta cannot authenticate to us — so the signature is
 * the only thing standing between this route and the rest of the platform.
 * Nothing here reads a business field before that signature is proven.
 *
 * A refusal never distinguishes tenants. "No account maps here" and "no such
 * account" look identical from outside, because the difference between them is
 * a fact about somebody else's customer.
 */

export const dynamic = "force-dynamic";

/** The subscription handshake. Meta echoes a challenge to confirm the URL. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const expected = env.META_WEBHOOK_VERIFY_TOKEN;

  if (!expected) {
    // Unconfigured is not a reason to accept. Echoing without a token to check
    // would let anyone who finds the URL confirm the subscription for us.
    return new NextResponse("Not found", { status: 404 });
  }

  const result = evaluateWebhookHandshake({
    mode: url.searchParams.get("hub.mode"),
    challenge: url.searchParams.get("hub.challenge"),
    verifyToken: url.searchParams.get("hub.verify_token"),
    expectedToken: expected,
  });

  if (result.outcome === "refused") {
    logger.warn("integration.webhook_handshake_refused", { refusalCode: result.reason });
    return new NextResponse("Forbidden", { status: 403 });
  }

  // Plain text, exactly the challenge. Meta compares it byte for byte.
  return new NextResponse(result.challenge, {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}

export async function POST(request: Request) {
  const appSecret = env.META_APP_SECRET;
  if (!appSecret) {
    // With no secret there is no way to tell Meta from anyone else, so the
    // endpoint does not exist as far as a caller is concerned.
    return new NextResponse("Not found", { status: 404 });
  }

  // Read as text, never as JSON. The signature covers the exact bytes sent, and
  // parsing then re-serializing produces different bytes and a false mismatch.
  const rawBody = await request.text();

  const contract = safeContract();
  if (!contract) {
    logger.error("integration.webhook_contract_unavailable", { refusalCode: "contract_expired" });
    return new NextResponse("Service unavailable", { status: 503 });
  }

  const supabase = createCampaignWorkerServiceClient();

  const result = await intakeWebhook(
    {
      rawBody,
      signatureHeader: request.headers.get("x-hub-signature-256"),
      normalize: normalizeMetaDelivery,
    },
    {
      providerKey: contract.providerKey,
      appSecret,
      // Only events the checked-in contract documents. Anything else is
      // quarantined rather than guessed at.
      allowedEventTypes: contract.webhook?.events.map((event) => event.key) ?? [],
      accounts: createMetaWebhookAccountMapper(supabase as never),
      receipts: createWebhookReceiptStore(supabase as never),
    },
  );

  if (result.outcome === "rejected") {
    logger.warn("integration.webhook_rejected", { refusalCode: result.reason });
    return new NextResponse(null, { status: result.status });
  }

  if (result.outcome === "quarantined") {
    logger.warn("integration.webhook_quarantined", { refusalCode: result.reason });
    // 200 on purpose. The delivery was genuine and is safely recorded; a
    // non-2xx would make Meta retry something no retry can fix.
    return new NextResponse(null, { status: 200 });
  }

  if (result.outcome === "replayed") {
    return new NextResponse(null, { status: 200 });
  }

  if (result.outcome === "accepted") {
    logger.info("integration.webhook_accepted", {
      organizationId: result.organizationId,
      connectionId: result.connectionId,
    });
  }

  return new NextResponse(null, { status: 200 });
}

/** An expired contract disables intake rather than falling back to guesses. */
function safeContract() {
  try {
    return getMetaCampaignProviderContract();
  } catch {
    return null;
  }
}
