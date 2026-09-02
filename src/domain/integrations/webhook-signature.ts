import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Whether an inbound webhook really came from the provider.
 *
 * This runs before anything reads a business field, and that order is the whole
 * point: an unverified body is attacker-controlled input, and parsing it first
 * would mean deciding which organization it belongs to on the strength of a
 * claim anyone could make.
 *
 * Comparison is timing-safe. A byte-by-byte compare that returns early leaks
 * how much of a forged signature was correct, which is enough to reconstruct
 * one given patience.
 */

export type WebhookSignatureResult =
  | { verified: true }
  | { verified: false; reason: "missing" | "malformed" | "mismatch" };

export type WebhookSignatureInput = {
  /** Exactly the bytes the provider signed. Never a re-serialized object. */
  rawBody: string;
  /** Header value as received, e.g. `sha256=<hex>`. */
  headerValue: string | null;
  secret: string;
  /** From the provider contract; never assumed. */
  algorithm?: "sha256";
  prefix?: string;
};

export function verifyWebhookSignature(input: WebhookSignatureInput): WebhookSignatureResult {
  if (!input.headerValue) return { verified: false, reason: "missing" };

  const prefix = input.prefix ?? "sha256=";
  if (!input.headerValue.startsWith(prefix)) return { verified: false, reason: "malformed" };

  const supplied = input.headerValue.slice(prefix.length);
  if (!/^[0-9a-f]+$/i.test(supplied) || supplied.length === 0) {
    return { verified: false, reason: "malformed" };
  }

  const expected = createHmac(input.algorithm ?? "sha256", input.secret)
    .update(input.rawBody, "utf8")
    .digest("hex");

  const suppliedBytes = Buffer.from(supplied.toLowerCase(), "hex");
  const expectedBytes = Buffer.from(expected, "hex");

  // Length is checked separately because timingSafeEqual throws on a mismatch,
  // and a thrown error would itself be an observable difference.
  if (suppliedBytes.length !== expectedBytes.length) {
    return { verified: false, reason: "mismatch" };
  }

  return timingSafeEqual(suppliedBytes, expectedBytes)
    ? { verified: true }
    : { verified: false, reason: "mismatch" };
}

/**
 * The subscription handshake.
 *
 * Meta sends `hub.mode=subscribe` with a challenge and the token configured in
 * the app dashboard. Echoing the challenge without checking the token would let
 * anyone who guesses the URL confirm the endpoint on our behalf.
 */
export type HandshakeResult =
  | { outcome: "echo"; challenge: string }
  | { outcome: "refused"; reason: "wrong_mode" | "bad_token" | "missing_challenge" };

export function evaluateWebhookHandshake(input: {
  mode: string | null;
  challenge: string | null;
  verifyToken: string | null;
  expectedToken: string;
}): HandshakeResult {
  if (input.mode !== "subscribe") return { outcome: "refused", reason: "wrong_mode" };
  if (!input.challenge) return { outcome: "refused", reason: "missing_challenge" };

  const supplied = Buffer.from(input.verifyToken ?? "", "utf8");
  const expected = Buffer.from(input.expectedToken, "utf8");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return { outcome: "refused", reason: "bad_token" };
  }

  return { outcome: "echo", challenge: input.challenge };
}
